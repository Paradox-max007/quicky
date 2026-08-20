'use client'

import { useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { PhoneFrame } from '@/components/quicky/PhoneFrame'
import { AppRoot } from '@/components/quicky/AppRoot'

export default function Home() {
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const setHydrated = useQuickyStore((s) => s.setHydrated)
  const user = useQuickyStore((s) => s.user)
  const view = useQuickyStore((s) => s.view)

  // On mount: fetch current user (if logged in)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.auth.me()
        if (cancelled) return
        if (res.user) {
          setUser(res.user)
          if (!res.user.onboardedAt) setView('onboarding')
          else setView('discovery')
        } else {
          setView('auth')
        }
      } catch (e) {
        setView('auth')
      } finally {
        setHydrated(true)
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
