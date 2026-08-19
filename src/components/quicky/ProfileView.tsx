'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { ArrowLeft, BadgeCheck, Crown, MapPin, Sparkles } from 'lucide-react'
import { getScoreTier } from '@/lib/quicky/constants'

export function ProfileView() {
  const userId = useQuickyStore((s) => s.activeProfileUserId)
  const setView = useQuickyStore((s) => s.setView)
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [photoIdx, setPhotoIdx] = useState(0)

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
      <header className="shrink-0 px-3 pt-3 pb-3 flex items-center justify-between absolute top-0 left-0 right-0 z-10">
        <button onClick={() => setView('chat')} className="p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60" aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
      </header>

      {profile.photos?.length > 0 && (
        <div className="relative aspect-[3/4] w-full overflow-hidden">
          <img src={profile.photos[photoIdx]?.url} alt={profile.name} className="w-full h-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
          {profile.photos.length > 1 && (
            <>
              <button className="absolute left-0 top-0 bottom-0 w-1/3" onClick={() => setPhotoIdx((i) => (i - 1 + profile.photos.length) % profile.photos.length)} aria-label="Previous" />
              <button className="absolute right-0 top-0 bottom-0 w-1/3" onClick={() => setPhotoIdx((i) => (i + 1) % profile.photos.length)} aria-label="Next" />
              <div className="absolute top-16 left-3 right-3 flex gap-1">
                {profile.photos.map((_: any, i: number) => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i === photoIdx ? 'bg-white' : 'bg-white/40'}`} />
                ))}
              </div>
            </>
          )}
          <div className="absolute bottom-4 left-4 right-4">
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
        </div>
      )}

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
