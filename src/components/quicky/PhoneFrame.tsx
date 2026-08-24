'use client'

import { ReactNode, useEffect, useState } from 'react'
import { QuickyBrand } from './brand'
import { isNative, initStatusBar, hideSplashScreen } from '@/lib/capacitor'

/**
 * PhoneFrame — wraps the app in a portrait phone shell on desktop,
 * goes full-screen on mobile AND in Capacitor native apps.
 *
 * - Desktop (web): centered 390x844 card with notch indicator + side buttons
 * - Mobile browser (web): full viewport
 * - Capacitor native (Android/iOS): full viewport, initialises StatusBar + SplashScreen
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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white relative overflow-hidden">
      {/* Ambient background gradient blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[var(--qk-accent)]/15 blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 w-96 h-96 rounded-full bg-[var(--qk-purple)]/10 blur-[100px]" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[40%] rounded-full bg-[var(--qk-accent)]/5 blur-[120px]" />

      {/* Desktop layout: phone frame */}
      <div className="hidden md:flex flex-row items-center gap-12 p-8 relative z-10">
        {/* Side branding panel */}
        <div className="max-w-md flex flex-col gap-6 pr-8">
          <QuickyBrand size="lg" />
          <h1 className="text-5xl font-bold tracking-tight leading-tight">
            Instant sparks.
            <br />
            <span className="text-gradient-coral">Real connections.</span>
          </h1>
          <p className="text-white/60 text-lg leading-relaxed">
            A premium dating experience with disappearing Quickies, streaks, and exclusive games for Premium members.
            Built end-to-end from your PRD.
          </p>
          <div className="flex flex-col gap-2 text-sm text-white/50">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-accent)]" />
              Phone OTP + Quicky disappearing media + Score
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-gold)]" />
              Premium paywalls, Truth or Dare, See Who Liked You
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-purple)]" />
              Dark premium UI, portrait phone frame
            </div>
          </div>
        </div>

        {/* Phone frame */}
        <div className="relative">
          {/* Side buttons */}
          <div className="absolute -left-1 top-32 w-1 h-8 rounded-l bg-white/10" />
          <div className="absolute -left-1 top-44 w-1 h-12 rounded-l bg-white/10" />
          <div className="absolute -left-1 top-60 w-1 h-12 rounded-l bg-white/10" />
          <div className="absolute -right-1 top-40 w-1 h-16 rounded-r bg-white/10" />

          {/* Phone body */}
          <div className="phone-frame-radius phone-shadow bg-[var(--qk-bg)] border border-white/5 relative overflow-hidden" style={{ width: 390, height: 844 }}>
            {/* Notch / Dynamic Island */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-7 bg-black rounded-full z-50 flex items-center justify-end px-2">
              <div className="w-2 h-2 rounded-full bg-white/10" />
            </div>
            {/* Status bar */}
            <div className="absolute top-0 left-0 right-0 h-11 z-40 flex items-center justify-between px-6 text-xs text-white/80 font-medium">
              <span>9:41</span>
              <span className="opacity-0">spacer</span>
              <span className="flex items-center gap-1">
                <span>{'\u{1F4F6}'}</span>
                <span>{'\u{1F50B}'}</span>
              </span>
            </div>
            {/* App content */}
            <div className="absolute inset-0 pt-11 overflow-hidden">
              {children}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile browser layout: full screen */}
      <div className="md:hidden w-full min-h-screen relative z-10">
        {children}
      </div>
    </div>
  )
}
