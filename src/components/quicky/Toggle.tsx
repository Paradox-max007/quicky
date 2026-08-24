'use client'

import { cn } from '@/lib/utils'

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200',
        value ? 'bg-[var(--qk-accent)]' : 'bg-white/10'
      )}
      role="switch"
      aria-checked={value}
      aria-label={label}
    >
      <span
        className={cn(
          'absolute left-0.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow-md',
          'transition-[translate] duration-200 ease-out',
          value ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}
