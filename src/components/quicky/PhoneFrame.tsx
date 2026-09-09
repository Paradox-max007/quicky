'use client'

import { ReactNode, useEffect, useState } from 'react'
import { isNative, initStatusBar, hideSplashScreen } from '@/lib/capacitor'

/**
 * PhoneFrame — platform shell for the Quicky app. The app mounts EXACTLY
 * ONCE (the previous dual CSS-branch shell rendered `children` in a hidden
 * copy too, double-firing API calls such as game join / polling).
 *
 * - Desktop (web, ≥768px): full-window app — bigger screens, no phone frame.
 *   Screens render in large centered columns (see AppRoot) and the game room
 *   splits into game-left / chat-right using the full width.
 * - Mobile browser (web): full viewport (unchanged layout)
 * - Capacitor native (Android/iOS): full viewport, safe-area aware,
 *   initialises StatusBar + SplashScreen. Layout identical to the mobile
 *   browser so profile cards keep the exact same spacing/arrangement.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  const [native, setNative] = useState(false)
  // null = pre-hydration (SSR-safe default), then true/false per viewport
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isNative()) return
    // Defer state + side-effects to avoid cascading renders inside the effect body
    const t = setTimeout(() => {
      setNative(true)
      initStatusBar()
      hideSplashScreen()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // ─── Capacitor native: pure full-screen, safe-area aware ────────────────
  if (native) {
    return (
      <div
        className="w-full overflow-hidden bg-[var(--qk-bg)] text-white flex flex-col"
        style={{ height: '100dvh' }}
      >
        {/* Status-bar spacer — fills env(safe-area-inset-top) */}
        <div className="shrink-0 safe-area-top" />
        {/* App content — fills remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>
        {/* Home indicator spacer — fills env(safe-area-inset-bottom) */}
        <div className="shrink-0 safe-area-bottom" />
      </div>
    )
  }

  // ─── Web: single-mount shell ─────────────────────────────────────────────
  // One keyed app container: crossing the md breakpoint (or hydrating) only
  // swaps classes — the app is never remounted, so no duplicated API calls.
  return (
    <div className="min-h-screen w-full bg-black text-white relative overflow-hidden">
      {/* Ambient background gradient blobs (visible on desktop widths) */}
      <div className="hidden md:block pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[var(--qk-accent)]/15 blur-[100px]" />
      <div className="hidden md:block pointer-events-none absolute -bottom-40 -right-32 w-96 h-96 rounded-full bg-[var(--qk-purple)]/10 blur-[100px]" />
      <div className="hidden md:block pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[40%] rounded-full bg-[var(--qk-accent)]/5 blur-[120px]" />

      {/* Desktop (≥768px): full-window app — bigger screens.
          Mobile browser: definite 100dvh height so h-full chains resolve
          (min-h-screen alone collapses percentage-height children). */}
      <div
        key="qk-app"
        className={
          'w-full relative z-10 flex flex-col ' +
          (isDesktop ? 'h-screen' : 'h-[100dvh]')
        }
      >
        {children}
      </div>
    </div>
  )
}
