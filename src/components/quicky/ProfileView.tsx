'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { ArrowLeft, BadgeCheck, Crown, MapPin, Sparkles, Lock, ChevronLeft, ChevronRight } from 'lucide-react'
import { getScoreTier } from '@/lib/quicky/constants'
import { cn } from '@/lib/utils'
import useEmblaCarousel from 'embla-carousel-react'

// Free users can view this many photos on a profile
const FREE_PHOTO_LIMIT = 3

export function ProfileView() {
  const userId = useQuickyStore((s) => s.activeProfileUserId)
  const currentUser = useQuickyStore((s) => s.user)
  const setView = useQuickyStore((s) => s.setView)
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(0)

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
      } catch (e: any) {
        toast.error(e.message ?? 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    })()
  }, [userId])

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0F0F14]">
        <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!profile) return null

  const tier = getScoreTier(profile.quickyScore ?? 0)

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white overflow-y-auto no-scrollbar">
      {/* Floating back button */}
      <header className="shrink-0 px-3 pt-3 pb-3 flex items-center justify-between absolute top-0 left-0 right-0 z-10">
        <button onClick={() => setView('chat')} className="p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60" aria-label="Back">
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
              {profile.isVerified && <BadgeCheck className="w-5 h-5 text-[#FF2D55]" fill="currentColor" stroke="white" />}
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
              <Lock className="w-2.5 h-2.5 text-[#F5C570]" />
              <span className="text-[10px] text-[#F5C570] font-semibold">Has private photos</span>
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
                    i === selectedIdx ? 'border-[#FF2D55]' : 'border-transparent'
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
                  <p className="text-xs font-semibold text-[#FF5E7E] mb-1">{p.prompt}</p>
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
      </div>
    </div>
  )
}
