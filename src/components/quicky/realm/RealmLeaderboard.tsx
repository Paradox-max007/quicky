'use client'

// Quicky — REALM LEADERBOARD (realm PRD §43)
// The viewer's OWN cohort (≤7 players, same realm). Top-3 rows visually
// flag promotion QUALIFICATION — but nobody is "promoted" until settlement
// actually runs (PRD: never mark a player as promoted before that).

import type { RealmLeaderboardRow } from '@/store/realm'

export function RealmLeaderboard({ rows, threshold }: { rows: RealmLeaderboardRow[]; threshold: number }) {
  if (rows.length === 0) {
    return <p className="text-xs font-semibold opacity-60 py-6 text-center">Your cohort is forming — send gifts to start climbing.</p>
  }
  return (
    <div className="flex flex-col gap-1" data-testid="realm-leaderboard">
      {rows.map((row) => (
        <div
          key={row.userId}
          className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 border ${
            row.isMe ? 'border-[color-mix(in_srgb,var(--qk-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--qk-accent)_12%,transparent)]' : 'border-white/10 bg-white/5'
          }`}
        >
          <span
            className={`w-6 text-center text-[12px] font-black tabular-nums ${
              row.rank <= 3 ? '' : 'opacity-60'
            }`}
            style={row.rank <= 3 ? { color: 'var(--qk-gold)' } : undefined}
          >
            {row.rank}
          </span>
          {row.avatar ? (
            <img src={row.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[13px] shrink-0" aria-hidden>
              👤
            </span>
          )}
          <p className="flex-1 min-w-0 truncate text-[12.5px] font-bold">
            {row.name}
            {row.isMe && <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--qk-accent)' }}>You</span>}
          </p>
          {row.rank <= 3 && row.cyclePoints >= threshold && (
            <span
              className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: 'color-mix(in srgb, var(--qk-gold) 22%, transparent)', color: 'var(--qk-gold)' }}
              title="Qualifies for promotion if the cycle ended now"
            >
              ▲ Top 3
            </span>
          )}
          <span className="text-[12.5px] font-black tabular-nums shrink-0">{row.cyclePoints.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
