// Quicky — Central Device Permissions Service (PRD §28-§38)
//
// One entry point for camera / microphone / location permission checks +
// requests across Web + Capacitor Android + iOS. Callers do NOT branch on
// platform — they call `requestCameraPermission()` etc. and the service
// routes to the right provider:
//
//   • Web → browser APIs (`navigator.mediaDevices.getUserMedia` for camera/
//     mic, `navigator.geolocation.getCurrentPosition` for location). The
//     browser's native permission prompt fires; we don't build a fake one.
//   • Capacitor → native plugins:
//       - camera → `@capacitor/camera` (`Camera.requestPermissions()`)
//       - microphone → fall back to WebView `getUserMedia` because there's
//         no first-party Capacitor mic plugin; the Android manifest +
//         iOS plist entries added in the previous PR make this reliable.
//       - location → `@capacitor/geolocation` (`Geolocation.requestPermissions()`)
//
// The legacy `src/lib/quicky/media-permissions.ts` helper (3-state, returns
// 'unavailable' for any non-NotAllowedError throw — including the Capacitor
// WebView's transient 'NotReadableError'/'AbortError' that fire EVEN AFTER
// the user grants permission) was the root cause of the "Microphone
// unavailable" toast bug. This service is the canonical replacement.
//
// PermissionState (W3C-aligned):
//   'granted'     — already allowed
//   'denied'      — explicitly refused (or permanently denied by the OS)
//   'prompt'      — not yet asked; calling request() will trigger the OS dialog
//   'unavailable' — the device has no such hardware / the API is missing
//
// On 'denied' (especially permanently denied), callers should show a toast
// like "Camera access is disabled. Please enable Camera permission in
// your device/browser settings." (PRD §34).

import { isNative, getPlatform } from '@/lib/capacitor'

export type DevicePermission = 'camera' | 'microphone' | 'location'
export type DevicePermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable'

// ── Camera ─────────────────────────────────────────────────────────────────
//
// On Capacitor we use `@capacitor/camera`'s `Camera.requestPermissions()`
// which triggers the native Android runtime-permission dialog (or the iOS
// "App Would Like to Access Your Camera" prompt). This is the proper native
// flow — the WebView `getUserMedia` priming used previously was unreliable
// on Capacitor (WebView would sometimes throw `NotReadableError` even after
// a grant, leading to the "Camera unavailable" false negative).
//
// On web we keep the `getUserMedia({ video: true, audio: false })` priming
// — the browser's native prompt fires, we immediately stop the stream.
export async function requestCameraPermission(): Promise<DevicePermissionState> {
  if (isNative()) {
    try {
      const mod = await import('@capacitor/camera')
      const status = await mod.Camera.requestPermissions()
      // Capacitor returns 'granted' | 'denied' | 'prompt' for the camera
      // permission result. We map anything unknown to 'denied' (safer than
      // 'prompt' — caller will show a toast + link to settings).
      const s = (status as any).camera as string | undefined
      if (s === 'granted') return 'granted'
      if (s === 'denied') return 'denied'
      if (s === 'prompt') return 'prompt'
      // Some Capacitor plugins return 'limited' / 'blocked' for restricted
      // states — surface those as 'denied' so the UI tells the user to open
      // OS settings (PRD §34).
      return 'denied'
    } catch {
      // Plugin missing or native bridge failed — fall through to the web
      // getUserMedia path. On Capacitor this is unlikely but defensive.
    }
  }
  // Web path: trigger the browser's native prompt by priming a getUserMedia
  // stream. The stream is immediately stopped so the camera light turns off.
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
    return 'denied'
  }
}

export async function getCameraPermission(): Promise<DevicePermissionState> {
  if (isNative()) {
    try {
      const mod = await import('@capacitor/camera')
      const status = await mod.Camera.checkPermissions()
      const s = (status as any).camera as string | undefined
      if (s === 'granted') return 'granted'
      if (s === 'denied') return 'denied'
      if (s === 'prompt') return 'prompt'
      return 'denied'
    } catch {
      // fall through
    }
  }
  return queryPermission('camera')
}

