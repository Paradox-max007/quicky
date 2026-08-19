'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { Crown, Check, X, Sparkles, Heart, Zap, Camera, Filter, MapPin, Eye, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUICKY } from '@/lib/quicky/constants'

export function PremiumView() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const [plans, setPlans] = useState<any[]>([])
  const [selectedPlan, setSelectedPlan] = useState('monthly')
  const [subscribing, setSubscribing] = useState(false)
  const [subscription, setSubscription] = useState<any | null>(null)

  const refresh = async () => {
    try {
      const res = await api.premium.get()
      setPlans(res.plans)
      setSubscription(res.subscription)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const subscribe = async () => {
    setSubscribing(true)
    try {
      const res = await api.premium.subscribe(selectedPlan)
      if (res.ok) {
        toast.success('Welcome to Premium! \u{1F451}')
        // Refresh user
        const me = await api.auth.me()
        if (me.user) setUser(me.user)
        refresh()
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    } finally {
      setSubscribing(false)
    }
  }

  const cancel = async () => {
    if (!confirm('Cancel Premium? You’ll keep access until the end of your billing period.')) return
    try {
      const res = await api.premium.cancel()
      if (res.ok) {
        toast.success('Premium cancelled')
        const me = await api.auth.me()
        if (me.user) setUser(me.user)
        refresh()
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    }
  }

  const isPremium = user?.isPremium

  const PERKS = [
    { icon: Eye, label: 'See Who Liked You', desc: 'Full list of everyone who likes you' },
    { icon: Heart, label: 'Unlimited Likes', desc: 'No daily limit, ever' },
    { icon: Camera, label: 'Unlimited Quickies', desc: 'Send as many disappearing Quickies as you want' },
    { icon: Zap, label: '5 Super Likes / day', desc: '5x more Super Likes than free' },
    { icon: Sparkles, label: 'Truth or Dare + Games', desc: 'Exclusive in-chat games' },
    { icon: Filter, label: 'Advanced Filters', desc: 'Height, education, lifestyle, verified-only' },
    { icon: MapPin, label: 'Passport', desc: 'Match anywhere in the world' },
    { icon: Crown, label: 'Premium Badge', desc: 'Stand out with a gold badge' },
  ]

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white overflow-y-auto no-scrollbar">
      {/* Hero */}
      <div className="shrink-0 px-5 pt-6 pb-4 text-center relative">
        <div className="absolute inset-0 bg-gradient-to-b from-[#F5C570]/10 via-transparent to-transparent pointer-events-none" />
        <div className="relative">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-[#F5C570] to-[#B8A4FF] flex items-center justify-center glow-gold mb-3">
            <Crown className="w-8 h-8 text-white" fill="white" stroke="none" />
          </div>
          <h1 className="text-3xl font-extrabold text-gradient-gold tracking-tight">Quicky Premium</h1>
          <p className="text-white/60 text-sm mt-1 max-w-xs mx-auto text-pretty">
            {isPremium ? 'You’re a Premium member.' : 'Get the visibility, tools, and games to match faster.'}
          </p>
        </div>
      </div>

      {/* Perks grid */}
      <div className="px-4 pb-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2 px-1">Premium perks</h2>
        <div className="grid grid-cols-2 gap-2">
          {PERKS.map((p) => (
            <div key={p.label} className="bg-white/5 border border-white/8 rounded-2xl p-3">
              <div className="w-9 h-9 rounded-full bg-[#F5C570]/15 flex items-center justify-center mb-2">
                <p.icon className="w-4 h-4 text-[#F5C570]" />
              </div>
              <p className="text-sm font-semibold">{p.label}</p>
              <p className="text-xs text-white/50 mt-0.5">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Plans */}
      {!isPremium && plans.length > 0 && (
        <div className="px-4 pb-3">
          <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2 px-1">Choose a plan</h2>
          <div className="flex flex-col gap-2">
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlan(p.id)}
                className={cn(
                  'flex items-center justify-between p-3 rounded-2xl border-2 transition-all text-left',
                  selectedPlan === p.id
                    ? 'border-[#F5C570] bg-[#F5C570]/10 glow-gold'
                    : 'border-white/10 bg-white/5'
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      selectedPlan === p.id ? 'border-[#F5C570] bg-[#F5C570]' : 'border-white/30'
                    )}
                  >
                    {selectedPlan === p.id && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{p.label}</p>
                    {p.saveText && <p className="text-xs text-[#F5C570]">{p.saveText}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">${p.price}</p>
                  <p className="text-xs text-white/50">{p.period}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      {!isPremium ? (
        <div className="px-4 pb-4">
          <button
            onClick={subscribe}
            disabled={subscribing}
            className="w-full bg-gold-gradient glow-gold text-black rounded-2xl py-3.5 font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            <Crown className="w-5 h-5" fill="currentColor" stroke="none" />
            {subscribing ? 'Processing...' : 'Upgrade now'}
          </button>
          <p className="text-center text-xs text-white/40 mt-2">
            Demo: no real charge. Mock payment flips Premium instantly.
          </p>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="bg-white/5 border border-white/8 rounded-2xl p-4 mb-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold">Active Subscription</p>
              <span className="text-xs bg-[#F5C570]/20 text-[#F5C570] font-semibold px-2 py-0.5 rounded-full">PREMIUM</span>
            </div>
            {subscription && (
              <>
                <p className="text-xs text-white/60 capitalize">{subscription.plan} plan</p>
                <p className="text-xs text-white/50">
                  Renews on {new Date(subscription.expiresAt).toLocaleDateString()}
                </p>
              </>
            )}
          </div>
          <button
            onClick={cancel}
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 font-medium text-sm text-white/60 hover:bg-white/10"
          >
            Cancel Premium
          </button>
        </div>
      )}

      <div className="h-2" />
    </div>
  )
}
