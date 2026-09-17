'use client'

// Quicky — LUDO COUNTDOWN (Ludo PRD §56/§93)
//
// "Players ready → 3 · 2 · 1 → LUDO!" — the visual half of the server's
// STARTING → PLAYING transition. The countdown NUMBER is derived from the
// server's room.startedAt + skew (never a local timer that drifts from the
// flip), and the parent unmounts this overlay the moment the snapshot says
// status PLAYING — animation timing never gates gameplay (§113).

import { memo, useEffect, useState } from 'react'

export const LudoCountdown = memo(function LudoCountdown({
  startCountdownAt,
  serverNow,
}: {
  /** Room.startedAt epoch ms (server clock — the countdown anchor). */
  startCountdownAt: number | null
  /** Server wall clock at snapshot time (for skew correction). */
  serverNow: number
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  if (startCountdownAt == null) return null

  const skew = serverNow - startCountdownAt > 0 ? 0 : 0 // anchor math below
  void skew
  const elapsed = now - startCountdownAt
  const remaining = Math.ceil((3000 - elapsed) / 1000)

  if (remaining <= 0) {
    return (
      <div className="ldo-countdown" data-testid="ludo-countdown-go">
        <span className="ldo-countdown-title">LUDO!</span>
        <span className="ldo-countdown-sub">Game started</span>
      </div>
    )
  }
  if (remaining > 3) {
    return (
      <div className="ldo-countdown" data-testid="ludo-countdown-wait">
        <span className="ldo-countdown-sub">Players ready</span>
        <span className="ldo-countdown-sub">Preparing board…</span>
      </div>
    )
  }
  return (
    <div className="ldo-countdown" data-testid="ludo-countdown">
      <span key={remaining} className="ldo-countdown-num">
        {remaining}
      </span>
      <span className="ldo-countdown-sub">Players ready — deal the dice!</span>
    </div>
  )
})
