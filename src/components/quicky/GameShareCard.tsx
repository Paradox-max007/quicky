'use client'

// Quicky — post-game result card. Every game generates a catchy template post
// for both players when the session ends; this card previews it and offers a
// one-tap "Share to Community".
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Share2, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export type GamePostInfo = {
  gameType: string
  title: string
  body: string
  emoji: string
  shared?: boolean
}

const GRADIENTS: Record<string, string> = {
  ludo: 'from-[#7C3AED] via-[#A855F7] to-[#EC4899]',
  truth_or_dare: 'from-[#FF5A79] via-[#F43F5E] to-[#F97316]',
  never_have_i_ever: 'from-[#0EA5E9] via-[#6366F1] to-[#8B5CF6]',
}

export function GameShareCard({
  matchId,
  sessionId,
  post,
  partnerName,
  onClose,
}: {
  matchId: string
  sessionId: string
  post: GamePostInfo
  partnerName?: string | null
  onClose: () => void
}) {
  const [shared, setShared] = useState(!!post.shared)
  const [busy, setBusy] = useState(false)
  const [mutual, setMutual] = useState(false)

  const share = async () => {
    if (busy || shared) return
    setBusy(true)
    try {
      const res = await api.gamePosts.share(sessionId)
      if (res.ok) {
        setShared(true)
        setMutual(!!res.mutual)
        toast.success(res.mutual ? 'Shared — mutual game post created! 🎉' : 'Shared to Community! 🎉')
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to share')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm mx-auto flex flex-col gap-3"
    >
      <div
        className={cn(
          'rounded-3xl p-5 bg-gradient-to-br text-white shadow-xl relative overflow-hidden',
          GRADIENTS[post.gameType] ?? 'from-[var(--qk-purple)] to-[var(--qk-accent)]'
        )}
      >
        <p className="text-4xl">{post.emoji}</p>
        <h3 className="text-xl font-black mt-2">{post.title}</h3>
        <p className="text-sm text-white/90 mt-1.5 leading-relaxed">{post.body}</p>
        <p className="text-[10px] uppercase tracking-widest text-white/60 mt-3">Quicky Games</p>
        {mutual && (
          <span className="absolute top-4 right-4 text-[10px] font-bold bg-white/25 rounded-full px-2.5 py-1">
            Mutual post ✨
          </span>
        )}
      </div>

      <button
        onClick={shared ? onClose : share}
        disabled={busy}
        className={cn(
          'rounded-2xl py-3 font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60',
          shared ? 'bg-white/10 border border-white/15 text-white/70' : 'bg-coral-gradient glow-coral'
        )}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : shared ? (
          <>
            <Check className="w-4 h-4" /> Shared — Done
          </>
        ) : (
          <>
            <Share2 className="w-4 h-4" /> Share to Community
          </>
        )}
      </button>
      <p className="text-center text-[11px] text-white/40">
        {shared
          ? mutual
            ? 'You both shared — this post now belongs to you both!'
            : 'If they share too, it becomes a mutual post ✨'
          : `A post was generated for you and ${partnerName ?? 'them'} — share yours to the Community.`}
      </p>
    </motion.div>
  )
}
