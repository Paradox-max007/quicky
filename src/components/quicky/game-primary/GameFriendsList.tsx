'use client'

// Quicky — GAME FRIENDS LIST (Unified Game Primary Screen PRD §15/§16/§25/§35)
//
// ONE shared friends list for BOTH surfaces:
//   · Web — inside the GameInteractionPanel (§25: Friends in the same
//     interaction area, no page navigation)
//   · Capacitor — inside the dedicated GameFriendsScreen (§15/§16)
//
// §35: the list comes from the EXISTING friendship system (GET /friends) —
// no separate game_friends table, no new relationship logic. Every row
// provides the two §16 actions: 👤 Profile and 💬 Chat. Loading / error /
// empty states follow PRD §49/§50/§51 (skeleton, Try again, honest copy).

import { useEffect, useState } from 'react'
import { MessageCircle, Search, UserRound } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'

export type GameFriendRow = {
  id: string
  name: string | null
  age: number | null
  city: string | null
  isPremium: boolean
  isVerified: boolean
  lastActiveAt: string | null
  photo: string | null
}

/** Presence (§53: online/offline "if already implemented" — lastActiveAt IS
 * the existing presence signal, so derive a soft online state from it). */
export function friendOnline(f: GameFriendRow): boolean {
  if (!f.lastActiveAt) return false
  return Date.now() - new Date(f.lastActiveAt).getTime() < 2 * 60 * 1000
}

export function GameFriendsList({
  onOpenProfile,
  onOpenChat,
  testIdPrefix = 'game-friends',
}: {
  onOpenProfile: (friend: GameFriendRow) => void
  onOpenChat: (friend: GameFriendRow) => void
  testIdPrefix?: string
}) {
  const [friends, setFriends] = useState<GameFriendRow[] | null>(null) // null = loading
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  // Retry bumps this key → the fetch effect re-runs (setState stays in the
  // event handler, never synchronously inside the effect body).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    api.friends.list()
      .then((res) => {
        if (!cancelled) setFriends((res.friends ?? []) as GameFriendRow[])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = () => {
    setFailed(false)
    setFriends(null)
    setReloadKey((k) => k + 1)
  }

  const q = query.trim().toLowerCase()
  const filtered = friends && q ? friends.filter((f) => (f.name ?? 'player').toLowerCase().includes(q)) : friends

  return (
    <div className="h-full w-full flex flex-col min-h-0" data-testid={testIdPrefix}>
      {/* Search (§16: "Search Friends") */}
      <div className="shrink-0 px-3 pt-2.5 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-white/35 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search friends"
            aria-label="Search friends"
            className="w-full bg-white/5 border border-white/10 rounded-full pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-white/25"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        {/* §49/§50: loading skeleton, never a blank area */}
        {failed ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="text-3xl" aria-hidden>👥</span>
            <p className="text-white/55 text-xs">Unable to load friends</p>
            <button
              onClick={retry}
              className="mt-1 bg-coral-gradient rounded-full px-5 py-2 text-xs font-black active:scale-95 transition-transform"
            >
              Try again
            </button>
          </div>
        ) : friends === null ? (
          <div className="flex flex-col gap-2 px-1 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-white/10" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="h-3 w-24 rounded bg-white/10" />
                  <div className="h-2.5 w-16 rounded bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : friends.length === 0 ? (
          /* §51 empty state — no invented friend functionality */
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="text-3xl" aria-hidden>👥</span>
            <p className="text-white/80 text-sm font-bold">No friends yet</p>
            <p className="text-white/50 text-xs leading-relaxed">Add people you meet on Quicky.</p>
          </div>
        ) : (filtered ?? []).length === 0 ? (
          <div className="h-full flex items-center justify-center px-6">
            <p className="text-white/45 text-xs">No friends match “{query.trim()}”.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {(filtered ?? []).map((f) => {
              const online = friendOnline(f)
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors"
                  data-testid={`${testIdPrefix}-row-${f.id}`}
                >
                  <span className="relative shrink-0">
                    {f.photo ? (
                      <img src={f.photo} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <span className="w-10 h-10 rounded-full bg-[var(--qk-accent)]/20 flex items-center justify-center text-sm font-black text-[var(--qk-accent-light)]">
                        {(f.name ?? '?').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--qk-bg)] ${online ? 'bg-[#30D158]' : 'bg-white/25'}`}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-white text-sm font-semibold truncate">{f.name ?? 'Player'}</span>
                    <span className={`block text-[11px] ${online ? 'text-[#30D158]' : 'text-white/40'}`}>
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </span>
                  {/* §16: per-row 👤 Profile + 💬 Chat actions */}
                  <button
                    onClick={() => onOpenProfile(f)}
                    className="w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center active:scale-95 transition-transform"
                    aria-label={`View ${f.name ?? 'friend'}'s profile`}
                    data-testid={`${testIdPrefix}-profile-${f.id}`}
                  >
                    <UserRound className="w-4 h-4 text-white/80" />
                  </button>
                  <button
                    onClick={() => onOpenChat(f)}
                    className="w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center active:scale-95 transition-transform"
                    aria-label={`Chat with ${f.name ?? 'friend'}`}
                    data-testid={`${testIdPrefix}-chat-${f.id}`}
                  >
                    <MessageCircle className="w-4 h-4 text-[var(--qk-accent-light)]" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
