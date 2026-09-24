// Quicky — FCM PUSH SENDER (server-only)
//
// One fan-out helper used by every event route (messages, likes, super likes,
// matches, profile views):
//   pushNotify(userId, kind, { title, body, data })
//
// Behavior contract:
//   · NEVER throws — event routes call it fire-and-forget; a push failure must
//     never fail the actual event (like, match, message…).
//   · Gated by the RECIPIENT's UserSettings toggle for the kind (the premium-
//     gated notification preferences in Settings → Notifications).
//   · Fans out to every ACTIVE PushToken row of the recipient (web browsers,
//     iOS/Android installs via the Capacitor Firebase Messaging plugin).
//   · Silent no-op while Firebase is not configured (no service-account env
//     vars) — local dev works without any push setup.
//
// Env (see .env.example):
//   FIREBASE_SERVICE_ACCOUNT_JSON  — full service-account JSON string, OR
//   FIREBASE_SERVICE_ACCOUNT_B64   — the same JSON base64-encoded, OR
//   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
//
// Client side: src/lib/quicky/push-client.ts + public/firebase-messaging-sw.js.

import { db } from '@/lib/db'

export type NotifKind = 'message' | 'like' | 'superlike' | 'match' | 'profileView'

/** Which UserSettings boolean gates each kind. */
const SETTING_BY_KIND: Record<NotifKind, string> = {
  message: 'notifMessages',
  like: 'notifLikes',
  superlike: 'notifSuperLikes',
  match: 'notifConnectionReqs',
  profileView: 'notifProfileViews',
}

export type PushPayload = {
  title: string
  body: string
  /** Deep-link-ish data delivered to the client (view to open, who acted). */
  data?: Record<string, string>
}

// ─── firebase-admin lazy singleton ──────────────────────────────────────────

type MessagingLike = {
  sendEachForMulticast: (msg: {
    tokens: string[]
    notification: { title: string; body: string }
    data?: Record<string, string>
  }) => Promise<{ successCount: number; failureCount: number; responses: { error?: { code?: string; message?: string } }[] }>
}

let messagingPromise: Promise<MessagingLike | null> | null = null

function parseServiceAccount(): Record<string, unknown> | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64
  const raw =
    json ||
    (b64
      ? (() => {
          try {
            return Buffer.from(b64, 'base64').toString('utf8')
          } catch {
            return null
          }
        })()
      : null)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // fall through to the discrete vars
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey }
  }
  return null
}

async function getMessaging(): Promise<MessagingLike | null> {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const account = parseServiceAccount()
      if (!account) return null
      try {
        const { initializeApp, getApps, cert } = await import('firebase-admin/app')
        const { getMessaging } = await import('firebase-admin/messaging')
        const appName = 'quicky-push'
        const app = getApps().find((a) => a.name === appName) ?? initializeApp({ credential: cert(account as never) }, appName)
        return getMessaging(app) as unknown as MessagingLike
      } catch (err) {
        console.warn('[push] firebase-admin init failed — push disabled:', (err as Error).message)
        return null
      }
    })()
  }
  return messagingPromise
}

// ─── the fan-out helper ─────────────────────────────────────────────────────

/**
 * Fire-and-forget push to one user's devices, gated by their settings for the
 * given kind. Safe to call from ANY route (never throws, never blocks long).
 */
export async function pushNotify(userId: string, kind: NotifKind, payload: PushPayload): Promise<void> {
  try {
    const settingKey = SETTING_BY_KIND[kind]

    // 1. Recipient's notification preference for this kind (default: on).
    const [user, settings] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { id: true } }),
      db.userSettings.findUnique({ where: { userId } }),
    ])
    if (!user) return
    if (settings && settings[settingKey as keyof typeof settings] === false) return

    // 2. Active device tokens.
    const tokens = await db.pushToken.findMany({
      where: { userId, active: true },
      select: { token: true, platform: true },
    })
    if (tokens.length === 0) return

    // 3. Send (only when firebase-admin is configured).
    const messaging = await getMessaging()
    if (!messaging) return

    const res = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    })

    // 4. Retire dead tokens (unregistered / invalid registration).
    if (res.failureCount > 0 && Array.isArray(res.responses)) {
      const dead: string[] = []
      tokens.forEach((t, i) => {
        const err = res.responses[i]?.error
        if (err && (err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-argument')) {
          dead.push(t.token)
        }
      })
      if (dead.length > 0) {
        await db.pushToken.updateMany({ where: { token: { in: dead } }, data: { active: false } }).catch(() => {})
      }
    }
  } catch {
    // Never let push problems surface in the event route.
  }
}
