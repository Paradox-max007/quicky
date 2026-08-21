'use client'

import { useEffect, useState, useCallback } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { BadgeCheck, Crown, Camera, X, Sparkles, Shield, LogOut, Plus, Lock, LockOpen, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react'
import { getScoreTier } from '@/lib/quicky/constants'
import { cn } from '@/lib/utils'
import { PhotoVerification } from './PhotoVerification'
import useEmblaCarousel from 'embla-carousel-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Photo = { id: string; url: string; isPrimary: boolean; isPrivate: boolean; position: number }

function SortablePhoto({
  photo,
  isPremium,
  onDelete,
  onTogglePrivate,
}: {
  photo: Photo
  isPremium: boolean
  onDelete: (id: string) => void
  onTogglePrivate: (id: string, val: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative aspect-[3/4] rounded-xl overflow-hidden border border-white/8',
        isDragging && 'opacity-80 shadow-2xl ring-2 ring-[#FF2D55]/50'
      )}
    >
      <img src={photo.url} alt="" className="w-full h-full object-cover" />

      {/* Private overlay tint */}
      {photo.isPrivate && (
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      )}

      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-3 h-3 text-white/70" />
      </div>

      {/* Delete button */}
      <button
        onClick={() => onDelete(photo.id)}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
        aria-label="Delete photo"
      >
        <X className="w-3.5 h-3.5 text-white" />
      </button>

      {/* Private toggle (premium only) */}
      {isPremium && (
        <button
          onClick={() => onTogglePrivate(photo.id, !photo.isPrivate)}
          className={cn(
            'absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors',
            photo.isPrivate
              ? 'bg-[#F5C570]/80 hover:bg-[#F5C570]'
              : 'bg-black/60 hover:bg-black/80'
          )}
          aria-label={photo.isPrivate ? 'Make public' : 'Make private'}
          title={photo.isPrivate ? 'Private — tap to make public' : 'Tap to make private'}
        >
          {photo.isPrivate
            ? <Lock className="w-3 h-3 text-black" />
            : <LockOpen className="w-3 h-3 text-white/70" />
          }
        </button>
      )}

      {/* Badges */}
      {photo.isPrimary && (
        <span className="absolute bottom-1 left-1 bg-[#FF2D55] text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
          MAIN
        </span>
      )}
      {photo.isPrivate && !photo.isPrimary && (
        <span className="absolute bottom-1 left-1 bg-[#F5C570]/20 text-[#F5C570] text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
          <Lock className="w-2.5 h-2.5" /> PRIVATE
        </span>
      )}
    </div>
  )
}

