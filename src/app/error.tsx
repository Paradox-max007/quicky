'use client'

// Quicky — ROOT ERROR BOUNDARY (the reload-loop killer)
//
// Next.js App Router WITHOUT an error boundary: an uncaught error during a
// client render unmounts the whole React tree and the router recovers by
// RELOADING THE PAGE — which re-boots the SPA straight back to Discover
// (and, if the same screen throws again, loops: reload → Discover → crash →
// reload…). That is exactly the "keeps getting redirected to the discover
// page" behavior reported on mobile web.
//
// WITH this boundary the tree never unmounts: the user gets a calm,
// on-brand error card with two ways out —
//   · Try again     → reset() re-renders the SAME screen (transient errors
//                     — a poll race, a null blip in fresh data — recover
//                     immediately)
//   · Back to Discover → clears the saved session view and resets, so a
//                     persistent error lands somewhere guaranteed safe.
//
// It must NEVER auto-navigate or auto-reload: both are what caused the
// original loop.

import { useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { clearPersistedViewState } from '@/lib/quicky/view-restore'

/** Drop warm API-response caches that may carry the row that crashed the
 *  render (stale-while-revalidate would re-paint the same bad shape on the
 *  retry and crash again — the loop the boundary exists to break). */
function dropWarmCaches() {
  try {
    localStorage.removeItem('qk:discovery_cache_v1')
    localStorage.removeItem('qk_discovery_cache_v1') // legacy key
  } catch {}
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface it in the console for debugging (production users still get
    // the card — never a blank/reloading page).
    console.error('[quicky] render error:', error)
    dropWarmCaches()
  }, [error])

  const backToDiscover = () => {
    try {
      useQuickyStore.getState().setView('discovery')
    } catch {}
    clearPersistedViewState()
    reset()
  }

  return (
    <div
      className="w-full h-full flex items-center justify-center bg-[var(--qk-bg)] text-white px-6"
      data-testid="app-error-boundary"
    >
      <div className="max-w-sm w-full rounded-3xl border border-white/10 bg-[var(--qk-card)] p-6 flex flex-col items-center gap-4 text-center shadow-2xl">
        <span className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-2xl" aria-hidden>
          ⚠️
        </span>
        <div>
          <h1 className="text-lg font-black tracking-wide">Something went wrong</h1>
          <p className="text-white/60 text-sm mt-1 font-medium">
            The app hit an unexpected error on this screen. Your session is safe — nothing was lost.
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={reset}
            className="w-full bg-coral-gradient glow-coral rounded-xl px-4 py-3 text-sm font-black tracking-wide active:scale-95 transition"
            data-testid="app-error-retry"
          >
            Try again
          </button>
          <button
            onClick={backToDiscover}
            className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white/80 active:scale-95 transition"
            data-testid="app-error-home"
          >
            Back to Discover
          </button>
        </div>
      </div>
    </div>
  )
}
