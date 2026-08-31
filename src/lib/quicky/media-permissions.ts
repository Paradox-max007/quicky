// Quicky — native media permissions (mobile)
// On Android/iOS the OS permission prompt is triggered by the first
// getUserMedia() call, so we "prime" the permission with a minimal stream
// and immediately stop it. This asks the user up front (e.g. when they tap
// the mic or Quicky camera button) instead of failing mid-recording, and
// returns the current state so callers can show a friendly toast.
//
// Note: the Android/iOS manifests must still declare the permissions —
// see android/app/src/main/AndroidManifest.xml (RECORD_AUDIO / CAMERA) and
// ios Info.plist (NSMicrophoneUsageDescription / NSCameraUsageDescription).

export type PermissionState = 'granted' | 'denied' | 'unavailable'

async function primePermission(kind: 'audio' | 'video'): Promise<PermissionState> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unavailable'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'audio' ? { audio: true } : { video: true, audio: false }
    )
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err: any) {
    // NotAllowedError = the user (or the OS) said no; anything else is a
    // device/manifest problem we surface as unavailable.
    return err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'unavailable'
  }
}

export function requestMicPermission(): Promise<PermissionState> {
  return primePermission('audio')
}

export function requestCameraPermission(): Promise<PermissionState> {
  return primePermission('video')
}

/** True when permission has already been granted before (no prompt shown). */
export async function hasPermission(kind: 'audio' | 'video'): Promise<boolean> {
  try {
    const q = kind === 'audio' ? { name: 'microphone' as PermissionName } : { name: 'camera' as PermissionName }
    const status = await navigator.permissions?.query(q)
    return status?.state === 'granted'
  } catch {
    return false
  }
}
