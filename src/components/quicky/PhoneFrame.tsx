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
 *
 * MOBILE VIEWPORT FIT (the "overflow on every page" fix): the shell is
 * EXACTLY one viewport tall — `h-screen` (100vh, legacy fallback) upgraded
 * to `100dvh` where supported. The previous `min-h-screen` (100vh = LARGE
 * viewport) on the outer div made the DOCUMENT taller than the visible
 * viewport whenever a mobile browser showed its URL bar (100vh > 100dvh),
 * so every page could be panned/offset sideways or vertically and had to be
 * scrolled back into place. An exact-height shell + the document overflow
 * lock (see `.qk-app-viewport` in globals.css, toggled below) means the
 * document NEVER scrolls — inner areas do.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  const [native, setNative] = useState(false)

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

  // Lock the DOCUMENT (html/body) while the app shell is mounted: the user
  // app is a fixed-viewport experience, so the page itself never pans
  // (rubber-banding, scroll-chaining, stray horizontal overflow are all
  // killed). Removed on unmount so /admin (its own document-scrolling shell)
  // is unaffected.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('qk-app-viewport')
    return () => root.classList.remove('qk-app-viewport')
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
  // One app container: the shell is EXACTLY the viewport height on every
  // platform (dvh where supported — URL-bar aware on mobile, == vh on
  // desktop), so the document is never taller/wider than the visible area
  // and can never be panned out of place. Children fill it with h-full
  // chains; everything scrollable lives INSIDE.
  return (
    <div className="h-screen supports-[height:100dvh]:h-[100dvh] w-full bg-black text-white relative overflow-hidden">
      {/* Ambient background gradient blobs (visible on desktop widths) */}
      <div className="hidden md:block pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[var(--qk-accent)]/15 blur-[100px]" />
      <div className="hidden md:block pointer-events-none absolute -bottom-40 -right-32 w-96 h-96 rounded-full bg-[var(--qk-purple)]/10 blur-[100px]" />
      <div className="hidden md:block pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[40%] rounded-full bg-[var(--qk-accent)]/5 blur-[120px]" />

      <div className="w-full h-full relative z-10 flex flex-col">
        {children}
      </div>
    </div>
  )
}
