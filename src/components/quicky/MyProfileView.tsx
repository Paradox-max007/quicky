'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { BadgeCheck, Crown, Camera, X, Sparkles, Shield, LogOut, Plus } from 'lucide-react'
import { getScoreTier } from '@/lib/quicky/constants'
import { cn } from '@/lib/utils'
import { PhotoVerification } from './PhotoVerification'

export function MyProfileView() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const [profile, setProfile] = useState<any | null>(null)
  const [photoIdx, setPhotoIdx] = useState(0)
  const [showVerify, setShowVerify] = useState(false)
  const [uploading, setUploading] = useState(false)

  const refresh = async () => {
    try {
      const res = await api.auth.me()
      if (res.user) {
        setUser(res.user)
        setProfile(res.user)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load profile')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const uploadPhoto = async (file: File) => {
    setUploading(true)
    try {
      const uploadRes = await api.upload(file, 'photo')
      if (uploadRes.url) {
        await api.photos.add(uploadRes.url, profile?.photos?.length ?? 0, profile?.photos?.length === 0)
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

  if (!profile) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0F0F14]">
        <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
      </div>
    )
  }

  const tier = getScoreTier(profile.quickyScore ?? 0)

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

      {/* Hero card */}
      <div className="px-4 pb-4">
        <div className="relative rounded-3xl overflow-hidden bg-[#1A1A2E] border border-white/8 aspect-[3/4]">
          {profile.photos?.length > 0 ? (
            <img src={profile.photos[photoIdx]?.url} alt={profile.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30">
              <Camera className="w-12 h-12" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

          {/* Photo pagination */}
          {profile.photos?.length > 1 && (
            <div className="absolute top-3 left-3 right-3 flex gap-1">
              {profile.photos.map((_: any, i: number) => (
                <div key={i} className={cn('h-1 flex-1 rounded-full', i === photoIdx ? 'bg-white' : 'bg-white/40')} />
              ))}
              {profile.photos.length < 6 && (
                <div className="h-1 flex-1 rounded-full bg-white/10" />
              )}
            </div>
          )}

          {/* Name row */}
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
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
            {/* Quicky score badge */}
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: tier.current.color + '30' }}>
                <Sparkles className="w-6 h-6" style={{ color: tier.current.color }} />
              </div>
              <span className="text-xs font-bold mt-1" style={{ color: tier.current.color }}>
                {profile.quickyScore}
              </span>
              <span className="text-[10px] text-white/60">{tier.current.name}</span>
            </div>
          </div>

          {/* Add photo */}
          {profile.photos?.length < 6 && (
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
              <p className="text-xs text-white/60">Unlimited likes, Quickies, games + boost</p>
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

      {/* Delete photos (when there are any) */}
      {profile.photos?.length > 0 && (
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide">Manage Photos</h3>
          <div className="grid grid-cols-3 gap-2">
            {profile.photos.map((p: any, i: number) => (
              <div key={p.id} className="relative aspect-[3/4] rounded-xl overflow-hidden">
                <img src={p.url} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => deletePhoto(p.id)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
                  aria-label="Delete photo"
                >
                  <X className="w-3.5 h-3.5 text-white" />
                </button>
                {p.isPrimary && (
                  <span className="absolute bottom-1 left-1 bg-[#FF2D55] text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                    PRIMARY
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-2" />

      {showVerify && <PhotoVerification onClose={() => setShowVerify(false)} onVerified={() => refresh()} />}
    </div>
  )
}
