'use client'

// Quicky — WEB PREMIUM shared page primitives (Web Premium PRD §45-§53/§79-§80).
// One design system for every desktop page: the same shell, the same section
// headers, the same loading/error/empty language. Pages never hand-roll their
// own spacing or chrome — the shell owns max-width (§47), page height (§48)
// and the page-entrance animation (§49).

import { ReactNode } from 'react'

/** §47/§48/§49: responsive container + full-height page + fast entrance. */
export function WebPageShell({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="w-full h-full overflow-y-auto qk-desk-scroll" data-testid={testId}>
      <div className="qk-page-enter max-w-[1600px] w-full mx-auto px-8 min-[1600px]:px-12 py-6 pb-12">
        {children}
      </div>
    </div>
  )
}

/** §23/§45: consistent section header — one visual language everywhere. */
export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={'flex items-center justify-between mb-4 ' + (className ?? '')}>
      <h2 className="text-[11px] font-bold tracking-[0.18em] text-white/40 uppercase">{title}</h2>
      {action}
    </div>
  )
}

/** §54: intentional empty state — never a blank area. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-14">
      {icon ?? null}
      <h3 className="font-bold text-white/90">{title}</h3>
      {body && <p className="text-sm text-white/50 mt-1 max-w-[42ch] leading-relaxed">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** §54/§55: intentional error state with retry — never a black screen. */
export function ErrorState({
  title,
  body,
  onRetry,
  testId,
}: {
  title: string
  body?: string
  onRetry: () => void
  testId?: string
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-8 py-14"
      data-testid={testId}
    >
      <span className="text-4xl mb-3" aria-hidden>
        ⚠️
      </span>
      <h3 className="font-bold text-white/90">{title}</h3>
      {body && <p className="text-sm text-white/50 mt-1 max-w-[42ch]">{body}</p>}
      <button
        onClick={onRetry}
        className="mt-4 bg-coral-gradient rounded-full px-5 py-2 text-sm font-semibold active:scale-95 transition-transform"
      >
        Try again
      </button>
    </div>
  )
}

/** §53: skeleton loading — never a blank/white area while waiting. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={'animate-shimmer rounded-xl bg-white/5 ' + (className ?? '')} aria-hidden />
}

export function SkeletonLines({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={'flex flex-col gap-2.5 ' + (className ?? '')} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} className={i === rows - 1 ? 'h-4 w-2/5' : 'h-4 w-full'} />
      ))}
    </div>
  )
}
