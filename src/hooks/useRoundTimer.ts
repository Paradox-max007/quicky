'use client'

// Quicky — useRoundTimer (bug-fix PRD v2.1 §34-§40)
//
// Responsibilities (§73):
//   server deadline → calculate remaining → display countdown → stop at zero
//
// The deadline comes from the SERVER (`responseDeadline`, ISO) — never a
// local 10s tick (§35). Remaining is corrected by the measured server-clock
// skew. The interval is destroyed the moment remaining hits 0 (§37): the
// value can NEVER go negative and never keeps ticking behind a finished
// round. `timeUp` flips true at zero so the UI can show a short
// "Time's up" beat and then hide the countdown entirely (§38/§39).
//
// Implementation note: remaining/expired are DERIVED during render from a
// `now` sample (setState only ever runs inside interval/timeout callbacks,
// never synchronously in an effect body). A `deadline` stamp rides along
// with the sample so a brand-new deadline never renders against a stale
// `now` (which would flash "expired" for a frame).

import { useEffect, useRef, useState } from 'react'

/** How long the "Time's up" beat shows before the countdown hides (§39). */
const TIMES_UP_MS = 1600
const TICK_MS = 250

export function useRoundTimer(
  deadlineMs: number | null,
  getSkewMs: () => number
): { remaining: number; expired: boolean; timeUp: boolean } {
  // Latest clock sample + the deadline it was taken for (staleness guard)
  const [sample, setSample] = useState<{ deadline: number | null; now: number } | null>(null)
  const [timeUp, setTimeUp] = useState(false)
  const timesUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const stopInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    // No deadline → idle; any pending "Time's up" beat is cancelled. The
    // derived values below handle the reset (no sync setState here).
    if (deadlineMs == null) {
      stopInterval()
      if (timesUpTimer.current) clearTimeout(timesUpTimer.current)
      setTimeUp(false)
      return
    }

    // §37: when the deadline passes, the interval is cleared IMMEDIATELY
    // inside its own callback — no -1, -2, -3 ticks, no silent running.
    let stopped = false
    intervalRef.current = setInterval(() => {
      const left = deadlineMs - (Date.now() + getSkewMs())
      setSample({ deadline: deadlineMs, now: Date.now() })
      if (left <= 0 && !stopped) {
        stopped = true
        stopInterval()
        // §38/§39: brief "Time's up" beat, then the countdown hides.
        if (timesUpTimer.current) clearTimeout(timesUpTimer.current)
        setTimeUp(true)
        timesUpTimer.current = setTimeout(() => setTimeUp(false), TIMES_UP_MS)
      }
    }, TICK_MS)

    return () => {
      stopped = true
      stopInterval()
    }
  }, [deadlineMs, getSkewMs])

  // Clear the "Time's up" beat on unmount
  useEffect(() => {
    return () => {
      if (timesUpTimer.current) clearTimeout(timesUpTimer.current)
    }
  }, [])

  const fresh = sample && sample.deadline === deadlineMs
  // Fresh sample → use it; brand-new deadline → sample Date.now() during
  // render so the very first paint already shows the correct countdown.
  const now = fresh ? sample.now : Date.now()
  const left = deadlineMs != null ? deadlineMs - (now + getSkewMs()) : null
  const remaining = left == null || left <= 0 ? 0 : Math.ceil(left / 1000)
  const expired = left != null && left <= 0

  return { remaining, expired, timeUp: expired && timeUp }
}
