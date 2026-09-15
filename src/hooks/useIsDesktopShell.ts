'use client'

import { useEffect, useState } from 'react'

/**
 * Desktop shell breakpoint (Desktop UI concept §31):
 *   <768px    mobile experience (unchanged)
 *   768–1023  compact centered columns (unchanged behavior)
 *   ≥1024px   the desktop command-center shell (sidebar + top bar + panels)
 *
 * null = unknown (SSR / first paint) — callers treat null as FALSE so the
 * mobile layout always paints first and the desktop shell mounts only after
 * the media query has actually been evaluated (same pattern as PhoneFrame).
 */
const QUERY = '(min-width: 1024px)'

export function useIsDesktopShell(): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return matches
}
