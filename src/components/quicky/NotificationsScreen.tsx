'use client'

import { useState, useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Toggle } from './Toggle'
import { MessageCircle, UserPlus, Heart, Eye, Bell, Crown, Gamepad2, Zap, BellRing, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { enablePushNotifications, webPushPermission, pushCurrentlyEnabled } from '@/lib/quicky/push-client'

type ToggleDef = {
  key: string
  label: string
  description: string
  icon: any
}

// FCM push-backed preferences — every toggle gates a real push event
// server-side (src/lib/quicky/push.ts → swipe / dm / game-chat / profile).
const TOGGLES: ToggleDef[] = [
  { key: 'notifMessages', label: 'Messages', description: 'New messages from your matches and game chats', icon: MessageCircle },
  { key: 'notifConnectionReqs', label: 'Matches', description: 'When someone you liked likes you back', icon: UserPlus },
  { key: 'notifLikes', label: 'Likes', description: 'When someone likes your profile', icon: Heart },
  { key: 'notifSuperLikes', label: 'Super Likes', description: 'When someone super likes your profile', icon: Zap },
  { key: 'notifProfileViews', label: 'Profile Views', description: 'When someone views your profile', icon: Eye },
  { key: 'notifSnackbars', label: 'In-app Snackbars', description: 'Toast notifications inside the app', icon: Bell },
]

export function NotificationsScreen() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const showPaywall = useQuickyStore((s) => s.showPaywall)
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [pushEnabling, setPushEnabling] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)

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
    // Reflect the current device push state on every mount.
    setPushEnabled(pushCurrentlyEnabled())
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
      if (e?.status === 402) {
        toast.error('Notification preferences are a Premium feature')
        showPaywall({ kind: 'generic' })
      } else {
        toast.error(e.body?.error ?? e.message ?? 'Failed to update')
      }
    }
  }

  const enablePush = async () => {
    if (pushEnabling) return
    setPushEnabling(true)
    const res = await enablePushNotifications()
    setPushEnabling(false)
    if (res.ok) {
      setPushEnabled(true)
      toast.success('Push notifications enabled on this device')
    } else if (res.reason === 'permission_denied') {
      toast.error('Notification permission was denied — allow it in your browser/site settings')
    } else if (res.reason === 'not_configured') {
      toast.error('Push is not configured on this deployment (missing Firebase env vars)')
    } else if (res.reason === 'unsupported') {
      toast.error('This device does not support push notifications')
    } else {
      toast.error('Could not enable push notifications')
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

  const permission = webPushPermission()

  return (
    <SettingsSubScreen title="Notifications">
      <div className="px-5 py-5">
        {/* Notification preferences — ALL premium */}
        {!isPremium ? (
          <div className="flex flex-col items-center text-center py-10">
            <div className="w-16 h-16 rounded-full bg-[var(--qk-gold)]/15 flex items-center justify-center mb-4">
              <Crown className="w-8 h-8 text-[var(--qk-gold)]" />
            </div>
            <h2 className="text-lg font-semibold">Notifications are Premium</h2>
            <p className="text-white/50 text-sm mt-1 max-w-[260px] leading-relaxed">
              Unlock Firebase push notifications and granular control over messages, matches, likes, super likes, profile views and in-game alerts.
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

            {/* ── In-game notifications — premium like every other toggle ── */}
            <p className="text-xs text-white/50 mt-5 mb-3 px-1">In-game alerts</p>
            <div className="bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
              <ToggleRow
                icon={<Gamepad2 className="w-4 h-4 text-[var(--qk-accent-light)]" />}
                label="In-game Notifications"
                description="Turn prompts + private game message alerts while you're off the game screen"
                value={settings?.notifGameEvents ?? true}
                onChange={(v) => toggle('notifGameEvents', v)}
              />
            </div>

            {/* ── FCM device push (Firebase) ─────────────────────────────── */}
            <p className="text-xs text-white/50 mt-5 mb-3 px-1">Push on this device</p>
            <div className="rounded-2xl border border-white/8 bg-white/5 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                  <BellRing className={cn('w-4 h-4', pushEnabled ? 'text-[#30D158]' : 'text-[var(--qk-accent-light)]')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Firebase Push (FCM)</p>
                  <p className="text-xs text-white/50 leading-snug">
                    {pushEnabled
                      ? 'Enabled — messages, matches, likes, super likes and profile views reach this device.'
                      : permission === 'denied'
                        ? 'Blocked in this browser — allow notifications in your browser settings, then retry.'
                        : 'Get push notifications for messages, matches, likes, super likes and profile views.'}
                  </p>
                </div>
                {pushEnabled ? (
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-[#30D158]">
                    <Check className="w-4 h-4" aria-hidden /> On
                  </span>
                ) : (
                  <button
                    onClick={() => void enablePush()}
                    disabled={pushEnabling}
                    className="shrink-0 text-[12px] font-bold bg-[var(--qk-accent)] text-[var(--qk-on-accent)] rounded-full px-4 py-2 active:scale-95 transition-transform disabled:opacity-50"
                    data-testid="enable-push-button"
                  >
                    {pushEnabling ? 'Enabling…' : 'Enable'}
                  </button>
                )}
              </div>
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
