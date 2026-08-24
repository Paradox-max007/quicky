'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore, MatchPreview } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { MessageCircle, Flame, Crown, BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

export function ChatList() {
  const openChat = useQuickyStore((s) => s.openChat)
  const [matches, setMatches] = useState<MatchPreview[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await api.matches()
      setMatches(res.matches)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load matches')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white">
      <header className="shrink-0 px-5 pt-3 pb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Chats</h1>
        <button onClick={refresh} className="text-xs text-white/50 hover:text-white">Refresh</button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4">
        {loading && matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageCircle className="w-12 h-12 text-white/20 mb-3" />
            <h2 className="text-lg font-semibold">No matches yet</h2>
            <p className="text-white/50 text-sm mt-1">Start swiping in Discover to make a match.</p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => openChat(m.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 transition-colors',
                    m.unread && 'bg-white/[0.03]'
                  )}
                >
                  <div className="relative shrink-0">
                    {m.partner.photo ? (
                      <img src={m.partner.photo} alt={m.partner.name ?? ''} className="w-14 h-14 rounded-full object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-xl font-bold">
                        {m.partner.name?.[0] ?? '?'}
                      </div>
                    )}
                    {m.partner.isPremium && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--qk-card)] flex items-center justify-center">
                        <Crown className="w-3 h-3 text-gradient-gold" fill="currentColor" stroke="none" />
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold truncate">{m.partner.name}, {m.partner.age}</span>
                      {m.partner.isVerified && (
                        <BadgeCheck className="w-4 h-4 text-[var(--qk-accent)]" fill="currentColor" stroke="white" />
                      )}
                      {m.streak > 0 && (
                        <span className="text-xs flex items-center gap-0.5 ml-auto shrink-0">
                          <Flame className="w-3.5 h-3.5 text-[#FF9120] animate-flame" fill="currentColor" stroke="none" />
                          <span className="text-[#FF9120] font-semibold">{m.streak}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className={cn('text-sm truncate flex-1', m.unread ? 'text-white' : 'text-white/50')}>
                        {m.preview}
                      </p>
                      {m.unread && (
                        <span className="w-2 h-2 rounded-full bg-[var(--qk-accent)] glow-coral shrink-0" />
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
