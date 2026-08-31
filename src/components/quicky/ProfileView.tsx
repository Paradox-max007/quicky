'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { ArrowLeft, BadgeCheck, Crown, MapPin, Sparkles, Lock, ChevronLeft, ChevronRight, Heart, MessageCircle, Check } from 'lucide-react'
import { getScoreTier } from '@/lib/quicky/constants'
import { ProfilePostsGrid } from './ProfilePostsGrid'
import { cn } from '@/lib/utils'
import useEmblaCarousel from 'embla-carousel-react'

// Free users can view this many photos on a profile
const FREE_PHOTO_LIMIT = 3

export function ProfileView() {
  const userId = useQuickyStore((s) => s.activeProfileUserId)
  const currentUser = useQuickyStore((s) => s.user)
  const setView = useQuickyStore((s) => s.setView)
  const returnView = useQuickyStore((s) => s.profileReturnView)
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const showMatchCelebration = useQuickyStore((s) => s.showMatchCelebration)
  const [profile, setProfile] = useState<any | null>(null)
  const [relationship, setRelationship] = useState<{ hasMatch: boolean; matchId: string | null; theyLikedMe: boolean; superLike: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [liking, setLiking] = useState(false)
  const [dmText, setDmText] = useState('')
  const [dmSending, setDmSending] = useState(false)

  const viewerIsPremium = currentUser?.isPremium ?? false
  const allPhotos: any[] = profile?.photos ?? []
  const visibleCount = viewerIsPremium ? allPhotos.length : Math.min(allPhotos.length, FREE_PHOTO_LIMIT)
  const lockedCount = allPhotos.length - visibleCount

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, dragFree: false })

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIdx(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    emblaApi.on('select', onSelect)
    return () => { emblaApi.off('select', onSelect) }
  }, [emblaApi, onSelect])

  const scrollTo = (idx: number) => {
    if (idx >= visibleCount && !viewerIsPremium) {
      showPaywall({ kind: 'generic' })
      return
    }
    emblaApi?.scrollTo(idx)
  }

  useEffect(() => {
    if (!userId) return
    ;(async () => {
      try {
        const res = await api.profile(userId)
        setProfile(res.profile)
        setRelationship(res.relationship ?? null)
      } catch (e: any) {
        toast.error(e.message ?? 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    })()
  }, [userId])

  // PRD §3.1: opening a liker's profile FROM the Likes page is the only path
  // that clears that like's badge entry. The swipeId is stashed by the Likes
  // list right before navigating here.
  useEffect(() => {
    if (!userId || returnView !== 'likes-you') return
    let swipeId: string | null = null
    try {
      swipeId = sessionStorage.getItem(`qk_like_view_${userId}`)
    } catch {}
    if (!swipeId) return
    try { sessionStorage.removeItem(`qk_like_view_${userId}`) } catch {}
    useQuickyStore.setState((s) => ({ unviewedLikes: Math.max(0, s.unviewedLikes - 1) }))
    api.markLikeViewed(swipeId).catch(() => {})
  }, [userId, returnView])

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--qk-bg)]">
        <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!profile) return null

  const tier = getScoreTier(profile.quickyScore ?? 0)
  const isMe = profile.id === currentUser?.id

  // Like back — instant match when they already liked you
  const likeBack = async () => {
    if (!userId || liking) return
    setLiking(true)
    try {
      const res = await api.swipe(userId, 'like')
      if (res.match) {
        showMatchCelebration({
          matchId: res.match.id,
          partnerId: userId,
          partnerName: profile.name,
          partnerPhoto: profile.photos?.[0]?.url ?? null,
        })
        setRelationship((r) => (r ? { ...r, hasMatch: true, matchId: res.match!.id, theyLikedMe: false } : r))
      } else {
        toast.success('Like sent')
      }
    } catch (e: any) {
      if (e.status === 402 && e.body?.paywall) showPaywall({ kind: e.body.paywall === 'likes' ? 'likes' : 'generic' })
      else toast.error(e.message ?? 'Failed to like')
    } finally {
      setLiking(false)
    }
  }

  // Premium members can message without a mutual like (creates the chat)
  const sendDm = async () => {
    if (!userId) return
    if (!dmText.trim()) return
    if (!viewerIsPremium) {
      showPaywall({ kind: 'generic' })
      return
    }
    setDmSending(true)
    try {
      const res = await api.dm(userId, dmText.trim())
      toast.success('Message sent')
      useQuickyStore.getState().openChat(res.matchId)
    } catch (e: any) {
      if (e.status === 402) showPaywall({ kind: 'generic' })
      else toast.error(e.message ?? 'Failed to send')
    } finally {
      setDmSending(false)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white overflow-y-auto no-scrollbar">
      {/* Floating back button */}
      <header className="shrink-0 px-3 pt-3 pb-3 flex items-center justify-between absolute top-0 left-0 right-0 z-10">
        <button onClick={() => setView(returnView)} className="p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60" aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
      </header>

      {/* Photo Carousel */}
      {allPhotos.length > 0 && (
        <div className="relative">
          {/* Embla container */}
          <div ref={emblaRef} className="overflow-hidden aspect-[3/4] w-full">
            <div className="flex h-full">
              {allPhotos.map((photo: any, i: number) => {
                const isLocked = i >= visibleCount
                return (
                  <div key={photo.id} className="flex-[0_0_100%] relative">
                    {isLocked ? (
                      <div className="w-full h-full relative">
                        <img
                          src={allPhotos[visibleCount - 1]?.url}
                          alt=""
                          className="w-full h-full object-cover blur-xl scale-110"
                        />
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                            <Lock className="w-7 h-7 text-white/80" />
                          </div>
                          <p className="text-white font-semibold text-sm">Premium photo</p>
                          <p className="text-white/60 text-xs text-center px-8">Upgrade to see all {allPhotos.length} photos</p>
                          <button
                            onClick={() => showPaywall({ kind: 'generic' })}
                            className="mt-1 bg-coral-gradient text-white text-xs font-semibold rounded-full px-4 py-1.5"
                          >
                            Unlock Premium
                          </button>
                        </div>
                      </div>
                    ) : (
                      <img src={photo.url} alt={profile.name} className="w-full h-full object-cover" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Gradient overlay */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

          {/* Photo progress dots */}
          {allPhotos.length > 1 && (
            <div className="absolute top-16 left-3 right-3 flex gap-1 pointer-events-none">
              {allPhotos.map((_: any, i: number) => (
                <div
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-all',
                    i === selectedIdx ? 'bg-white' : i < visibleCount ? 'bg-white/40' : 'bg-white/10'
                  )}
                />
              ))}
            </div>
          )}

          {/* Prev/next nav arrows */}
          {selectedIdx > 0 && (
            <button
              onClick={() => scrollTo(selectedIdx - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
          )}
          {selectedIdx < allPhotos.length - 1 && (
            <button
              onClick={() => scrollTo(selectedIdx + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
              aria-label="Next photo"
            >
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          )}

          {/* Name + info overlay */}
          <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold">{profile.name}, {profile.age}</h2>
              {profile.isVerified && <BadgeCheck className="w-5 h-5 text-[var(--qk-accent)]" fill="currentColor" stroke="white" />}
              {profile.isPremium && (
                <span className="text-gradient-gold">
                  <Crown className="w-4 h-4" fill="currentColor" stroke="none" />
                </span>
              )}
            </div>
            {profile.city && (
              <div className="flex items-center gap-1 text-xs text-white/80 mt-0.5">
                <MapPin className="w-3 h-3" /> {profile.city}
              </div>
            )}
          </div>

          {/* Private photo notice */}
          {profile.hasPrivatePhotos && (
            <div className="absolute top-16 right-3 flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5">
              <Lock className="w-2.5 h-2.5 text-[var(--qk-gold)]" />
              <span className="text-[10px] text-[var(--qk-gold)] font-semibold">Has private photos</span>
            </div>
          )}
        </div>
      )}

      {/* Thumbnail strip */}
      {allPhotos.length > 1 && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {allPhotos.map((photo: any, i: number) => {
              const isLocked = i >= visibleCount
              return (
                <button
                  key={photo.id}
                  onClick={() => scrollTo(i)}
                  className={cn(
                    'flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all relative',
                    i === selectedIdx ? 'border-[var(--qk-accent)]' : 'border-transparent'
                  )}
                  aria-label={`View photo ${i + 1}`}
                >
                  <img
                    src={isLocked ? allPhotos[visibleCount - 1]?.url : photo.url}
                    alt=""
                    className={cn('w-full h-full object-cover', isLocked && 'blur-md scale-110')}
                  />
                  {isLocked && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-white/80" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Profile details */}
      <div className="p-4 flex flex-col gap-3">
        {profile.bio && <p className="text-sm text-white/80 text-pretty">{profile.bio}</p>}

        {profile.interests?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide">Interests</h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.interests.map((t: string) => (
                <span key={t} className="text-xs font-medium bg-white/8 rounded-full px-2.5 py-1 capitalize">
                  {t.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {profile.prompts?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide">Prompts</h3>
            <div className="flex flex-col gap-2">
              {profile.prompts.map((p: any, i: number) => (
                <div key={i} className="bg-white/5 rounded-2xl p-3">
                  <p className="text-xs font-semibold text-[var(--qk-accent-light)] mb-1">{p.prompt}</p>
                  <p className="text-sm text-white/80 text-pretty">{p.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {profile.quickyScore > 0 && (
          <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-3">
            <Sparkles className="w-6 h-6" style={{ color: tier.current.color }} />
            <div className="flex-1">
              <p className="text-xs text-white/60">Quicky Score</p>
              <p className="font-bold text-lg">{profile.quickyScore}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/60">Tier</p>
              <p className="font-bold text-sm" style={{ color: tier.current.color }}>
                {tier.current.name}
              </p>
            </div>
          </div>
        )}

        <ProfilePostsGrid posts={profile.posts} />

        {/* Actions: like back (if they liked you) + message (premium DM without a match) */}
        {!isMe && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2">
              {relationship?.theyLikedMe && !relationship?.hasMatch && (
                <button
                  onClick={likeBack}
                  disabled={liking}
                  className="flex-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <Heart className="w-4 h-4" fill="currentColor" />
                  {liking ? 'Liking...' : relationship.superLike ? 'Like Back — they Super Liked you!' : 'Like Back'}
                </button>
              )}
              {relationship?.hasMatch && relationship?.matchId ? (
                <button
                  onClick={() => useQuickyStore.getState().openChat(relationship.matchId!)}
                  className="flex-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <MessageCircle className="w-4 h-4" /> Message
                </button>
              ) : (
                <button
                  onClick={() => (viewerIsPremium ? undefined : showPaywall({ kind: 'generic' }))}
                  className={cn(
                    'flex-1 rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform',
                    viewerIsPremium
                      ? 'bg-white/10 border border-white/15'
                      : 'bg-white/5 border border-[var(--qk-gold)]/30'
                  )}
                >
                  {!viewerIsPremium && <Crown className="w-4 h-4 text-[var(--qk-gold)]" />}
                  <MessageCircle className="w-4 h-4" />
                  {viewerIsPremium ? 'Message directly' : 'Message — Premium'}
                </button>
              )}
            </div>
            {/* Premium DM composer — only for premium users without a match yet */}
            {!relationship?.hasMatch && viewerIsPremium && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={dmText}
                  onChange={(e) => setDmText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendDm()}
                  placeholder={`Say hi to ${profile.name ?? 'them'}...`}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50"
                />
                <button
                  onClick={sendDm}
                  disabled={!dmText.trim() || dmSending}
                  className="shrink-0 w-10 h-10 rounded-full bg-coral-gradient text-white disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center"
                  aria-label="Send message"
                >
                  <MessageCircle className="w-[18px] h-[18px]" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
