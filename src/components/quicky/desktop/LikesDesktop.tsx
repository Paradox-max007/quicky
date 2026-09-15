'use client'

// Quicky — DESKTOP LIKES PAGE (Web Premium PRD §26-§29/§70)
// 3 cards per row on desktop (4 on very large screens), 2 in between —
// never placeholder cards just to complete a row. Card content stays honest:
// real photo, name/age, city, badges and timestamp (§28/§59 — no invented
// chemistry numbers).

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Lock, Crown, Heart, BadgeCheck, Check, MessageCircle, MapPin } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { cn } from '@/lib/utils'
import { timeAgo } from './useDashboard'
import { EmptyState, SectionHeader, SkeletonBlock } from './web-ui'

type LikedPerson = {
  id: string
  toUserId: string
  name: string | null
  age: number | null
  city: string | null
  photo: string | null
  isPremium: boolean
  isVerified: boolean
  superLike: boolean
  isMatch: boolean
  createdAt: string
}

type LikeYouPerson = {
  id: string
  fromUserId: string
  name: string | null
  age: number | null
  photo: string | null
  superLike: boolean
  viewedAt: string | null
  createdAt: string
}

function LikeCard({ children, onClick, testId }: { children: React.ReactNode; onClick?: () => void; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="qk-card-hover group relative w-full aspect-[3/4] rounded-3xl overflow-hidden bg-white/5 border border-white/8 text-left"
    >
      {children}
    </button>
  )
}

