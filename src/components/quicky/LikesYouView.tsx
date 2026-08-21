'use client'

import { useEffect, useState, useCallback } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { Sparkles, Lock, Crown, Heart, BadgeCheck, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  createdAt: string
}

export function LikesYouView() {
  const user = useQuickyStore((s) => s.user)
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const openProfile = useQuickyStore((s) => s.openProfile)

  const [iLiked, setILiked] = useState<LikedPerson[]>([])
  const [likesYou, setLikesYou] = useState<LikeYouPerson[]>([])
  const [isPremium, setIsPremium] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'likes-you' | 'i-liked'>('likes-you')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [lyRes, ilRes] = await Promise.all([api.likesYou(), api.iLiked()])
      setLikesYou(lyRes.likes)
      setIsPremium(lyRes.isPremium)
      setLockedCount(lyRes.lockedCount)
      setILiked(ilRes.liked)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white">
      <header className="shrink-0 px-5 pt-3 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">Likes</h1>
      </header>

      {/* Tabs */}
      <div className="shrink-0 px-5 pb-3">
        <div className="flex gap-1 bg-white/5 rounded-full p-1">
          <button
            onClick={() => setTab('likes-you')}
            className={cn(
              'flex-1 rounded-full py-2 text-sm font-semibold transition-all',
              tab === 'likes-you'
                ? 'bg-coral-gradient text-white'
                : 'text-white/60'
            )}
          >
            Likes You {likesYou.length > 0 && (
              <span className={cn(
                'ml-1 text-xs',
                tab === 'likes-you' ? 'text-white/80' : 'text-white/40'
              )}>
                ({likesYou.length})
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('i-liked')}
            className={cn(
              'flex-1 rounded-full py-2 text-sm font-semibold transition-all',
              tab === 'i-liked'
                ? 'bg-coral-gradient text-white'
                : 'text-white/60'
            )}
          >
            You Liked {iLiked.length > 0 && (
              <span className={cn(
                'ml-1 text-xs',
                tab === 'i-liked' ? 'text-white/80' : 'text-white/40'
              )}>
                ({iLiked.length})
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
          </div>
        ) : tab === 'likes-you' ? (
          <LikesYouSection
            likesYou={likesYou}
            isPremium={isPremium}
            lockedCount={lockedCount}
            onUnlock={() => showPaywall({ kind: 'see_likes' })}
            onViewProfile={(userId) => openProfile(userId)}
          />
        ) : (
          <ILikedSection
            liked={iLiked}
            onViewProfile={(userId) => openProfile(userId)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Section 1: Likes You (premium-gated with strong blur) ──────────────────

function LikesYouSection({
  likesYou,
  isPremium,
  lockedCount,
  onUnlock,
  onViewProfile,
}: {
  likesYou: LikeYouPerson[]
  isPremium: boolean
  lockedCount: number
  onUnlock: () => void
  onViewProfile: (userId: string) => void
}) {
  if (likesYou.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Sparkles className="w-12 h-12 text-white/20 mb-3" />
        <h2 className="text-lg font-semibold">No likes yet</h2>
        <p className="text-white/50 text-sm mt-1">Keep your profile fresh and they'll come.</p>
      </div>
    )
  }

  // Free user: show all cards heavily blurred with a single unlock CTA overlay
  if (!isPremium) {
    return (
      <div className="flex flex-col gap-3">
        {/* Premium upsell banner */}
        <div className="rounded-2xl bg-gradient-to-r from-[#FF2D55]/20 to-[#B8A4FF]/15 border border-[#FF2D55]/30 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FF2D55]/20 flex items-center justify-center shrink-0">
            <Crown className="w-5 h-5 text-[#F5C570]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{lockedCount} people like you</p>
            <p className="text-xs text-white/60">Unlock Premium to see who they are</p>
          </div>
          <button
            onClick={onUnlock}
            className="bg-coral-gradient glow-coral rounded-full px-3 py-1.5 text-xs font-semibold shrink-0"
          >
            Unlock
          </button>
        </div>

        {/* Blurred grid — strong blur, no silhouette visible */}
        <ul className="grid grid-cols-2 gap-2">
          {likesYou.slice(0, 6).map((l) => (
            <li
              key={l.id}
              className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-white/5 border border-white/8"
            >
              {l.photo ? (
                <img
                  src={l.photo}
                  alt=""
                  className="w-full h-full object-cover"
                  style={{ filter: 'blur(24px) brightness(0.5)', transform: 'scale(1.1)' }}
                />
              ) : (
                <div className="absolute inset-0 animate-shimmer" />
              )}
              {/* Strong dark overlay on top of blur */}
              <div className="absolute inset-0 bg-black/50" />
              {/* Lock + question mark */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <div className="w-12 h-12 rounded-full bg-[#FF2D55]/30 backdrop-blur-md flex items-center justify-center border border-[#FF2D55]/40">
                  <Lock className="w-6 h-6 text-[#FF5E7E]" />
                </div>
                <span className="text-xs font-bold text-white/80">?</span>
              </div>
            </li>
          ))}
        </ul>

        {/* Big unlock CTA at bottom */}
        <button
          onClick={onUnlock}
          className="w-full bg-gradient-to-r from-[#FF2D55] to-[#FF5E7E] glow-coral rounded-2xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mt-2"
        >
          <Crown className="w-4 h-4" fill="currentColor" stroke="none" />
          Unlock {lockedCount} {lockedCount === 1 ? 'person' : 'people'}
        </button>
      </div>
    )
  }

  // Premium user: show full photos, no blur
  return (
    <ul className="grid grid-cols-2 gap-2">
      {likesYou.map((l) => (
        <li key={l.id}>
          <button
            onClick={() => onViewProfile(l.fromUserId)}
            className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-white/5 border border-white/8 active:scale-[0.97] transition-transform"
          >
            {l.photo ? (
              <img src={l.photo} alt={l.name ?? 'Photo'} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-white/20" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
            {l.superLike && (
              <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-[#B8A4FF]/30 backdrop-blur-md rounded-full px-2 py-0.5">
                <Sparkles className="w-2.5 h-2.5 text-[#B8A4FF]" />
                <span className="text-[10px] font-bold text-[#B8A4FF]">SUPER</span>
              </div>
            )}
            <div className="absolute bottom-2 left-2 right-2">
              <p className="text-xs font-semibold truncate">
                {l.name}, {l.age}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ─── Section 2: You Liked (visible to all, no blur) ─────────────────────────

function ILikedSection({
  liked,
  onViewProfile,
}: {
  liked: LikedPerson[]
  onViewProfile: (userId: string) => void
}) {
  if (liked.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Heart className="w-12 h-12 text-white/20 mb-3" />
        <h2 className="text-lg font-semibold">No likes yet</h2>
        <p className="text-white/50 text-sm mt-1">Start swiping in Discover to like people.</p>
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-2 gap-2">
      {liked.map((l) => (
        <li key={l.id}>
          <button
            onClick={() => onViewProfile(l.toUserId)}
            className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-white/5 border border-white/8 active:scale-[0.97] transition-transform"
          >
            {l.photo ? (
              <img src={l.photo} alt={l.name ?? 'Photo'} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Heart className="w-8 h-8 text-white/20" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

            {/* Match badge */}
            {l.isMatch && (
              <div className="absolute top-2 left-2 flex items-center gap-0.5 bg-[#FF2D55] rounded-full px-2 py-0.5">
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                <span className="text-[10px] font-bold text-white">MATCH</span>
              </div>
            )}

            {/* Super like badge */}
            {l.superLike && (
              <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-[#B8A4FF]/30 backdrop-blur-md rounded-full px-2 py-0.5">
                <Sparkles className="w-2.5 h-2.5 text-[#B8A4FF]" />
                <span className="text-[10px] font-bold text-[#B8A4FF]">SUPER</span>
              </div>
            )}

            <div className="absolute bottom-2 left-2 right-2">
              <div className="flex items-center gap-1">
                <p className="text-xs font-semibold truncate">
                  {l.name}, {l.age}
                </p>
                {l.isVerified && (
                  <BadgeCheck className="w-3 h-3 text-[#FF2D55]" fill="currentColor" stroke="white" />
                )}
              </div>
              {l.city && (
                <p className="text-[10px] text-white/50 truncate">{l.city}</p>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
