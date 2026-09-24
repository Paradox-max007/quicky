'use client'

// Quicky — GLOBAL ERROR BOUNDARY (last-resort net above the root layout)
//
// Catches errors that escape src/app/error.tsx (root-layout / provider
// level). Required to render its own <html>/<body>. Like error.tsx it NEVER
// reloads the page — the reload-based recovery is what created the
// "redirect to Discover" loop on mobile.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[quicky] global render error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b10',
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '360px',
            width: '100%',
            borderRadius: '24px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            padding: '28px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <span style={{ fontSize: '28px' }} aria-hidden>
            ⚠️
          </span>
          <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: '13px', opacity: 0.6, margin: 0, lineHeight: 1.5 }}>
            The app hit an unexpected error. Your session is safe — nothing was lost.
          </p>
          <button
            onClick={reset}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(90deg, #FF6B5E, #FF3B30)',
              color: '#fff',
              fontWeight: 800,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