export function MyProfileView() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const [profile, setProfile] = useState<any | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [showVerify, setShowVerify] = useState(false)
  const [uploading, setUploading] = useState(false)

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  )

  const refresh = async () => {
    try {
      const res = await api.auth.me()
      if (res.user) {
        setUser(res.user)
        setProfile(res.user)
        const sorted = [...(res.user.photos ?? [])].sort((a: any, b: any) => a.position - b.position)
        setPhotos(sorted.map((p: any) => ({ ...p, isPrivate: p.isPrivate ?? false })))
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load profile')
    }
  }

  useEffect(() => { refresh() }, [])

  const uploadPhoto = async (file: File) => {
    setUploading(true)
    try {
      const uploadRes = await api.upload(file, 'photo')
      if (uploadRes.url) {
        await api.photos.add(uploadRes.url, photos.length, photos.length === 0)
        toast.success('Photo added')
        refresh()
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const deletePhoto = async (id: string) => {
    if (!confirm('Delete this photo?')) return
    try {
      await api.photos.delete(id)
      toast.success('Photo deleted')
      refresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    }
  }

  const togglePrivate = async (id: string, val: boolean) => {
    // Optimistic update
    setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, isPrivate: val } : p))
    try {
      await api.photos.update(id, { isPrivate: val })
      toast.success(val ? 'Photo set to private' : 'Photo is now public')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to update')
      refresh() // revert on error
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = photos.findIndex((p) => p.id === active.id)
    const newIdx = photos.findIndex((p) => p.id === over.id)
    const reordered = arrayMove(photos, oldIdx, newIdx).map((p, i) => ({ ...p, position: i }))
    setPhotos(reordered) // optimistic

    // Persist new positions
    try {
      await Promise.all(
        reordered.map((p, i) =>
          i !== oldIdx && i !== newIdx ? null : api.photos.update(p.id, { position: i })
        ).filter(Boolean)
      )
    } catch {
      toast.error('Failed to save order')
      refresh()
    }
  }

  if (!profile) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0F0F14]">
        <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
      </div>
    )
  }

  const tier = getScoreTier(profile.quickyScore ?? 0)
  const isPremium = profile.isPremium

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white overflow-y-auto no-scrollbar">
      <header className="shrink-0 px-5 pt-3 pb-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <button
          onClick={async () => {
            await api.auth.logout()
            setUser(null)
            setView('auth')
            toast.success('Logged out')
          }}
          className="text-white/50 hover:text-white p-2"
          aria-label="Log out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Hero photo carousel */}
      <div className="px-4 pb-4">
        <div className="relative rounded-3xl overflow-hidden bg-[#1A1A2E] border border-white/8 aspect-[3/4]">
          {photos.length > 0 ? (
            <>
              <div ref={emblaRef} className="overflow-hidden w-full h-full">
                <div className="flex h-full">
                  {photos.map((p) => (
                    <div key={p.id} className="flex-[0_0_100%] relative">
                      <img src={p.url} alt={profile.name} className="w-full h-full object-cover" />
                      {p.isPrivate && (
                        <div className="absolute inset-0 bg-black/30 pointer-events-none" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Photo pagination dots */}
              {photos.length > 1 && (
                <div className="absolute top-3 left-3 right-3 flex gap-1 pointer-events-none">
                  {photos.map((_, i) => (
                    <div key={i} className={cn('h-1 flex-1 rounded-full', i === selectedIdx ? 'bg-white' : 'bg-white/40')} />
                  ))}
                  {photos.length < 6 && <div className="h-1 flex-1 rounded-full bg-white/10" />}
                </div>
              )}

              {/* Prev/next arrows */}
              {selectedIdx > 0 && (
                <button
                  onClick={() => emblaApi?.scrollTo(selectedIdx - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
                >
                  <ChevronLeft className="w-5 h-5 text-white" />
                </button>
              )}
              {selectedIdx < photos.length - 1 && (
                <button
                  onClick={() => emblaApi?.scrollTo(selectedIdx + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
                >
                  <ChevronRight className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Private badge on current photo */}
              {photos[selectedIdx]?.isPrivate && (
                <div className="absolute top-3 right-12 flex items-center gap-1 bg-[#F5C570]/20 rounded-full px-2 py-0.5 pointer-events-none">
                  <Lock className="w-2.5 h-2.5 text-[#F5C570]" />
                  <span className="text-[10px] text-[#F5C570] font-semibold">Private</span>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30">
              <Camera className="w-12 h-12" />
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

          {/* Name row */}
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between pointer-events-none">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-2xl font-bold">{profile.name}, {profile.age}</h2>
                {profile.isVerified && <BadgeCheck className="w-5 h-5 text-[#FF2D55]" fill="currentColor" stroke="white" />}
                {profile.isPremium && (
                  <span className="text-gradient-gold">
                    <Crown className="w-4 h-4" fill="currentColor" stroke="none" />
                  </span>
                )}
              </div>
              <p className="text-xs text-white/70">{profile.city}</p>
            </div>
            <div className="flex flex-col items-center pointer-events-auto">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: tier.current.color + '30' }}>
                <Sparkles className="w-6 h-6" style={{ color: tier.current.color }} />
              </div>
              <span className="text-xs font-bold mt-1" style={{ color: tier.current.color }}>
                {profile.quickyScore}
              </span>
              <span className="text-[10px] text-white/60">{tier.current.name}</span>
            </div>
          </div>

          {/* Add photo button */}
          {photos.length < 6 && (
            <label className={cn('absolute top-3 right-3 w-9 h-9 rounded-full bg-[#FF2D55] flex items-center justify-center glow-coral cursor-pointer active:scale-95', uploading && 'opacity-50')}>
              <Plus className="w-5 h-5 text-white" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadPhoto(f)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div className="px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {photos.map((p, i) => (
              <button
                key={p.id}
                onClick={() => emblaApi?.scrollTo(i)}
                className={cn(
                  'flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all relative',
                  i === selectedIdx ? 'border-[#FF2D55]' : 'border-transparent'
                )}
              >
                <img src={p.url} alt="" className="w-full h-full object-cover" />
                {p.isPrivate && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Lock className="w-3 h-3 text-[#F5C570]" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Verification banner */}
      {!profile.isVerified && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setShowVerify(true)}
            className="w-full flex items-center gap-3 bg-[#FF2D55]/10 border border-[#FF2D55]/30 rounded-2xl p-3 active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-full bg-[#FF2D55]/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#FF2D55]" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold">Get verified</p>
              <p className="text-xs text-white/60">Take a selfie + live challenge for a verified badge</p>
            </div>
          </button>
        </div>
      )}

      {/* Premium upsell for free users */}
      {!profile.isPremium && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setView('premium')}
            className="w-full flex items-center gap-3 bg-gradient-to-r from-[#F5C570]/15 to-[#B8A4FF]/15 border border-[#F5C570]/30 rounded-2xl p-3 active:scale-[0.98] transition-transform"
          >
            <div className="w-10 h-10 rounded-full bg-[#F5C570]/20 flex items-center justify-center">
              <Crown className="w-5 h-5 text-[#F5C570]" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gradient-gold">Upgrade to Premium</p>
              <p className="text-xs text-white/60">Unlimited likes, Quickies, games, private photos + boost</p>
            </div>
          </button>
        </div>
      )}

      {/* Bio */}
      {profile.bio && (
        <div className="px-4 pb-3">
          <h3 className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide">Bio</h3>
          <p className="text-sm text-white/80 text-pretty">{profile.bio}</p>
        </div>
      )}

      {/* Interests */}
      {profile.interests?.length > 0 && (
        <div className="px-4 pb-3">
          <h3 className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide">Interests</h3>
          <div className="flex flex-wrap gap-1.5">
            {profile.interests.map((t: string) => (
              <span key={t} className="text-xs font-medium bg-white/8 rounded-full px-2.5 py-1 capitalize">{t.replace(/-/g, ' ')}</span>
            ))}
          </div>
        </div>
      )}

      {/* Prompts */}
      {profile.prompts?.length > 0 && (
        <div className="px-4 pb-4">
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

      {/* Manage Photos — drag to reorder */}
      {photos.length > 0 && (
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide">Manage Photos</h3>
            <span className="text-[10px] text-white/30">Hold & drag to reorder</span>
          </div>
          {isPremium && (
            <p className="text-[10px] text-[#F5C570]/70 mb-2 flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" /> Tap the lock icon to make a photo private (only mutual matches can see it)
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p) => (
                  <SortablePhoto
                    key={p.id}
                    photo={p}
                    isPremium={isPremium}
                    onDelete={deletePhoto}
                    onTogglePrivate={togglePrivate}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <div className="h-4" />

      {showVerify && <PhotoVerification onClose={() => setShowVerify(false)} onVerified={() => refresh()} />}
    </div>
  )
}
