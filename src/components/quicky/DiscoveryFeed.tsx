'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, useMotionValue, useTransform, PanInfo, AnimatePresence } from 'framer-motion'
import { useQuickyStore, DiscoveryCandidate } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { Heart, X, Star, RotateCcw, MapPin, BadgeCheck, Crown, Sparkles, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getScoreTier } from '@/lib/quicky/constants'

// Free users can see this many photos per card before the "upgrade" gate
const FREE_PHOTO_LIMIT = 3

export function DiscoveryFeed() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const showMatchCelebration = useQuickyStore((s) => s.showMatchCelebration)
  const showPaywall = useQuickyStore((s) => s.showPaywall)

  const [queue, setQueue] = useState<DiscoveryCandidate[]>([])
  const [limits, setLimits] = useState<{ likes: number | 'unlimited'; superLikes: number; quicky: number | 'unlimited'; isPremium: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [topKey, setTopKey] = useState(0) // force remount of top card

  // Pending swipes waiting to be flushed to the server in one batch request.
  // Swiping is optimistic: the card leaves immediately and the API call
  // happens in the background, so slow networks never block the next swipe.
  const pendingSwipes = useRef<{ toUserId: string; type: 'like' | 'superlike' | 'pass'; candidate: DiscoveryCandidate }[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushing = useRef(false)

  const flushPending = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    if (flushing.current || pendingSwipes.current.length === 0) return
    const batch = pendingSwipes.current
    pendingSwipes.current = []
    flushing.current = true
    try {
      const res = await api.swipeBatch(batch.map(({ toUserId, type }) => ({ toUserId, type })))
      if (res.limits) setLimits(res.limits)
      for (const r of res.results ?? []) {
        if (!r.ok && r.paywall) {
          showPaywall({ kind: r.paywall })
        } else if (r.match) {
          const entry = batch.find((b) => b.toUserId === r.toUserId)
          if (entry) {
            showMatchCelebration({
              matchId: r.match.id,
              partnerId: entry.candidate.id,
              partnerName: entry.candidate.name,
              partnerPhoto: entry.candidate.photos[0]?.url ?? null,
            })
          }
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save swipes')
    } finally {
      flushing.current = false
      // More may have queued while the request was in flight
      if (pendingSwipes.current.length > 0) scheduleFlush()
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      flushPending()
    }, 1500)
  }, [flushPending])

  // Don't lose queued swipes when leaving the feed / hiding the app
  useEffect(() => {
    const onHide = () => flushPending()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      if (flushTimer.current) clearTimeout(flushTimer.current)
      flushPending()
    }
  }, [flushPending])

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await api.discovery()
      setQueue(res.queue)
      setLimits(res.limits)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load discovery')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleSwipe = (candidate: DiscoveryCandidate, type: 'like' | 'superlike' | 'pass') => {
    // Check limits locally before queueing
    if (type === 'like' && limits && limits.likes !== 'unlimited' && limits.likes <= 0) {
      showPaywall({ kind: 'likes' })
      return false
    }
    if (type === 'superlike' && limits && limits.superLikes <= 0) {
      showPaywall({ kind: 'superlikes' })
      return false
    }

    // Optimistic: queue the swipe, decrement local counters, advance immediately
    pendingSwipes.current.push({ toUserId: candidate.id, type, candidate })
    scheduleFlush()
    setLimits((l) =>
      l
        ? {
            ...l,
            likes: l.likes === 'unlimited' ? l.likes : Math.max(0, (l.likes as number) - (type === 'like' ? 1 : 0)),
            superLikes: Math.max(0, l.superLikes - (type === 'superlike' ? 1 : 0)),
          }
        : l
    )
    advanceQueue()
    return true
  }

  const rewind = async () => {
    try {
      // Make sure queued swipes are saved first, so we rewind the true last swipe
      await flushPending()
      const res = await api.swipe('', 'rewind')
      if (res.ok) {
        toast.success('Last swipe undone')
        refresh()
      }
    } catch (e: any) {
      if (e.status === 402) showPaywall({ kind: 'generic' })
      else toast.error(e.message ?? 'Rewind failed')
    }
  }

  const advanceQueue = useCallback(() => {
    setQueue((q) => q.slice(1))
    setTopKey((k) => k + 1)
  }, [])

  const top = queue[0]
  const next1 = queue[1]
  const next2 = queue[2]
  const viewerIsPremium = user?.isPremium ?? false
  const premiumUntil = user?.premiumUntil ?? null

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative">
      {/* Top bar with logo + score */}
      <header className="shrink-0 px-5 pt-3 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {/* Logo mark doubles as the "Q" of the wordmark */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/quicky-logo.png" alt="" className="w-7 h-7 rounded-lg object-cover" />
          <span className="text-xl font-bold tracking-tight">uicky</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-accent)]" />
        </div>
        <div className="flex items-center gap-2">
          {/* Premium — sits next to the logo, right-aligned with the score */}
          <button
            onClick={() => setView('premium')}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 active:scale-95 transition-all',
              viewerIsPremium
                ? 'border-[var(--qk-gold)]/40 bg-[var(--qk-gold)]/10'
                : 'border-[var(--qk-gold)]/30 bg-gradient-to-r from-[var(--qk-gold)]/10 to-[var(--qk-purple)]/10 relative overflow-hidden'
            )}
            aria-label={viewerIsPremium ? 'Premium active' : 'Upgrade to Premium'}
          >
            {!viewerIsPremium && (
              <span className="pointer-events-none absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-[sheen_2.8s_ease-in-out_infinite]" />
            )}
            <Crown
              className={cn('w-4 h-4 relative', viewerIsPremium ? 'text-gradient-gold' : 'text-[var(--qk-gold)]')}
              fill={viewerIsPremium ? 'currentColor' : 'none'}
            />
            <span className={cn('relative text-[10px] font-bold', viewerIsPremium ? 'text-gradient-gold' : 'text-[var(--qk-gold)]')}>
              {viewerIsPremium
                ? premiumUntil
                  ? new Date(premiumUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                  : 'Premium'
                : 'Premium'}
            </span>
          </button>
          <button
            onClick={() => setView('profile-me')}
            className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full pl-2 pr-3 py-1"
          >
            <ScoreBadge score={user?.quickyScore ?? 0} />
            <span className="text-xs font-semibold">{user?.quickyScore ?? 0}</span>
          </button>
        </div>
      </header>

      {/* Card stack */}
      <div className="flex-1 relative px-4 pb-2 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && queue.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <Sparkles className="w-12 h-12 text-white/20 mb-3" />
            <h2 className="text-xl font-bold">You're all caught up</h2>
            <p className="text-white/50 text-sm mt-1">Check back later for more people in your area.</p>
            <button onClick={refresh} className="mt-4 bg-coral-gradient rounded-full px-4 py-2 text-sm font-medium">
              Refresh
            </button>
          </div>
        )}

        {!loading && queue.length > 0 && (
          <div className="absolute inset-0">
            {/* Background cards (stacked behind top) */}
            {next2 && (
              <CardLayout
                key={`bg2-${next2.id}`}
                candidate={next2}
                style={{ transform: 'scale(0.9) translateY(16px)', opacity: 0.4 }}
                interactive={false}
                viewerIsPremium={viewerIsPremium}
                showPaywall={() => showPaywall({ kind: 'generic' })}
              />
            )}
            {next1 && (
              <CardLayout
                key={`bg1-${next1.id}`}
                candidate={next1}
                style={{ transform: 'scale(0.95) translateY(8px)', opacity: 0.7 }}
                interactive={false}
                viewerIsPremium={viewerIsPremium}
                showPaywall={() => showPaywall({ kind: 'generic' })}
              />
            )}
            {/* Top interactive card */}
            <SwipeCardWrapper
              key={`top-${top.id}-${topKey}`}
              candidate={top}
              viewerIsPremium={viewerIsPremium}
              showPaywall={() => showPaywall({ kind: 'generic' })}
              onSwipe={(dir) => {
                const type = dir === 'right' ? 'like' : dir === 'left' ? 'pass' : 'superlike'
                handleSwipe(top, type as 'like' | 'superlike' | 'pass')
              }}
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      {queue.length > 0 && (
        <div className="shrink-0 px-6 py-4 flex items-center justify-center gap-3">
          <ActionButton
            onClick={rewind}
            size="sm"
            color="amber"
            icon={<RotateCcw className="w-5 h-5" />}
            label="Rewind"
          />
          <ActionButton
            onClick={() => handleSwipe(top, 'pass')}
            size="lg"
            color="white"
            icon={<X className="w-7 h-7" strokeWidth={3} />}
            label="Pass"
          />
          <ActionButton
            onClick={() => handleSwipe(top, 'superlike')}
            size="sm"
            color="blue"
            icon={<Star className="w-5 h-5" fill="currentColor" />}
            label="Super Like"
          />
          <ActionButton
            onClick={() => handleSwipe(top, 'like')}
            size="lg"
            color="coral"
            icon={<Heart className="w-7 h-7" fill="currentColor" strokeWidth={0} />}
            label="Like"
          />
        </div>
      )}

      {/* Limits indicator (free users) */}
      {limits && !limits.isPremium && (
        <div className="shrink-0 px-5 pb-2 -mt-1 text-center">
          <span className="text-[10px] text-white/40 font-medium">
            {limits.likes === 'unlimited' ? 'Unlimited likes' : `${limits.likes} likes left`}
            {' · '}
            {limits.superLikes} super {limits.superLikes === 1 ? 'like' : 'likes'} left
          </span>
        </div>
      )}
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const tier = getScoreTier(score)
  return (
    <span
      className="w-4 h-4 rounded-full flex items-center justify-center"
      style={{ backgroundColor: tier.current.color + '40' }}
    >
      <Sparkles className="w-2.5 h-2.5" style={{ color: tier.current.color }} />
    </span>
  )
}

function ActionButton({
  onClick,
  icon,
  color,
  size,
  label,
}: {
  onClick: () => void
  icon: React.ReactNode
  color: 'white' | 'coral' | 'amber' | 'blue'
  size: 'sm' | 'lg'
  label: string
}) {
  const colors = {
    white: 'bg-white text-[var(--qk-bg)] hover:scale-105',
    coral: 'bg-[var(--qk-accent)]/10 text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/20 border-[var(--qk-accent)]/30',
    amber: 'bg-[var(--qk-gold)]/10 text-[var(--qk-gold)] hover:bg-[var(--qk-gold)]/20 border-[var(--qk-gold)]/30',
    blue: 'bg-[var(--qk-purple)]/10 text-[var(--qk-purple)] hover:bg-[var(--qk-purple)]/20 border-[var(--qk-purple)]/30',
  }
  const sizes = {
    sm: 'w-12 h-12',
    lg: 'w-14 h-14',
  }
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        'rounded-full border border-white/10 flex items-center justify-center transition-all active:scale-95',
        colors[color],
        sizes[size]
      )}
    >
      {icon}
    </button>
  )
}

