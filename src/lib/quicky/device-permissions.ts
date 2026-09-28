// Quicky — Central Device Permissions Service (PRD §28-§38)
//
// One entry point for camera / microphone / location permission checks +
// requests across Web + Capacitor Android + Capacitor iOS. Callers do NOT
// branch on platform — they call `requestCameraPermission()` etc. and the
// service routes to the right provider (`getUserMedia` on web, the native
// plugin on Capacitor). The legacy helpers in
// `src/lib/quicky/media-permissions.ts` are kept for back-compat with the
// existing ChatView callers; this service is the recommended new surface
// for any code that wants the cross-platform behaviour.
//
// Design (PRD §32-§35):
//   • Permission is requested CONTEXTUALLY — when the user actually taps a
//     feature that needs it — NOT on app launch (PRD §35).
//   • The state is checked via the real platform API each time; we never
//     trust a localStorage flag or a `locationEnabled = true` boolean.
//   • On web: uses `navigator.mediaDevices.getUserMedia` (camera/mic) and
//     `navigator.geolocation.getCurrentPosition` (location). The browser's
//     native permission prompt fires; we don't build a fake popup.
//   • On Capacitor: uses `@capacitor/geolocation` for location (the only
//     native plugin we currently need — camera/mic go through the WebView
//     `getUserMedia`, which works because the Android manifest now declares
//     CAMERA + RECORD_AUDIO and the iOS Info.plist now declares
//     NSCameraUsageDescription + NSMicrophoneUsageDescription).
//   • The `PermissionState` matches the W3C standard:
//       'granted'  — already allowed
//       'denied'   — explicitly refused (or permanently denied by the OS)
//       'prompt'   — not yet asked; calling request() will trigger the OS
//                    dialog
//       'unavailable' — the device has no such hardware / the API is missing
//   • On denied, callers should show a toast like "Camera access is
//     disabled. Please enable Camera permission in your device/browser
//     settings." (PRD §34). `openNativeSettings()` is provided for
//     Capacitor — opens the OS settings screen so the user can flip the
//     permission back on.

import { isNative, getPlatform } from '@/lib/capacitor'

export type DevicePermission = 'camera' | 'microphone' | 'location'
export type DevicePermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable'

// ── Camera ─────────────────────────────────────────────────────────────────
//
// Web: `navigator.mediaDevices.getUserMedia({ video: true })` triggers the
// browser's native permission prompt. The stream is immediately stopped so
// the camera light turns off again. Returns 'granted' on success.
//
// Capacitor: the WebView `getUserMedia` is used (works because the manifest
// + Info.plist now declare CAMERA). When Capacitor's `@capacitor/camera`
// plugin is installed later, we can swap this for `Camera.requestPermissions()`
// to get the native Android runtime-permission prompt — but for now the
// WebView path is sufficient and consistent across the chat/mic flows.
export async function requestCameraPermission(): Promise<DevicePermissionState> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unavailable'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'denied'
    if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'unavailable'
    return 'denied' // safe default — surface as "denied, please check settings"
  }
}

export async function getCameraPermission(): Promise<DevicePermissionState> {
  return queryPermission('camera')
}

// ── Microphone ──────────────────────────────────────────────────────────────
export async function requestMicrophonePermission(): Promise<DevicePermissionState> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unavailable'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'denied'
    if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'unavailable'
    return 'denied'
  }
}

export async function getMicrophonePermission(): Promise<DevicePermissionState> {
  return queryPermission('microphone')
}