export function LikesDesktop() {
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const openProfile = useQuickyStore((s) => s.openProfile)
  const openChats = useQuickyStore((s) => s.openChats)
  const setActiveMatchId = useQuickyStore((s) => s.setActiveMatchId)

  const [likesYou, setLikesYou] = useState<LikeYouPerson[]>([])
  const [iLiked, setILiked] = useState<LikedPerson[]>([])
  const [isPremium, setIsPremium] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'likes-you' | 'i-liked'>('likes-you')
  const [matchIdByPartner, setMatchIdByPartner] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      const [lyRes, ilRes, mRes] = await Promise.all([api.likesYou(), api.iLiked(), api.matches()])
      setLikesYou(lyRes.likes)
      setIsPremium(lyRes.isPremium)
      setLockedCount(lyRes.lockedCount)
      setILiked(ilRes.liked)
      setFailed(false)
      useQuickyStore.getState().setUnviewedLikes(lyRes.unviewedCount ?? 0)
      // §28 "Message if applicable": a real match id per partner
      const map: Record<string, string> = {}
      for (const m of mRes.matches ?? []) map[m.partner.id] = m.id
      setMatchIdByPartner(map)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openDatingChat = (matchId: string) => {
    setActiveMatchId(matchId)
    openChats('dating')
  }

  if (loading) {
    return (
      <div data-testid="likes-skeleton">
        <div className="h-8 w-40 mb-6" aria-hidden>
          <SkeletonBlock className="h-8 w-40" />
        </div>
        <div className="grid grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="aspect-[3/4] rounded-3xl" />
          ))}
        </div>
      </div>
    )
  }

  if (failed && likesYou.length === 0 && iLiked.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-4xl" aria-hidden>💔</span>}
        title="We couldn't load your likes."
        body="Check your connection and try again."
        action={
          <button
            onClick={() => {
              setLoading(true)
              void refresh()
            }}
            className="bg-coral-gradient rounded-full px-5 py-2 text-sm font-semibold"
          >
            Try again
          </button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Likes</h1>
          <p className="text-sm text-white/50 mt-1">People who already said yes — and who you liked.</p>
        </div>
        <div className="flex gap-1 bg-white/5 rounded-full p-1" role="tablist" aria-label="Likes tabs">
          <button
            role="tab"
            aria-selected={tab === 'likes-you'}
            onClick={() => setTab('likes-you')}
            data-testid="likes-tab-liked-you"
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
              tab === 'likes-you' ? 'bg-coral-gradient text-white' : 'text-white/55 hover:text-white/80'
            )}
          >
            Likes You{likesYou.length > 0 ? ` (${likesYou.length})` : ''}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'i-liked'}
            onClick={() => setTab('i-liked')}
            data-testid="likes-tab-you-liked"
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
              tab === 'i-liked' ? 'bg-coral-gradient text-white' : 'text-white/55 hover:text-white/80'
            )}
          >
            You Liked{iLiked.length > 0 ? ` (${iLiked.length})` : ''}
          </button>
        </div>
      </header>

      {tab === 'likes-you' ? (
        likesYou.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-10 h-10 text-white/20" />}
            title="No likes yet"
            body="Keep your profile fresh and they'll come."
          />
        ) : !isPremium ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-3xl bg-gradient-to-r from-[var(--qk-accent)]/20 to-[var(--qk-purple)]/15 border border-[var(--qk-accent)]/30 p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-[var(--qk-accent)]/20 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5 text-[var(--qk-gold)]" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">{lockedCount} people like you</p>
                <p className="text-xs text-white/60">Unlock Premium to see who they are</p>
              </div>
              <button
                onClick={() => showPaywall({ kind: 'see_likes' })}
                className="bg-coral-gradient glow-coral rounded-full px-4 py-2 text-xs font-bold"
              >
                Unlock
              </button>
            </div>
            <div className="grid grid-cols-3 min-[1600px]:grid-cols-4 gap-5">
              {likesYou.slice(0, 8).map((l) => (
                <div key={l.id} className="relative aspect-[3/4] rounded-3xl overflow-hidden bg-white/5 border border-white/8">
                  {l.photo ? (
                    <img
                      src={l.photo}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      style={{ filter: 'blur(24px) brightness(0.5)', transform: 'scale(1.1)' }}
                    />
                  ) : (
                    <div className="absolute inset-0 animate-shimmer" />
                  )}
                  <div className="absolute inset-0 bg-black/50" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-[var(--qk-accent)]/30 backdrop-blur-md flex items-center justify-center border border-[var(--qk-accent)]/40">
                      <Lock className="w-6 h-6 text-[var(--qk-accent-light)]" />
                    </div>
                    <span className="text-xs font-bold text-white/80">?</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 min-[1600px]:grid-cols-4 gap-5" data-testid="likes-grid">
            {likesYou.map((l) => (
              <LikeCard
                key={l.id}
                testId={`likes-card-${l.fromUserId}`}
                onClick={() => openProfile(l.fromUserId, 'likes-you')}
              >
                {l.photo ? (
                  <img src={l.photo} alt={l.name ?? 'Photo'} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-white/20" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 pt-10 pb-3 px-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
                  <p className="text-sm font-bold truncate">
                    {l.name}, {l.age}
                  </p>
                  <p className="text-[10px] text-white/55 mt-0.5">
                    {l.superLike ? 'Super liked you · ' : ''}Liked you {l.createdAt ? timeAgo(l.createdAt) : ''}
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-coral-gradient text-[11px] font-bold px-3 py-1.5">
                    <Heart className="w-3 h-3" fill="currentColor" /> View &amp; Like Back
                  </span>
                </div>
              </LikeCard>
            ))}
          </div>
        )
      ) : iLiked.length === 0 ? (
        <EmptyState
          icon={<Heart className="w-10 h-10 text-white/20" />}
          title="No likes yet"
          body="Start swiping in Discover to like people."
        />
      ) : (
        <div className="grid grid-cols-3 min-[1600px]:grid-cols-4 gap-5" data-testid="likes-grid">
          {iLiked.map((l) => {
            const matchId = l.isMatch ? matchIdByPartner[l.toUserId] : undefined
            return (
              <div key={l.id} className="flex flex-col gap-2">
                <LikeCard testId={`likes-card-${l.toUserId}`} onClick={() => openProfile(l.toUserId, 'likes-you')}>
                  {l.photo ? (
                    <img src={l.photo} alt={l.name ?? 'Photo'} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Heart className="w-8 h-8 text-white/20" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 top-0 p-2.5 flex justify-between">
                    {l.isMatch ? (
                      <span className="flex items-center gap-0.5 bg-[var(--qk-accent)] rounded-full px-2 py-0.5 text-[10px] font-bold text-white">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} /> MATCH
                      </span>
                    ) : (
                      <span />
                    )}
                    {l.superLike && (
                      <span className="flex items-center gap-0.5 bg-[var(--qk-purple)]/40 backdrop-blur-md rounded-full px-2 py-0.5 text-[10px] font-bold text-white">
                        <Sparkles className="w-2.5 h-2.5" /> SUPER
                      </span>
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 pt-10 pb-3 px-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-bold truncate">
                        {l.name}, {l.age}
                      </p>
                      {l.isVerified && (
                        <BadgeCheck className="w-3.5 h-3.5 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="white" />
                      )}
                    </div>
                    {l.city && (
                      <p className="text-[10px] text-white/60 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5" /> {l.city}
                      </p>
                    )}
                    <p className="text-[10px] text-white/50 mt-0.5">Liked {l.createdAt ? timeAgo(l.createdAt) : ''}</p>
                  </div>
                </LikeCard>
                {/* §28: Message if applicable — a real mutual match */}
                {l.isMatch && matchId && (
                  <button
                    onClick={() => openDatingChat(matchId)}
                    className="flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white/85 hover:bg-white/10 transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Message
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-white/30">
        {tab === 'likes-you' ? 'Tap a card to view their profile and like back.' : 'Tap a card to view the profile.'}
      </p>
    </div>
  )
}
