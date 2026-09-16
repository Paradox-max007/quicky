'use client'

// Quicky — GAMES FILTER BAR (refactor PRD §89)
// [ All ] [ Party ] [ 2 Player ] [ Coming Soon ] — the hub feels like
// Quicky's game hub, not one game's page. Chip styling follows the app's
// pill language; active chip uses the accent gradient.
import { LayoutGrid, Users, HeartHandshake, Clock } from 'lucide-react'

export type GamesFilter = 'all' | 'party' | 'two' | 'soon'

const CHIPS: { id: GamesFilter; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { id: 'party', label: 'Party', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'two', label: '2 Player', icon: <HeartHandshake className="w-3.5 h-3.5" /> },
  { id: 'soon', label: 'Coming Soon', icon: <Clock className="w-3.5 h-3.5" /> },
]

export function GamesFilterBar({
  value,
  onChange,
}: {
  value: GamesFilter
  onChange: (f: GamesFilter) => void
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-3" data-testid="games-filters">
      {CHIPS.map((c) => {
        const active = value === c.id
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            aria-pressed={active}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors ${
              active
                ? 'bg-coral-gradient text-white'
                : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
            }`}
          >
            {c.icon}
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