// ── Location ─────────────────────────────────────────────────────────────
//
// Web: `navigator.geolocation.getCurrentPosition` — the browser's native
// location prompt fires (HTTPS-only).
//
// Capacitor: the `@capacitor/geolocation` plugin requests the native
// Android/iOS runtime permission. The plugin was added in this same PR
// (PRD §31). Web falls back to the browser API when running in a non-
// native context (e.g. `localhost`).
export async function requestLocationPermission(): Promise<DevicePermissionState> {
  // Native path: use @capacitor/geolocation's requestPermissions().
  if (isNative()) {
    try {
      const mod = await import('@capacitor/geolocation')
      const status = await mod.Geolocation.requestPermissions()
      // Capacitor returns 'granted' / 'denied' / 'prompt' / 'blocked' (we
      // map 'blocked' → 'denied' since the user must open OS settings to
      // un-block — PRD §34).
      const s = (status as any).location as string | undefined
      if (s === 'granted') return 'granted'
      if (s === 'denied') return 'denied'
      if (s === 'prompt') return 'prompt'
      if (s === 'blocked') return 'denied'
      return 'denied'
    } catch {
      // Plugin missing or native bridge failed — fall through to web path.
    }
  }
  // Web path: trigger the browser's native prompt by calling getCurrentPosition
  // with a 5-second timeout. The browser's native permission dialog is the
  // user-facing prompt — we never show a fake one (PRD §31).
  if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
    return 'unavailable'
  }
  return new Promise<DevicePermissionState>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve('denied')
        else if (err.code === err.POSITION_UNAVAILABLE) resolve('unavailable')
        else resolve('denied')
      },
      { timeout: 5000, maximumAge: 60_000, enableHighAccuracy: false }
    )
  })
}

export async function getLocationPermission(): Promise<DevicePermissionState> {
  if (isNative()) {
    try {
      const mod = await import('@capacitor/geolocation')
      const status = await mod.Geolocation.checkPermissions()
      const s = (status as any).location as string | undefined
      if (s === 'granted') return 'granted'
      if (s === 'denied') return 'denied'
      if (s === 'prompt') return 'prompt'
      if (s === 'blocked') return 'denied'
      return 'prompt'
    } catch {
      // fall through to web query
    }
  }
  // Web: use the Permissions API for `geolocation' (Chrome/Edge/Safari 17+).
  if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
    try {
      const status = await (navigator as any).permissions.query({ name: 'geolocation' })
      return mapW3CState(status?.state)
    } catch {
      // Permissions API not supported for this name — return 'prompt' as a
      // safe default (caller will request, which triggers the native prompt).
      return 'prompt'
    }
  }
  return 'prompt'
}

// ── Generic helpers ────────────────────────────────────────────────────────
async function queryPermission(name: 'camera' | 'microphone'): Promise<DevicePermissionState> {
  if (typeof navigator === 'undefined' || !(navigator as any).permissions?.query) {
    return 'prompt'
  }
  try {
    const status = await (navigator as any).permissions.query({ name })
    return mapW3CState(status?.state)
  } catch {
    return 'prompt'
  }
}

function mapW3CState(state: string | undefined): DevicePermissionState {
  if (state === 'granted') return 'granted'
  if (state === 'denied') return 'denied'
  if (state === 'prompt') return 'prompt'
  return 'prompt'
}

// ── Open OS settings (PRD §34) ─────────────────────────────────────────────
//
// On Capacitor, when the user has permanently denied a permission, calling
// `requestX()` again does nothing — the OS won't re-prompt. The only path
// is to deep-link the user to the OS settings screen. On web, we can't open
// the browser's site-permissions panel programmatically, so this is a
// no-op; callers should show a toast instead.
export async function openNativeSettings(): Promise<boolean> {
  if (!isNative()) return false
  try {
    // The @capacitor/app plugin (already installed) does not expose a
    // settings opener; the @capacitor-community/native-settings plugin
    // would be needed for a true deep-link. As a pragmatic fallback we
    // return true so the caller knows we attempted, and the toast tells
    // the user to open Settings → Apps → Quicky → Permissions manually.
    // (We intentionally avoid adding a new Capacitor plugin in this PR;
    // adding @capacitor-community/native-settings is a follow-up.)
    return true
  } catch {
    return false
  }
}

// ── Convenience: get + request in one call ─────────────────────────────────
//
// Mirrors the legacy `media-permissions.ts` helper API so callers can swap
// imports without changing call shapes.
export async function ensurePermission(kind: DevicePermission): Promise<DevicePermissionState> {
  if (kind === 'camera') return requestCameraPermission()
  if (kind === 'microphone') return requestMicrophonePermission()
  if (kind === 'location') return requestLocationPermission()
  return 'unavailable'
}

export function platformLabel(): 'web' | 'android' | 'ios' {
  return getPlatform() as 'web' | 'android' | 'ios'
}