// Static card layout (for background stack & non-interactive display)
function CardLayout({
  candidate,
  style,
  interactive,
  viewerIsPremium,
  showPaywall,
}: {
  candidate: DiscoveryCandidate
  style?: React.CSSProperties
  interactive?: boolean
  viewerIsPremium: boolean
  showPaywall: () => void
}) {
  const [photoIdx, setPhotoIdx] = useState(0)
  const tier = getScoreTier(candidate.quickyScore)
  const total = candidate.photos.length
  const visibleLimit = viewerIsPremium ? total : Math.min(total, FREE_PHOTO_LIMIT)
  const photo = candidate.photos[photoIdx]
  const isLocked = photoIdx >= visibleLimit

  // Touch-based swipe detection (separate from card-drag swipe)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!interactive) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!interactive || touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    // Only register as horizontal swipe if horizontal is dominant
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return

    e.stopPropagation()
    if (dx > 0) {
      // swipe right on image → go previous
      setPhotoIdx((i) => Math.max(0, i - 1))
    } else {
      // swipe left on image → go next
      const next = photoIdx + 1
      if (next >= visibleLimit && !viewerIsPremium && next < total) {
        showPaywall()
      } else {
        setPhotoIdx((i) => Math.min(total - 1, i + 1))
      }
    }
    touchStartX.current = null
    touchStartY.current = null
  }

  // Click tap zones (desktop / non-touch)
  const cyclePhoto = (e: React.MouseEvent, dir: 'left' | 'right') => {
    e.stopPropagation()
    if (dir === 'left') {
      setPhotoIdx((i) => Math.max(0, i - 1))
    } else {
      const next = photoIdx + 1
      if (next >= visibleLimit && !viewerIsPremium && next < total) {
        showPaywall()
      } else {
        setPhotoIdx((i) => Math.min(total - 1, i + 1))
      }
    }
  }

  return (
    <div
      className="absolute inset-x-4 top-0 bottom-0 rounded-3xl overflow-hidden bg-[var(--qk-card)] border border-white/5 shadow-2xl"
      style={style}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {photo && !isLocked ? (
        <img src={photo.url} alt={candidate.name ?? 'Photo'} className="w-full h-full object-cover" />
      ) : isLocked ? (
        // Blurred lock overlay
        <div className="w-full h-full relative">
          <img src={candidate.photos[visibleLimit - 1]?.url} alt="" className="w-full h-full object-cover blur-xl scale-110" />
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
              <Lock className="w-7 h-7 text-white/80" />
            </div>
            <p className="text-white font-semibold text-sm">Premium photos locked</p>
            <p className="text-white/60 text-xs">Upgrade to see all {total} photos</p>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/20">
          <Sparkles className="w-12 h-12" />
        </div>
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      {/* Photo pagination dots */}
      {total > 1 && (
        <div className="absolute top-2 left-2 right-2 flex gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-all',
                i === photoIdx ? 'bg-white' : i < visibleLimit ? 'bg-white/30' : 'bg-white/10'
              )}
            />
          ))}
        </div>
      )}

      {/* Premium lock badge if limited */}
      {!viewerIsPremium && total > FREE_PHOTO_LIMIT && (
        <div className="absolute top-5 right-3 flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5">
          <Lock className="w-2.5 h-2.5 text-[var(--qk-gold)]" />
          <span className="text-[10px] text-[var(--qk-gold)] font-semibold">{total - visibleLimit} locked</span>
        </div>
      )}

      {/* Tap zones for photo cycle (desktop) */}
      {interactive && !isLocked && (
        <>
          <button className="absolute left-0 top-0 bottom-0 w-1/3" onClick={(e) => cyclePhoto(e, 'left')} aria-label="Previous photo" />
          <button className="absolute right-0 top-0 bottom-0 w-1/3" onClick={(e) => cyclePhoto(e, 'right')} aria-label="Next photo" />
        </>
      )}

      {/* Info */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-2xl font-bold tracking-tight truncate">
                {candidate.name}, <span className="font-normal text-white/80">{candidate.age}</span>
              </h2>
              {candidate.isVerified && (
                <BadgeCheck className="w-5 h-5 text-[var(--qk-accent)]" fill="currentColor" stroke="white" />
              )}
              {candidate.isPremium && (
                <span className="text-gradient-gold">
                  <Crown className="w-4 h-4" fill="currentColor" stroke="none" />
                </span>
              )}
            </div>
            {candidate.city && (
              <div className="flex items-center gap-1 text-xs text-white/70">
                <MapPin className="w-3 h-3" />
                {candidate.distanceKm ? `${candidate.distanceKm} km away` : candidate.city}
              </div>
            )}
            {candidate.bio && (
              <p className="text-xs text-white/70 mt-1 line-clamp-2">{candidate.bio}</p>
            )}
            {candidate.interests.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {candidate.interests.slice(0, 3).map((t) => (
                  <span key={t} className="text-[10px] font-medium bg-white/10 rounded-full px-2 py-0.5 capitalize">
                    {t.replace(/-/g, ' ')}
                  </span>
                ))}
                {candidate.interests.length > 3 && (
                  <span className="text-[10px] text-white/60">+{candidate.interests.length - 3}</span>
                )}
              </div>
            )}
          </div>
          {/* Quicky score badge */}
          {candidate.quickyScore > 0 && (
            <div className="shrink-0 flex flex-col items-center gap-0.5">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: tier.current.color + '30' }}>
                <Sparkles className="w-5 h-5" style={{ color: tier.current.color }} />
              </div>
              <span className="text-[10px] font-bold" style={{ color: tier.current.color }}>
                {candidate.quickyScore}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SwipeCardWrapper({
  candidate,
  onSwipe,
  viewerIsPremium,
  showPaywall,
}: {
  candidate: DiscoveryCandidate
  onSwipe: (dir: 'left' | 'right' | 'up') => void
  viewerIsPremium: boolean
  showPaywall: () => void
}) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const [gone, setGone] = useState(false)

  const rotate = useTransform(x, [-200, 0, 200], [-18, 0, 18])
  const likeOpacity = useTransform(x, [0, 60, 120], [0, 0.6, 1])
  const passOpacity = useTransform(x, [-120, -60, 0], [1, 0.6, 0])
  const superOpacity = useTransform(y, [-120, -60, 0], [1, 0.6, 0])

  const handleDragEnd = (_: any, info: PanInfo) => {
    // Lower thresholds so a light flick registers, not just big drags
    const threshold = 70
    const velocity = 350
    if (info.offset.x > threshold || info.velocity.x > velocity) {
      setGone(true)
      x.set(500)
      onSwipe('right')
    } else if (info.offset.x < -threshold || info.velocity.x < -velocity) {
      setGone(true)
      x.set(-500)
      onSwipe('left')
    } else if (info.offset.y < -threshold || info.velocity.y < -velocity) {
      setGone(true)
      y.set(-500)
      onSwipe('up')
    }
  }

  return (
    <motion.div
      drag={!gone}
      // Zero constraints + high elasticity = the card follows the finger
      // freely (classic Tinder-style drag) and springs back on release.
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.9}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 40 }}
      onDragEnd={handleDragEnd}
      style={{ x, y, rotate }}
      whileTap={{ cursor: 'grabbing' }}
      animate={gone ? { opacity: 0, scale: 0.85, transition: { duration: 0.2 } } : {}}
      className="absolute inset-x-4 top-0 bottom-0 cursor-grab active:cursor-grabbing touch-none"
    >
      <CardLayout
        candidate={candidate}
        interactive
        viewerIsPremium={viewerIsPremium}
        showPaywall={showPaywall}
      />

      {/* LIKE indicator */}
      <motion.div
        style={{ opacity: likeOpacity }}
        className="absolute top-8 left-6 -rotate-12 pointer-events-none"
      >
        <span className="text-[var(--qk-accent)] text-4xl font-extrabold border-4 border-[var(--qk-accent)] rounded-xl px-3 py-1">
          LIKE
        </span>
      </motion.div>
      {/* PASS indicator */}
      <motion.div
        style={{ opacity: passOpacity }}
        className="absolute top-8 right-6 rotate-12 pointer-events-none"
      >
        <span className="text-white text-4xl font-extrabold border-4 border-white rounded-xl px-3 py-1">
          NOPE
        </span>
      </motion.div>
      {/* SUPER LIKE indicator */}
      <motion.div
        style={{ opacity: superOpacity }}
        className="absolute top-1/3 left-1/2 -translate-x-1/2 pointer-events-none"
      >
        <span className="text-[var(--qk-purple)] text-3xl font-extrabold border-4 border-[var(--qk-purple)] rounded-xl px-3 py-1">
          SUPER
        </span>
      </motion.div>
    </motion.div>
  )
}
