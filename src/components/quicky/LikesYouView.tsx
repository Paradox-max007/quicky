'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { Sparkles, Lock, Crown } from 'lucide-react'

export function LikesYouView() {
  const user = useQuickyStore((s) => s.user)
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const [likes, setLikes] = useState<any[]>([])
  const [isPremium, setIsPremium] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await api.likesYou()
      setLikes(res.likes)
      setIsPremium(res.isPremium)
      setLockedCount(res.lockedCount)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white">
      <header className="shrink-0 px-5 pt-3 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Likes You</h1>
          <p className="text-xs text-white/50">
            {isPremium ? `${likes.length} people like you` : `${lockedCount} people like you (locked)`}
          </p>
        </div>
      </header>

      {/* Free user upsell banner */}
      {!isPremium && likes.length > 0 && (
        <div className="mx-5 mb-3 rounded-2xl bg-gradient-to-r from-[#FF2D55]/20 to-[#B8A4FF]/15 border border-[#FF2D55]/30 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FF2D55]/20 flex items-center justify-center">
            <Crown className="w-5 h-5 text-[#F5C570]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Unlock to see who likes you</p>
            <p className="text-xs text-white/60">{likes.length} people waiting</p>
          </div>
          <button
            onClick={() => showPaywall({ kind: 'see_likes' })}
            className="bg-coral-gradient rounded-full px-3 py-1.5 text-xs font-semibold"
          >
            Unlock
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
          </div>
        ) : likes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Sparkles className="w-12 h-12 text-white/20 mb-3" />
            <h2 className="text-lg font-semibold">No likes yet</h2>
            <p className="text-white/50 text-sm mt-1">Keep your profile fresh and they’ll come.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {likes.map((l) => (
              <li
                key={l.id}
                className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-white/5 border border-white/8"
              >
                {l.photo && isPremium ? (
                  <img src={l.photo} alt={l.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 animate-shimmer flex items-center justify-center">
                    <Lock className="w-6 h-6 text-white/30" />
                  </div>
                )}
                {/* Free user blur overlay */}
                {!isPremium && (
                  <div className="absolute inset-0 backdrop-blur-md bg-black/30 flex items-end p-2">
                    <div className="w-full text-center">
                      <p className="text-xs font-semibold text-white/80">Locked</p>
                    </div>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-xs font-semibold truncate">
                    {isPremium ? `${l.name}, ${l.age}` : '?'}
                  </p>
                  {l.superLike && (
                    <p className="text-[10px] text-[#B8A4FF] font-medium flex items-center gap-0.5">
                      <Sparkles className="w-2.5 h-2.5" /> Super Like
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
