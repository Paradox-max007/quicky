'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Crown, Heart, Camera, Sparkles, Zap, Filter, Lock } from 'lucide-react'
import { QUICKY } from '@/lib/quicky/constants'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PREMIUM_PARTY_GAMES } from '@/lib/quicky/entitlements'

const PAYWALL_COPY: Record<
  string,
  { icon: any; title: string; body: string; perk: string }
> = {
  likes: {
    icon: Heart,
    title: 'You’re out of likes',
    // Premium Party Games PRD §13 — free likes lowered from 50 to 10/day.
    body: 'Free users get 10 likes per day. Upgrade for unlimited likes — and unlimited chances to find your match.',
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
    // Premium Party Games PRD §3, §42 — the games paywall now advertises
    // the Premium Party Games category (Spin the Bottle + Ludo). Truth or
    // Dare is intentionally NOT mentioned here because it remains free
    // (PRD §1 — "Free Game").
    title: 'Premium Party Games',
    body: 'Quicky Premium includes Spin the Bottle and Ludo — premium party games that make any match more fun.',
    perk: 'Spin the Bottle + Ludo',
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
  const isDesk = useIsDesktopShell() === true
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // §31: ESC closes on desktop, focus is trapped inside the dialog, and the
  // page behind the dark blurred backdrop cannot scroll.
  useEffect(() => {
    if (!paywall || !isDesk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearPaywall()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const root = document.querySelector('[data-qk-root]') as HTMLElement | null
    const prevOverflow = root?.style.overflow ?? ''
    if (root) root.style.overflow = 'hidden'
    const t = setTimeout(() => dialogRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (root) root.style.overflow = prevOverflow
      clearTimeout(t)
    }
  }, [paywall, isDesk, clearPaywall])

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
        className={
          // §30/§71: CENTERED popup over a dark translucent blurred backdrop —
          // never top/bottom anchored on desktop. Mobile keeps its sheet.
          isDesk
            ? 'fixed inset-0 z-[180] flex items-center justify-center bg-black/75 backdrop-blur-md p-6'
            : 'absolute inset-0 z-[180] flex items-end sm:items-center sm:justify-center bg-black/70 backdrop-blur-sm'
        }
        onClick={clearPaywall}
      >
        <motion.div
          initial={isDesk ? { opacity: 0, scale: 0.92, y: 0 } : { y: '100%' }}
          animate={isDesk ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
          exit={isDesk ? { opacity: 0, scale: 0.94, y: 0 } : { y: '100%' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          className={
            isDesk
              ? 'bg-[var(--qk-bg)] rounded-3xl w-full max-w-sm max-h-[88%] overflow-y-auto qk-desk-scroll border border-[var(--qk-gold)]/30 shadow-2xl outline-none'
              : 'bg-[var(--qk-bg)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90%] overflow-y-auto no-scrollbar border-t border-[var(--qk-gold)]/30'
          }
          data-testid={isDesk ? 'paywall-modal-desktop' : 'paywall-modal-mobile'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative p-5">
            <button onClick={clearPaywall} className="absolute top-3 right-3 p-2 rounded-full bg-white/5 hover:bg-white/10" aria-label="Close">
              <X className="w-5 h-5" />
            </button>

            {/* Hero icon */}
            <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-[var(--qk-gold)] to-[var(--qk-purple)] flex items-center justify-center glow-gold mb-3">
              <Icon className="w-8 h-8 text-white" />
            </div>

            <h2 className="text-xl font-bold text-center text-gradient-gold tracking-tight">{copy.title}</h2>
            <p className="text-sm text-white/60 text-center mt-2 text-pretty max-w-xs mx-auto">{copy.body}</p>

            {/* Perk highlight */}
            <div className="mt-4 mb-3 bg-[var(--qk-gold)]/10 border border-[var(--qk-gold)]/30 rounded-2xl px-3 py-2.5 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[var(--qk-gold)]/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-[var(--qk-gold)]" />
              </div>
              <p className="text-sm font-semibold text-[var(--qk-gold)]">{copy.perk}</p>
            </div>

            {/* Premium Party Games PRD §3, §42 — every paywall variant lists
                the Premium Party Games category so users see the value no
                matter which entry point fired the modal. The list is driven
                by the central PREMIUM_PARTY_GAMES array from entitlements.ts
                so adding a new game later automatically updates this UI. */}
            <div className="mb-4 -mt-1 px-3 py-2.5 rounded-2xl border border-[var(--qk-accent)]/25 bg-[var(--qk-accent)]/8">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--qk-accent-light)] mb-1.5">
                Premium Party Games
              </p>
              <ul className="space-y-1.5">
                {PREMIUM_PARTY_GAMES.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 text-sm text-white/85">
                    <span className="text-base leading-none">{g.emoji}</span>
                    <span className="font-medium">{g.name}</span>
                  </li>
                ))}
              </ul>
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
                      ? 'border-[var(--qk-gold)] bg-[var(--qk-gold)]/10'
                      : 'border-white/10 bg-white/5'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      selectedPlan === p.id ? 'border-[var(--qk-gold)] bg-[var(--qk-gold)]' : 'border-white/30'
                    )}>
                      {selectedPlan === p.id && <span className="w-2 h-2 rounded-full bg-black" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{p.label}</p>
                      {'saveText' in p && p.saveText && <p className="text-xs text-[var(--qk-gold)]">{p.saveText}</p>}
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
