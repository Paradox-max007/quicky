'use client'

import { useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Crown, Heart, Camera, Sparkles, Zap, Filter, Lock } from 'lucide-react'
import { QUICKY } from '@/lib/quicky/constants'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const PAYWALL_COPY: Record<
  string,
  { icon: any; title: string; body: string; perk: string }
> = {
  likes: {
    icon: Heart,
    title: 'You’re out of likes',
    body: 'Free users get 50 likes per day. Upgrade for unlimited likes — and unlimited chances to find your match.',
    perk: 'Unlimited Likes',
  },
  superlikes: {
    icon: Zap,
    title: 'Out of Super Likes',
    body: 'Free users get 1 Super Like per day. Premium gets 5 — five times the chance to stand out.',
    perk: '5 Super Likes / day',
  },
  quicky: {
    icon: Camera,
    title: 'Quicky limit reached',
    body: 'Free users get 8 Quickies per day. Premium sends unlimited disappearing Quickies — keep the streak alive.',
    perk: 'Unlimited Quickies',
  },
  games: {
    icon: Sparkles,
    title: 'Premium-only games',
    body: 'Truth or Dare, Never Have I Ever, Icebreaker Roulette — exclusive in-chat games to break the ice and keep matches talking.',
    perk: 'Truth or Dare + 4 more games',
  },
  see_likes: {
    icon: Crown,
    title: 'See who already likes you',
    body: 'Unlock the full list of everyone who’s liked you. Skip the wait — match instantly with people who already said yes.',
    perk: 'See Who Liked You',
  },
  advanced_filters: {
    icon: Filter,
    title: 'Advanced Filters',
    body: 'Filter by height, education, lifestyle, verified-only, recently active, and more.',
    perk: 'Advanced Filters',
  },
  boost: {
    icon: Zap,
    title: 'Boost your visibility',
    body: 'Get a 5x visibility boost for 30 minutes and appear at the top of discovery queues.',
    perk: '5x Boost for 30 min',
  },
  private_photos: {
    icon: Lock,
    title: 'Private Photos',
    body: 'Make select photos private so only your mutual matches can see them. Hide your most personal moments from the public discovery feed.',
    perk: 'Private Photos for matches only',
  },
  generic: {
    icon: Crown,
    title: 'Upgrade to Premium',
    body: 'Get unlimited likes, Quickies, exclusive games, advanced filters, and see who likes you.',
    perk: 'All Premium perks',
  },
}

export function PaywallModal() {
  const paywall = useQuickyStore((s) => s.paywall)
  const clearPaywall = useQuickyStore((s) => s.clearPaywall)
  const setView = useQuickyStore((s) => s.setView)
  const setUser = useQuickyStore((s) => s.setUser)
  const [selectedPlan, setSelectedPlan] = useState('monthly')
  const [subscribing, setSubscribing] = useState(false)

  if (!paywall) return null

  const copy = PAYWALL_COPY[paywall.kind] ?? PAYWALL_COPY.generic
  const Icon = copy.icon

  const subscribe = async () => {
    setSubscribing(true)
    try {
      const res = await api.premium.subscribe(selectedPlan)
      if (res.ok) {
        toast.success('Premium unlocked! \u{1F451}')
        const me = await api.auth.me()
        if (me.user) setUser(me.user)
        clearPaywall()
        setView('discovery')
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[180] flex items-end sm:items-center sm:justify-center bg-black/70 backdrop-blur-sm"
        onClick={clearPaywall}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="bg-[#0F0F14] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90%] overflow-y-auto no-scrollbar border-t border-[#F5C570]/30"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative p-5">
            <button onClick={clearPaywall} className="absolute top-3 right-3 p-2 rounded-full bg-white/5 hover:bg-white/10" aria-label="Close">
              <X className="w-5 h-5" />
            </button>

            {/* Hero icon */}
            <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-[#F5C570] to-[#B8A4FF] flex items-center justify-center glow-gold mb-3">
              <Icon className="w-8 h-8 text-white" />
            </div>

            <h2 className="text-xl font-bold text-center text-gradient-gold tracking-tight">{copy.title}</h2>
            <p className="text-sm text-white/60 text-center mt-2 text-pretty max-w-xs mx-auto">{copy.body}</p>

            {/* Perk highlight */}
            <div className="mt-4 mb-4 bg-[#F5C570]/10 border border-[#F5C570]/30 rounded-2xl px-3 py-2.5 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#F5C570]/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-[#F5C570]" />
              </div>
              <p className="text-sm font-semibold text-[#F5C570]">{copy.perk}</p>
            </div>

            {/* Plans */}
            <div className="flex flex-col gap-2 mb-4">
              {QUICKY.subscriptionPlans.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlan(p.id)}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-2xl border-2 transition-all text-left',
                    selectedPlan === p.id
                      ? 'border-[#F5C570] bg-[#F5C570]/10'
                      : 'border-white/10 bg-white/5'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      selectedPlan === p.id ? 'border-[#F5C570] bg-[#F5C570]' : 'border-white/30'
                    )}>
                      {selectedPlan === p.id && <span className="w-2 h-2 rounded-full bg-black" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{p.label}</p>
                      {'saveText' in p && p.saveText && <p className="text-xs text-[#F5C570]">{p.saveText}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold">${p.price}</p>
                    <p className="text-xs text-white/50">{p.period}</p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={subscribe}
              disabled={subscribing}
              className="w-full bg-gold-gradient glow-gold text-black rounded-2xl py-3.5 font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <Crown className="w-5 h-5" fill="currentColor" stroke="none" />
              {subscribing ? 'Processing...' : 'Unlock Premium'}
            </button>
            <button
              onClick={clearPaywall}
              className="w-full mt-2 text-white/50 text-xs hover:text-white"
            >
              Maybe later
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
