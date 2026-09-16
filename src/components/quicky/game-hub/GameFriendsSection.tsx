'use client'

// Quicky — MY FRIENDS on the game landing (refactor PRD §26/§27/§83)
// Shared section used by BOTH landings (generic GameLanding + the rich Spin
// the Bottle landing). Every friend provides Chat + Profile (§26); the list
// is the real friendship table via GET /friends (§80). Honest loading /
// empty states (§83) — never a blank panel.
import { useEffect, useState } from 'react'
import { MessageCircle, UserRound } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore, type AppView } from '@/store/quicky'

export function GameFriendsSection({ returnView }: { returnView: AppView }) {
  const openGameChat = useQuickyStore((s) => s.openGameChat)
  const openProfile = useQuickyStore((s) => s.openProfile)
  const [friends, setFriends] = useState<any[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.friends
      .list()
      .then((res) => {
        if (!cancelled) setFriends(res.friends ?? [])
      })
      .catch(() => {
        if (!cancelled) setFriends([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section data-testid="game-friends">
      <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">My Friends</p>
      {friends === null ? (
        <div className="flex gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-16 h-20 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : friends.length === 0 ? (
        <p className="text-xs text-white/40 bg-[var(--qk-card)]/60 border border-white/8 rounded-2xl px-4 py-3">
          No friends yet — tap a player at the table and choose Add Friend.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
          {friends.map((f) => (
            <div
              key={f.id}
              className="shrink-0 w-20 rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 p-2 flex flex-col items-center gap-1.5"
            >
              {f.photo ? (
                <img src={f.photo} alt={f.name ?? 'Friend'} className="w-11 h-11 rounded-full object-cover" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-[var(--qk-accent)]/20 flex items-center justify-center text-sm font-black text-[var(--qk-accent-light)]">
                  {(f.name ?? '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <p className="text-[11px] font-bold truncate w-full text-center">{f.name ?? 'Player'}</p>
              <div className="flex gap-1">
                <button
                  onClick={() =>
                    openGameChat(
                      { peerUserId: f.id, peerName: f.name ?? null, peerAvatar: f.photo ?? null },
                      returnView,
                    )
                  }
                  className="flex-1 h-7 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center"
                  aria-label={`Chat with ${f.name ?? 'friend'}`}
                  title="Chat"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-white/80" />
                </button>
                <button
                  onClick={() => openProfile(f.id, returnView)}
                  className="flex-1 h-7 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center"
                  aria-label={`View ${f.name ?? 'friend'}'s profile`}
                  title="Profile"
                >
                  <UserRound className="w-3.5 h-3.5 text-white/80" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
