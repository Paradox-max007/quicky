'use client'

// Quicky — useGameWakeLock (v3 PRD §72-§77)
// Keeps the screen awake while the game room is mounted:
//   • Web / Capacitor Android WebView: Screen Wake Lock API with a graceful
//     no-op fallback when unsupported — the game must never crash on it (§75).
//   • Capacitor native (iOS WKWebView has no Wake Lock API): optional
//     @capacitor-community/keep-awake via dynamic import — if the plugin is
//     not installed the guarded import resolves to nothing (§76: minimal,
//     optional native mechanism).
//   • visibilitychange → re-acquire (§77: the OS may revoke the lock).
//   • Physical power button is never overridden (§74) — we only prevent the
//     AUTOMATIC dim/timeout while the room is open.
// Release happens on unmount (leave room) — §73 lifecycle.

import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'

type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: string, fn: () => void) => void
}

export function useGameWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)
  const nativeRef = useRef<{ keepAwake: () => Promise<void>; allowSleep: () => Promise<void> } | null>(null)
  const supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator

  useEffect(() => {
    if (!active) return
    let disposed = false

    const acquireWeb = async () => {
      if (!supported || sentinelRef.current) return
      try {
        const sentinel = (await (navigator as any).wakeLock.request('screen')) as WakeLockSentinelLike
        if (disposed) {
          void sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        // Auto-release by the OS → clear our handle so re-acquire works.
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null
        })
      } catch {
        // Denied / unsupported / hidden tab — stay silent (§75).
      }
    }

    const acquireNative = async () => {
      if (!Capacitor.isNativePlatform() || nativeRef.current) return
      try {
        const mod: any = await import('@capacitor-community/keep-awake')
        if (disposed) return
        nativeRef.current = mod.KeepAwake
        await mod.KeepAwake.keepAwake()
      } catch {
        nativeRef.current = null // plugin not installed → web path already tried
      }
    }

    const acquire = () => {
      void acquireWeb()
      void acquireNative()
    }

    const releaseWeb = async () => {
      const s = sentinelRef.current
      sentinelRef.current = null
      if (s && !s.released) {
        try {
          await s.release()
        } catch {}
      }
    }

    const releaseNative = async () => {
      const n = nativeRef.current
      nativeRef.current = null
      if (n) {
        try {
          await n.allowSleep()
        } catch {}
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      void releaseWeb()
      void releaseNative()
    }
  }, [active, supported])
}
