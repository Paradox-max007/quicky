'use client'

import { useState, useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Toggle } from './Toggle'
import { Eye, MapPin, Clock, Type, Crown, Lock, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

type PrivacyToggle = {
  key: string
  label: string
  description: string
  icon: any
  premium?: boolean
}

const TOGGLES: PrivacyToggle[] = [
  { key: 'privacyHideAge', label: 'Hide Age', description: 'Your age won\'t appear on your public profile', icon: Clock },
  { key: 'privacyHideDistance', label: 'Hide Distance', description: 'Your distance from others won\'t be shown', icon: MapPin },
  { key: 'privacyHideOnline', label: 'Hide Online Status', description: 'Don\'t show when you\'re online', icon: Eye, premium: true },
  { key: 'privacyHideTyping', label: 'Hide Typing Indicator', description: 'Don\'t show when you\'re typing in chat', icon: Type, premium: true },
  { key: 'privacyHideReadReceipts', label: 'Hide Read Receipts', description: 'Others won\'t see when you\'ve read their messages', icon: CheckCheck, premium: true },
]

export function PrivacySettingsScreen() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const isPremium = user?.isPremium ?? false

  const refresh = async () => {
    try {
      const res = await api.settings.get()
      setSettings(res.settings)
    } catch {
      setSettings(user?.settings ?? null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const toggle = async (key: string, value: boolean, isPremiumFeature: boolean) => {
    // Premium gate: online status + typing indicator
    if (isPremiumFeature && value && !isPremium) {
      showPaywall({ kind: 'private_photos' }) // reuse a premium paywall context
      return
    }
    // Optimistic update
    setSettings((prev: any) => prev ? { ...prev, [key]: value } : prev)
    try {
      await api.settings.update({ [key]: value })
      const me = await api.auth.me()
      if (me.user) setUser(me.user)
    } catch (e: any) {
      setSettings((prev: any) => prev ? { ...prev, [key]: !value } : prev)
      if (e.status === 402 && e.body?.paywall === 'privacy_premium') {
        showPaywall({ kind: 'private_photos' })
      } else {
        toast.error(e.body?.error ?? e.message ?? 'Failed to update')
      }
    }
  }

  if (loading) {
    return (
      <SettingsSubScreen title="Privacy Settings">
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
        </div>
      </SettingsSubScreen>
    )
  }

  return (
    <SettingsSubScreen title="Privacy Settings">
      <div className="px-5 py-5">
        <p className="text-xs text-white/50 mb-3 px-1">Control what others can see about you.</p>
        <div className="bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
          {TOGGLES.map((t, idx) => {
            const value = settings?.[t.key] ?? false
            const isLocked = t.premium && !isPremium
            return (
              <div key={t.key}>
                {idx > 0 && <div className="border-t border-white/5" />}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                    <t.icon className={cn('w-4 h-4', t.premium ? 'text-[var(--qk-gold)]' : 'text-[var(--qk-accent-light)]')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-medium">{t.label}</p>
                      {t.premium && (
                        <span className="text-[9px] font-bold bg-[var(--qk-gold)]/20 text-[var(--qk-gold)] px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <Crown className="w-2 h-2" fill="currentColor" stroke="none" /> PRO
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/50">{t.description}</p>
                  </div>
                  <div className={cn('shrink-0', isLocked && !value && 'opacity-60')}>
                    <Toggle value={!!value} onChange={(v) => toggle(t.key, v, !!t.premium)} label={t.label} />
                  </div>
                </div>
                {isLocked && !value && (
                  <button
                    onClick={() => showPaywall({ kind: 'private_photos' })}
                    className="w-full text-left text-[10px] text-[var(--qk-gold)] flex items-center gap-1 px-4 pb-2 hover:underline"
                  >
                    <Lock className="w-2.5 h-2.5" /> Unlock with Premium
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </SettingsSubScreen>
  )
}
