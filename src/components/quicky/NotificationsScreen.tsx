'use client'

import { useState, useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Toggle } from './Toggle'
import { MessageCircle, UserPlus, Heart, Eye, Bell, Crown } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToggleDef = {
  key: string
  label: string
  description: string
  icon: any
}

const TOGGLES: ToggleDef[] = [
  { key: 'notifMessages', label: 'Messages', description: 'New messages from your matches', icon: MessageCircle },
  { key: 'notifConnectionReqs', label: 'Connection Requests', description: 'When someone you liked likes you back', icon: UserPlus },
  { key: 'notifLikes', label: 'Likes', description: 'When someone likes your profile', icon: Heart },
  { key: 'notifProfileViews', label: 'Profile Views', description: 'When someone views your profile', icon: Eye },
  { key: 'notifSnackbars', label: 'In-app Snackbars', description: 'Toast notifications inside the app', icon: Bell },
]

export function NotificationsScreen() {
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
      // try to use the settings from the user object
      setSettings(user?.settings ?? null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const toggle = async (key: string, value: boolean) => {
    // Optimistic update
    setSettings((prev: any) => prev ? { ...prev, [key]: value } : prev)
    try {
      await api.settings.update({ [key]: value })
      // Refresh user store so other parts of the app can react
      const me = await api.auth.me()
      if (me.user) setUser(me.user)
    } catch (e: any) {
      // Revert on error
      setSettings((prev: any) => prev ? { ...prev, [key]: !value } : prev)
      toast.error(e.body?.error ?? e.message ?? 'Failed to update')
    }
  }

  if (loading) {
    return (
      <SettingsSubScreen title="Notifications">
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
        </div>
      </SettingsSubScreen>
    )
  }

  return (
    <SettingsSubScreen title="Notifications">
      <div className="px-5 py-5">
        {/* Notification preferences are a premium feature */}
        {!isPremium ? (
          <div className="flex flex-col items-center text-center py-10">
            <div className="w-16 h-16 rounded-full bg-[var(--qk-gold)]/15 flex items-center justify-center mb-4">
              <Crown className="w-8 h-8 text-[var(--qk-gold)]" />
            </div>
            <h2 className="text-lg font-semibold">Notifications are Premium</h2>
            <p className="text-white/50 text-sm mt-1 max-w-[260px]">
              Unlock granular control over messages, likes, profile views and in-app alerts.
            </p>
            <button
              onClick={() => showPaywall({ kind: 'generic' })}
              className="mt-5 bg-gradient-to-r from-[var(--qk-gold)] to-[var(--qk-purple)] rounded-full px-5 py-2.5 text-sm font-semibold"
            >
              Upgrade to Premium
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-white/50 mb-3 px-1">Control which notifications you receive.</p>
            <div className="bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
              {TOGGLES.map((t, idx) => (
                <div key={t.key}>
                  {idx > 0 && <div className="border-t border-white/5" />}
                  <ToggleRow
                    icon={<t.icon className="w-4 h-4 text-[var(--qk-accent-light)]" />}
                    label={t.label}
                    description={t.description}
                    value={settings?.[t.key] ?? true}
                    onChange={(v) => toggle(t.key, v)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SettingsSubScreen>
  )
}

function ToggleRow({
  icon, label, description, value, onChange,
}: {
  icon: React.ReactNode
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-white/50">{description}</p>
      </div>
      <Toggle value={value} onChange={onChange} label={label} />
    </div>
  )
}