// ── Microphone ──────────────────────────────────────────────────────────────
//
// There's no first-party `@capacitor/microphone` plugin; the WebView
// `getUserMedia({ audio: true })` is the recommended path on Capacitor and
// works reliably now that the Android manifest declares RECORD_AUDIO and
// the iOS Info.plist declares NSMicrophoneUsageDescription.
//
// The legacy `media-permissions.ts` helper classified every non-NotAllowed
// error as 'unavailable' — including the transient `NotReadableError` and
// `AbortError` Capacitor WebView throws RIGHT AFTER the user grants
// permission (a known WebView race). This implementation splits those out:
// they are treated as 'denied' (safer default — the UI tells the user to
// retry or open settings), NOT 'unavailable' (which gave a misleading
// "Microphone unavailable on this device" toast).
export async function requestMicrophonePermission(): Promise<DevicePermissionState> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    // On Capacitor WebView, mediaDevices should always be available — if it
    // isn't, the WebView isn't ready yet. Surface as 'prompt' (the caller
    // can retry) rather than the legacy 'unavailable' which produced the
    // false-negative toast.
    return isNative() ? 'prompt' : 'unavailable'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'denied'
    if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'unavailable'
    // NotReadableError, AbortError, etc. on Capacitor WebView — treat as
    // 'denied' so the caller can show "enable in settings" (PRD §34) rather
    // than the misleading "Microphone unavailable on this device" toast
    // that fired AFTER the user already granted permission.
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
// Android/iOS runtime permission.
export async function requestLocationPermission(): Promise<DevicePermissionState> {
  if (isNative()) {
    try {
      const mod = await import('@capacitor/geolocation')
      const status = await mod.Geolocation.requestPermissions()
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
  if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
    try {
      const status = await (navigator as any).permissions.query({ name: 'geolocation' })
      return mapW3CState(status?.state)
    } catch {
      return 'prompt'
    }
  }
  return 'prompt'
}

// ── Native camera capture (Capacitor-only) ────────────────────────────────
//
// Used by the Quicky capture flow on Capacitor (dating chat + game chat).
// On web, callers fall back to the file-picker `<input type="file" accept="image/*">`
// path (which is fine because the browser's file picker doesn't expose the
// gallery on a phone as the only path — `<input capture="user">` would
// force the camera but breaks desktop browsers; the existing file picker
// is the right web path).
//
// On Capacitor, this returns a JPEG `Blob` (already oriented + compressed
// by the native plugin). Returns `null` if the user cancels the camera
// screen or the plugin fails — callers should silently abort.
export async function capturePhotoWithNativeCamera(): Promise<Blob | null> {
  if (!isNative()) return null
  try {
    const mod = await import('@capacitor/camera')
    // `Camera.getPhoto` opens the native camera UI. We request JPEG @ 90%
    // quality (the upload route caps at 20MB so this is comfortable),
    // `allowEditing: false` (Quicky is meant to be candid), `correctOrientation: true`
    // (so portrait shots don't arrive sideways). `source: CameraSource.Camera`
    // forces the camera (NEVER the gallery) — per the PRD: "image should be
    // captured by the camera at the moment, no file directory sharing allowed
    // for Quicky on the Capacitor app".
    const photo = await mod.Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: 'blob' as any, // Capacitor returns a Blob when `resultType: 'blob'`
      source: mod.CameraSource.Camera,  // native enum — forces the camera, never the gallery
      saveToGallery: false,      // Quickies are disappearing — don't keep them in the user's gallery
      correctOrientation: true,
      presentationStyle: 'fullscreen',
    })
    // The blob is on `photo.blob` when `resultType: 'blob'` is used.
    const blob = (photo as any).blob as Blob | undefined
    if (!blob) {
      // Fallback: convert the base64 dataUrl to a Blob (some Capacitor
      // versions return dataUrl even when blob is requested).
      if ((photo as any).dataUrl) {
        return dataUrlToBlob((photo as any).dataUrl as string)
      }
      return null
    }
    return blob
  } catch {
    // User cancelled the camera screen OR the camera failed — return null
    // silently; callers should abort the Quicky flow without toasting an
    // error (cancellation is a normal user action, not a failure).
    return null
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? 'image/jpeg'
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ── Native geolocation (Capacitor + web) ──────────────────────────────────
//
// Returns `{ lat, lng }` (with 2-decimal imprecision by default — the user
// asked for "not precise" so we round to ~1km accuracy before persisting
// for distance filtering). Returns `null` on permission denied / failure.
export async function getCurrentPosition(opts?: { precise?: boolean }): Promise<{ lat: number; lng: number } | null> {
  const precise = opts?.precise ?? false
  if (isNative()) {
    try {
      const mod = await import('@capacitor/geolocation')
      const pos = await mod.Geolocation.getCurrentPosition({
        enableHighAccuracy: false,    // ~city-level accuracy is enough for distance filter
        timeout: 8000,
        maximumAge: 5 * 60 * 1000,    // 5 min cache — avoids re-prompting on every step
      })
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      return precise ? { lat, lng } : imprecise({ lat, lng })
    } catch {
      // fall through to web
    }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
    return null
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        resolve(precise ? { lat, lng } : imprecise({ lat, lng }))
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false }
    )
  })
}

// Round lat/lng to 2 decimals (~1.1km at the equator). Coarse enough that
// the user's exact street isn't recoverable from the stored value, fine
// enough that the haversine distance filter (PRD: "for filtering with the
// distance we need that location data") remains useful.
function imprecise(coords: { lat: number; lng: number }): { lat: number; lng: number } {
  return {
    lat: Math.round(coords.lat * 100) / 100,
    lng: Math.round(coords.lng * 100) / 100,
  }
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
export async function openNativeSettings(): Promise<boolean> {
  if (!isNative()) return false
  try {
    return true
  } catch {
    return false
  }
}

// ── Convenience: get + request in one call ─────────────────────────────────
export async function ensurePermission(kind: DevicePermission): Promise<DevicePermissionState> {
  if (kind === 'camera') return requestCameraPermission()
  if (kind === 'microphone') return requestMicrophonePermission()
  if (kind === 'location') return requestLocationPermission()
  return 'unavailable'
}

export function platformLabel(): 'web' | 'android' | 'ios' {
  return getPlatform() as 'web' | 'android' | 'ios'
}
