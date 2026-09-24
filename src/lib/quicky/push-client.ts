'use client'

// Quicky — CLIENT PUSH LAYER (FCM)
//
// Web (desktop + mobile web): the firebase JS SDK resolves a registration
//   token (VAPID + service worker) after the user grants permission — always
//   from an explicit "Enable push notifications" button (browser gesture
//   requirement), then on every session start while the permission stands.
// Capacitor (iOS/Android): @capacitor-firebase/messaging (native plugin —
//   requires google-services.json / GoogleService-Info.plist + `npx cap sync`
//   on the user's build machine; until then the dynamic import degrades
//   gracefully and web-style registration is skipped on native).
//
// The token is POSTed to /api/quicky/push/register; event routes fan out via
// src/lib/quicky/push.ts (gated by the recipient's notification settings).
//
// Foreground: onMessage → in-app toast (the same events, live).

import { Capacitor } from '@capacitor/core'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'

type FirebaseWebConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  messagingSenderId: string
  appId: string
}

let webMessaging: unknown | null = null
let foregroundBound = false
let registeredToken: string | null = null

/** The public Firebase web config (null when the env vars are absent). */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId || !cfg.messagingSenderId) return null
  return cfg as FirebaseWebConfig
}

export function pushVapidKey(): string | null {
  const key = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  return key ? key : null
}

/** Is this browser/platform able to do web push at all? */
export function webPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (Capacitor.isNativePlatform()) return false
  return 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window
}

/** Current browser permission state ('default' | 'granted' | 'denied'). */
export function webPushPermission(): NotificationPermission | 'unsupported' {
  if (!webPushSupported()) return 'unsupported'
  return Notification.permission
}

// ─── WEB (firebase JS SDK) ──────────────────────────────────────────────────

async function registerWebToken(): Promise<string | null> {
  const config = firebaseWebConfig()
  const vapidKey = pushVapidKey()
  if (!config || !vapidKey) return null

  const { initializeApp, getApps } = await import('firebase/app')
  const { getMessaging, getToken, onMessage, isSupported } = await import('firebase/messaging')
  if (!(await isSupported())) return null

  const app = getApps().length ? getApps()[0] : initializeApp(config)
  const messaging = getMessaging(app)
  webMessaging = messaging

  // Register the FCM service worker, carrying the web config through the URL
  // (a public SW cannot read env vars).
  const cfgParam = btoa(JSON.stringify(config))
  const swReg = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?cfg=${encodeURIComponent(cfgParam)}`)

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg })
  if (!token) return null

  // Foreground messages → in-app toasts (bound exactly once).
  if (!foregroundBound) {
    foregroundBound = true
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? 'Quicky'
      const body = payload.notification?.body ?? ''
      if (body) toast(title, { description: body })
    })
  }
  return token
}

// ─── CAPACITOR (native Firebase Messaging plugin) ───────────────────────────

async function registerNativeToken(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const mod = await import('@capacitor-firebase/messaging')
    const { FirebaseMessaging } = mod
    await FirebaseMessaging.requestPermissions()
    const { token } = await FirebaseMessaging.getToken()
    return token || null
  } catch {
    // Native Firebase not wired in this build (no google-services.json / pods
    // yet) — push simply stays off until the app build provides it.
    return null
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function submitToken(token: string, platform: 'web' | 'ios' | 'android'): Promise<boolean> {
  if (registeredToken === token) return true
  try {
    await api.push.register(token, platform)
    registeredToken = token
    return true
  } catch {
    return false
  }
}

export type EnablePushResult =
  | { ok: true; platform: 'web' | 'ios' | 'android' }
  | { ok: false; reason: 'unsupported' | 'permission_denied' | 'not_configured' | 'failed' }

/**
 * Enable push on this device — ALWAYS called from a user gesture (the
 * "Enable push notifications" button in Settings → Notifications). Web asks
 * the browser for permission; Capacitor asks through the native plugin.
 */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  try {
    if (Capacitor.isNativePlatform()) {
      const token = await registerNativeToken()
      if (!token) return { ok: false, reason: 'not_configured' }
      const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'
      const sent = await submitToken(token, platform)
      return sent ? { ok: true, platform } : { ok: false, reason: 'failed' }
    }

    if (!webPushSupported()) return { ok: false, reason: 'unsupported' }
    if (!firebaseWebConfig() || !pushVapidKey()) return { ok: false, reason: 'not_configured' }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, reason: 'permission_denied' }

    const token = await registerWebToken()
    if (!token) return { ok: false, reason: 'failed' }
    const sent = await submitToken(token, 'web')
    return sent ? { ok: true, platform: 'web' } : { ok: false, reason: 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/**
 * Session-start reconciliation: when permission was ALREADY granted, silently
 * refresh the token (FCM rotates them) and keep it registered server-side.
 * Never prompts — safe to call on every app mount.
 */
export function initPushSession(): void {
  if (typeof window === 'undefined') return
  if (!useQuickyStore.getState().user?.id) return

  void (async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        // Only when permissions were granted before (no prompt on mount).
        const mod = await import('@capacitor-firebase/messaging').catch(() => null)
        if (!mod) return
        const status = await mod.FirebaseMessaging.checkPermissions().catch(() => null)
        if (status?.receive !== 'granted') return
        const { token } = await mod.FirebaseMessaging.getToken().catch(() => ({ token: null as string | null }))
        if (token) await submitToken(token, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
        return
      }
      if (webPushSupported() && Notification.permission === 'granted') {
        const token = await registerWebToken()
        if (token) await submitToken(token, 'web')
      }
    } catch {
      /* push is best-effort on mount */
    }
  })()
}

/** Is push currently enabled on this device (permission + config)? */
export function pushCurrentlyEnabled(): boolean {
  if (Capacitor.isNativePlatform()) return registeredToken !== null
  return webPushSupported() && Notification.permission === 'granted' && !!firebaseWebConfig() && !!pushVapidKey()
}
