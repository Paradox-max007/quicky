'use client'

// Quicky — DATING UNREAD POLLER (Game Hub PRD §41-§42/§52-§53/§82)
//
// While a game is ACTIVE, an incoming Dating Chat message must reach the
// user WITHOUT them leaving the game (§41). This hook polls the matches
// list (the same source the Chats badge uses) every 10s and returns the
// first conversation that has unread messages — the room renders a small
// non-blocking banner for it. The game runtime is never touched (§44).

import { useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'

export type DatingUnread = {
  matchId: string
  name: string
  photo: string | null
  preview: string
}

export function useDatingUnread(enabled: boolean): DatingUnread | null {
  const [unread, setUnread] = useState<DatingUnread | null>(null)

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const tick = async () => {
      try {
        const res = await api.matches()
        if (stopped) return
        const matches: any[] = res.matches ?? []
        const first = matches.find((m) => (m.unreadCount ?? 0) > 0)
        setUnread(
          first
            ? {
                matchId: first.id,
                name: first.partner?.name ?? 'Someone',
                photo: first.partner?.photo ?? null,
                preview: first.preview || 'New message',
              }
            : null,
        )
      } catch {
        // §79: a failed poll must never break the game — stay silent.
      }
    }
    void tick()
    const iv = setInterval(tick, 10000)
    return () => {
      stopped = true
      clearInterval(iv)
    }
  }, [enabled])

  // Disabling derives "nothing to show" without a setState in the effect.
  return enabled ? unread : null
}
