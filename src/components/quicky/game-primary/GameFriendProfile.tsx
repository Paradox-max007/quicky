'use client'

// Quicky — GAME FRIEND PROFILE (Web interaction area) — PRD §26/§27
//
// The friend-profile content INSIDE the GameInteractionPanel on web. Clicking
// 👤 on a friend does NOT navigate away (§26) — the Friends list content in
// the same area is replaced by this profile; "← Friends" restores the list
// (§27). Uses the EXISTING public-profile API and the EXISTING personal
// messaging entry path — no new profile or messaging backend (§34/§35).

import { useEffect, useState } from 'react'
import { MessageCircle, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { Skeleton } from '@/components/ui/skeleton'

export function GameFriendProfile({
  friendId,
  fallbackName,
  fallbackPhoto,
  onBack,
  onMessage,
}: {
  friendId: string
  fallbackName: string | null
  fallbackPhoto: string | null
  onBack: () => void
  onMessage: (peer: { peerUserId: string; peerName: string | null; peerAvatar: string | null }) => void
}) {
  const [profile, setProfile] = useState<any | null>(null)
  const [failed, setFailed] = useState(false)
  // Retry bumps this key → the effect re-runs (no setState in effect body).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    api.profile(friendId)
      .then((res) => {
        if (!cancelled) setProfile(res?.profile ?? null)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [friendId, reloadKey])

  const name = profile?.name ?? fallbackName ?? 'Player'
  const photo =
    profile?.photos?.find((p: any) => p.isPrimary)?.url ?? profile?.photos?.[0]?.url ?? fallbackPhoto ?? null

  return (
    <div className="h-full w-full flex flex-col min-h-0" data-testid="panel-friend-profile">
      {/* Header (§26): ← Friends — back restores the Friends list */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-white/10">
        <button
          onClick={onBack}
          className="text-xs font-bold text-white/60 hover:text-white px-2.5 py-1.5 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Back to friends"
        >
          ← Friends
        </button>
        <p className="font-black text-sm text-white truncate">{name}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {/* §49: reuse-style loading state — skeleton, never blank */}
        {failed ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
            <span className="text-3xl" aria-hidden>👤</span>
            <p className="text-white/55 text-xs">Unable to load profile</p>
            <button
              onClick={() => {
                setFailed(false)
                setProfile(null)
                setReloadKey((k) => k + 1)
              }}
              className="mt-1 bg-coral-gradient rounded-full px-5 py-2 text-xs font-black active:scale-95 transition-transform"
            >
              Try again
            </button>
          </div>
        ) : !profile ? (
          <div className="flex flex-col items-center gap-3 pt-4">
            <Skeleton className="w-20 h-20 rounded-full bg-white/10" />
            <Skeleton className="w-32 h-4 rounded bg-white/10" />
            <Skeleton className="w-40 h-3 rounded bg-white/5" />
            <Skeleton className="w-full h-16 rounded-2xl bg-white/5 mt-3" />
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-2">
            <span className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--qk-accent)]/50 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center">
              {photo ? (
                <img src={photo} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-black text-white">{name.slice(0, 1).toUpperCase()}</span>
              )}
            </span>
            <p className="text-lg font-black flex items-center gap-1.5">
              {name}
              {profile.isVerified && <ShieldCheck className="w-4 h-4 text-[#30D158]" aria-label="Verified" />}
            </p>
            {(profile.age != null || profile.city) && (
              <p className="text-xs text-white/50">
                {[profile.age != null ? `${profile.age}` : null, profile.city].filter(Boolean).join(' · ')}
              </p>
            )}
            {profile.bio && <p className="text-xs text-white/65 leading-relaxed mt-1 max-w-[38ch]">{profile.bio}</p>}
            {Array.isArray(profile.interests) && profile.interests.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                {profile.interests.slice(0, 6).map((it: string) => (
                  <span key={it} className="text-[10px] font-semibold bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                    {it}
                  </span>
                ))}
              </div>
            )}

            {/* §26: Message — opens the personal chat in the Game Chat area */}
            <button
              onClick={() => onMessage({ peerUserId: friendId, peerName: profile.name ?? fallbackName, peerAvatar: photo })}
              className="mt-4 flex items-center gap-2 bg-coral-gradient glow-coral rounded-full px-8 py-3 text-sm font-black active:scale-95 transition-transform"
              data-testid="panel-friend-profile-message"
            >
              <MessageCircle className="w-4 h-4" /> Message
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
