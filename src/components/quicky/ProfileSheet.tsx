'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { X, BadgeCheck, Crown, MapPin } from 'lucide-react'
import { getScoreTier } from '@/lib/quicky/constants'
import { Sparkles } from 'lucide-react'

export function ProfileSheet({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}) {
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [photoIdx, setPhotoIdx] = useState(0)

  useEffect(() => {
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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[140] bg-black/70 flex items-end sm:items-center sm:justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="bg-[#0F0F14] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90%] overflow-y-auto no-scrollbar"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <button onClick={onClose} className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60" aria-label="Close">
              <X className="w-5 h-5 text-white" />
            </button>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
              </div>
            ) : !profile ? (
              <div className="h-64 flex items-center justify-center text-white/40">Not found</div>
            ) : (
              <>
                {/* Photo carousel */}
                {profile.photos?.length > 0 && (
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-t-3xl">
                    <img src={profile.photos[photoIdx]?.url} alt={profile.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
                    {profile.photos.length > 1 && (
                      <>
                        <button className="absolute left-0 top-0 bottom-0 w-1/3" onClick={() => setPhotoIdx((i) => (i - 1 + profile.photos.length) % profile.photos.length)} aria-label="Previous" />
                        <button className="absolute right-0 top-0 bottom-0 w-1/3" onClick={() => setPhotoIdx((i) => (i + 1) % profile.photos.length)} aria-label="Next" />
                        <div className="absolute top-3 left-3 right-12 flex gap-1">
                          {profile.photos.map((_, i) => (
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
                    <div className="flex flex-wrap gap-1.5">
                      {profile.interests.map((t: string) => (
                        <span key={t} className="text-xs font-medium bg-white/8 rounded-full px-2.5 py-1 capitalize">
                          {t.replace(/-/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {profile.prompts?.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {profile.prompts.map((p: any, i: number) => (
                        <div key={i} className="bg-white/5 rounded-2xl p-3">
                          <p className="text-xs font-semibold text-[#FF5E7E] mb-1">{p.prompt}</p>
                          <p className="text-sm text-white/80 text-pretty">{p.answer}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile.quickyScore > 0 && (
                    <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-3">
                      <Sparkles className="w-6 h-6" style={{ color: getScoreTier(profile.quickyScore).current.color }} />
                      <div className="flex-1">
                        <p className="text-xs text-white/60">Quicky Score</p>
                        <p className="font-bold text-lg">{profile.quickyScore}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-white/60">Tier</p>
                        <p className="font-bold text-sm" style={{ color: getScoreTier(profile.quickyScore).current.color }}>
                          {getScoreTier(profile.quickyScore).current.name}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
