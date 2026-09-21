'use client'

import { useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { PhoneFrame } from '@/components/quicky/PhoneFrame'
import { AppRoot } from '@/components/quicky/AppRoot'
import { initSafeArea } from '@/lib/quicky/safe-area'
import { cacheGet, cacheSet, cacheRemove } from '@/lib/quicky/cache'

// Calibrate the safe-area model BEFORE first render on the client (no-op on
// the server — see lib/quicky/safe-area.ts).
initSafeArea()

export default function Home() {
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const setHydrated = useQuickyStore((s) => s.setHydrated)
  const user = useQuickyStore((s) => s.user)
  const view = useQuickyStore((s) => s.view)

  // On mount: fetch current user (if logged in).
  // LOCAL-BOOT (Capacitor / repeat visits): the last session's user is cached
  // in localStorage, so the app paints its real screens INSTANTLY instead of
  // the loading splash, then the server response reconciles (still the only
  // authority — a logged-out answer clears the cache and lands on auth).
  useEffect(() => {
    let cancelled = false
    let paintedFromCache = false

    // Instant paint from the device cache (stale is fine for the first frame).
    const cachedUser = cacheGet<any>('user_cache_v1', { allowStale: true })
    if (cachedUser?.id) {
      paintedFromCache = true
      setUser(cachedUser)
      setView(cachedUser.onboardedAt ? 'discovery' : 'onboarding')
      setHydrated(true)
    }

    ;(async () => {
      try {
        const res = await api.auth.me()
        if (cancelled) return
        if (res.user) {
          setUser(res.user)
          if (!res.user.onboardedAt) setView('onboarding')
          else if (!paintedFromCache) setView('discovery')
          cacheSet('user_cache_v1', res.user)
        } else {
          cacheRemove('user_cache_v1')
          setView('auth')
        }
      } catch (e) {
        // Offline (Capacitor app with no server reach): keep the cached
        // session painted; only a definitive logged-out answer logs out.
        if (!paintedFromCache) setView('auth')
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setUser, setView, setHydrated])

  return (
    <PhoneFrame>
      <AppRoot />
    </PhoneFrame>
  )
}
