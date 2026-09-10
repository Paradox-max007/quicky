'use client'

import { useEffect, useState } from 'react'

// RoomEventBanner — glossy "Hot Festival" strip with a live countdown.
// Sits directly above the wooden stage, like a mobile-game event tile.

export type RoomEvent = {
  title: string
  emoji: string
  tag?: string
  background?: string
  expiresAt: string // ISO date
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00h 00m'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
}

export function RoomEventBanner({ event }: { event: RoomEvent }) {
  const [remaining, setRemaining] = useState(() =>
    formatRemaining(new Date(event.expiresAt).getTime() - Date.now())
  )

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(formatRemaining(new Date(event.expiresAt).getTime() - Date.now()))
    }, 30_000)
    return () => clearInterval(id)
  }, [event.expiresAt])

  return (
    <div className="sbr-banner-wrap">
      <div className="sbr-banner" style={event.background ? { background: event.background } : undefined}>
        <span className="sbr-banner-title">
          <span aria-hidden>{event.emoji}</span>
          {event.title}
          {event.tag && <span className="sbr-banner-tag">{event.tag}</span>}
        </span>
        <span className="sbr-banner-timer">⏱ {remaining}</span>
      </div>
    </div>
  )
}

/** Default room event: "Hot Festival" ending at midnight, local time. */
export function tonightEvent(): RoomEvent {
  const end = new Date()
  end.setHours(24, 0, 0, 0)
  return { title: 'Hot Festival', emoji: '🔥', tag: 'X2 Hearts', expiresAt: end.toISOString() }
}
