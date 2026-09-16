'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useQuickyStore, DiscoveryCandidate } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { Heart, X, Star, RotateCcw, MapPin, BadgeCheck, Sparkles, Check, Ruler, GraduationCap, Wine, ShieldCheck, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getScoreTier } from '@/lib/quicky/constants'
// The mobile feed's card pieces are REUSED here (Desktop UI concept §7/§29):
// same swipe card, same photo paging, same drag physics — only the stage
// around them is desktop-native.
import { SwipeCardWrapper, CardLayout, ActionButton } from '../DiscoveryFeed'

/**
 * Desktop Discover stage (concept doc §7/§8/§29): the large central
 * discovery card with the four actions, plus the desktop-native
 * "About them" panel — chemistry computed from REAL shared interests
 * (§9: never a fake precision score) and shown only when there is
 * actual overlap.
 */

export function DiscoverStage() {
  const user = useQuickyStore((s) => s.user)
  const showMatchCelebration = useQuickyStore((s) => s.showMatchCelebration)
  const showPaywall = useQuickyStore((s) => s.showPaywall)

  const [queue, setQueue] = useState<DiscoveryCandidate[]>([])
  const [limits, setLimits] = useState<{ likes: number | 'unlimited'; superLikes: number; quicky: number | 'unlimited'; isPremium: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [topKey, setTopKey] = useState(0)

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
      if (pendingSwipes.current.length > 0) scheduleFlush()
    }
     
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      void flushPending()
    }, 1500)
  }, [flushPending])

  useEffect(() => {
    const onHide = () => void flushPending()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      if (flushTimer.current) clearTimeout(flushTimer.current)
      void flushPending()
    }
  }, [flushPending])

  const refresh = useCallback(async () => {
    try {
      const res = await api.discovery()
      setQueue(res.queue)
      setLimits(res.limits)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load discovery')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSwipe = (candidate: DiscoveryCandidate, type: 'like' | 'superlike' | 'pass') => {
    if (type === 'like' && limits && limits.likes !== 'unlimited' && limits.likes <= 0) {
      showPaywall({ kind: 'likes' })
      return
    }
    if (type === 'superlike' && limits && limits.superLikes <= 0) {
      showPaywall({ kind: 'superlikes' })
      return
    }
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
    setQueue((q) => q.slice(1))
    setTopKey((k) => k + 1)
  }

  const rewind = async () => {
    try {
      await flushPending()
      const res = await api.swipe('', 'rewind')
      if (res.ok) {
        toast.success('Last swipe undone')
        void refresh()
      }
    } catch (e: any) {
      if (e.status === 402) showPaywall({ kind: 'generic' })
      else toast.error(e.message ?? 'Rewind failed')
    }
  }

  const top = queue[0]
  const next1 = queue[1]
  const next2 = queue[2]
  const viewerIsPremium = user?.isPremium ?? false
  const myInterests = user?.interests ?? []

  // Chemistry from real shared interests only (§8/§9)
  const shared = top && myInterests.length > 0 ? top.interests.filter((i) => myInterests.includes(i)) : []
  const chemistry =
    shared.length > 0 && myInterests.length > 0
      ? Math.round((shared.length / Math.max(1, Math.min(myInterests.length, top.interests.length))) * 100)
      : null

  return (
    <section className="w-full" data-testid="desktop-discover">
      <div className="flex items-baseline justify-between mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Discover</h1>
        {limits && !limits.isPremium && (
          <span className="text-[11px] text-white/40 font-medium">
            {limits.likes === 'unlimited' ? 'Unlimited likes' : `${limits.likes} likes left`}
            {' · '}
            {limits.superLikes} super {limits.superLikes === 1 ? 'like' : 'likes'} left
          </span>
        )}
      </div>

      <div className="flex items-start justify-center gap-8">
        {/* Card + actions */}
        <div className="flex flex-col items-center gap-5 shrink-0">
          <div className="relative w-[360px] h-[520px] min-[1440px]:w-[400px] min-[1440px]:h-[560px]">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
              </div>
            )}
            {!loading && queue.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 rounded-3xl border border-white/8 bg-[var(--qk-card)] flex flex-col items-center justify-center text-center px-8">
                <Sparkles className="w-12 h-12 text-white/20 mb-3" />
                <h2 className="text-lg font-bold">You're all caught up</h2>
                <p className="text-white/50 text-sm mt-1">Check back later for more people in your area.</p>
                <button onClick={() => void refresh()} className="mt-4 bg-coral-gradient rounded-full px-4 py-2 text-sm font-medium">
                  Refresh
                </button>
              </motion.div>
            )}
            {!loading && queue.length > 0 && (
              <>
                {next2 && (
                  <CardLayout
                    key={`bg2-${next2.id}`}
                    candidate={next2}
                    style={{ transform: 'scale(0.94) translateY(14px)', opacity: 0.35 }}
                    interactive={false}
                    viewerIsPremium={viewerIsPremium}
                    showPaywall={() => showPaywall({ kind: 'generic' })}
                  />
                )}
                {next1 && (
                  <CardLayout
                    key={`bg1-${next1.id}`}
                    candidate={next1}
                    style={{ transform: 'scale(0.97) translateY(7px)', opacity: 0.65 }}
                    interactive={false}
                    viewerIsPremium={viewerIsPremium}
                    showPaywall={() => showPaywall({ kind: 'generic' })}
                  />
                )}
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
              </>
            )}
          </div>

          {queue.length > 0 && top && (
            <div className="flex items-center justify-center gap-3">
              <ActionButton onClick={() => void rewind()} size="sm" color="amber" icon={<RotateCcw className="w-5 h-5" />} label="Rewind" />
              <ActionButton onClick={() => handleSwipe(top, 'pass')} size="lg" color="white" icon={<X className="w-7 h-7" strokeWidth={3} />} label="Pass" />
              <ActionButton onClick={() => handleSwipe(top, 'superlike')} size="sm" color="blue" icon={<Star className="w-5 h-5" fill="currentColor" />} label="Super Like" />
              <ActionButton onClick={() => handleSwipe(top, 'like')} size="lg" color="coral" icon={<Heart className="w-7 h-7" fill="currentColor" strokeWidth={0} />} label="Like" />
            </div>
          )}
        </div>

        {/* ABOUT THEM + THE DETAILS — desktop-native context column (§29), ≥1280px only */}
        {top && (
          <div className="hidden min-[1280px]:flex flex-col gap-5 w-[300px] shrink-0">
          <aside className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5" data-testid="desktop-about-them">
            <p className="text-[11px] font-bold tracking-widest text-white/40 uppercase">About them</p>

            <div className="flex items-center gap-2 mt-3">
              <h3 className="text-xl font-bold tracking-tight truncate">
                {top.name}, <span className="font-normal text-white/70">{top.age}</span>
              </h3>
              {top.isVerified && <BadgeCheck className="w-5 h-5 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="white" />}
            </div>

            {top.city && (
              <div className="flex items-center gap-1 text-xs text-white/60 mt-1">
                <MapPin className="w-3 h-3" />
                {top.distanceKm ? `${top.distanceKm} km away` : top.city}
              </div>
            )}

            {chemistry !== null && (
              <div className="mt-4 rounded-2xl border border-[var(--qk-accent)]/20 bg-[var(--qk-accent)]/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-widest text-white/50 uppercase">Chemistry</span>
                  <span className="text-lg font-extrabold text-[var(--qk-accent)]">{chemistry}%</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/8 overflow-hidden">
                  <div className="h-full rounded-full bg-coral-gradient" style={{ width: `${chemistry}%` }} />
                </div>
                <p className="text-[11px] text-white/50 mt-2">
                  {shared.length} shared interest{shared.length === 1 ? '' : 's'}
                </p>
              </div>
            )}

            {top.bio && <p className="text-xs text-white/70 mt-4 leading-relaxed line-clamp-4">"{top.bio}"</p>}

            {top.interests.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-bold tracking-widest text-white/40 uppercase mb-2">Interests</p>
                <div className="flex flex-wrap gap-1.5">
                  {top.interests.slice(0, 8).map((t) => {
                    const isShared = shared.includes(t)
                    return (
                      <span
                        key={t}
                        className={cn(
                          'text-[11px] font-medium rounded-full px-2.5 py-1 capitalize inline-flex items-center gap-1',
                          isShared ? 'bg-[var(--qk-accent)]/15 text-[var(--qk-accent)]' : 'bg-white/8 text-white/70'
                        )}
                      >
                        {isShared && <Check className="w-3 h-3" />}
                        {t.replace(/-/g, ' ')}
                      </span>
                    )
                  })}
                  {top.interests.length > 8 && <span className="text-[11px] text-white/50 self-center">+{top.interests.length - 8}</span>}
                </div>
              </div>
            )}

            {top.quickyScore > 0 && (
              <div className="mt-4 flex items-center gap-2 pt-4 border-t border-white/8">
                {(() => {
                  const tier = getScoreTier(top.quickyScore)
                  return (
                    <>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: tier.current.color + '30' }}>
                        <Sparkles className="w-4 h-4" style={{ color: tier.current.color }} />
                      </span>
                      <div>
                        <p className="text-xs font-bold" style={{ color: tier.current.color }}>{top.quickyScore} Quicky Score</p>
                        <p className="text-[10px] text-white/40">{tier.current.name}</p>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </aside>

          {/* THE DETAILS — profile facts card, straight under About them */}
          <aside className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5" data-testid="desktop-their-details">
            <p className="text-[11px] font-bold tracking-widest text-white/40 uppercase">The details</p>
            <div className="mt-3 flex flex-col gap-2.5 text-sm">
              <DetailRow icon={<Ruler className="w-4 h-4" />} label="Height" value={top.heightCm ? top.heightCm + ' cm' : null} />
              <DetailRow icon={<GraduationCap className="w-4 h-4" />} label="Education" value={top.education} />
              <DetailRow icon={<Wine className="w-4 h-4" />} label="Lifestyle" value={top.lifestyle} />
              <DetailRow icon={<ShieldCheck className="w-4 h-4" />} label="Verification" value={top.isVerified ? 'Verified profile' : null} />
              <DetailRow icon={<Clock className="w-4 h-4" />} label="Last active" value={lastActiveLabel(top.lastActiveAt)} />
            </div>
          </aside>
          </div>
        )}
      </div>
    </section>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-white/45 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-widest text-white/35 leading-none">{label}</p>
        <p className={value ? 'text-[13px] font-semibold text-white/85 mt-0.5 truncate' : 'text-[13px] text-white/30 mt-0.5 italic'}>
          {value ?? 'Not shared yet'}
        </p>
      </div>
    </div>
  )
}

function lastActiveLabel(iso: string | null): string {
  if (!iso) return null as unknown as string
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null as unknown as string
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 5) return 'Active now'
  if (mins < 60) return 'Active ' + mins + ' min ago'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return 'Active ' + hours + 'h ago'
  const days = Math.floor(hours / 24)
  if (days < 7) return 'Active ' + days + 'd ago'
  return 'Last seen ' + days + 'd ago'
}
