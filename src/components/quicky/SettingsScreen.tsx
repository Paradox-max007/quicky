'use client'

import { useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Settings as SettingsIcon, User, Phone, Mail, SlidersHorizontal,
  Bell, Palette, Shield, Lock, HelpCircle, FileText, LogOut, ChevronRight,
  Crown, RefreshCw, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Row = {
  id: string
  label: string
  icon: any
  iconColor?: string
  value?: string
  chevron?: boolean
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
  badge?: string
}

type Section = {
  title: string
  rows: Row[]
}

export function SettingsScreen() {
  const setView = useQuickyStore((s) => s.setView)
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  // Mask phone number: +1 (555) •••-••01
  const maskedPhone = (() => {
    if (!user?.phone) return '—'
    const digits = user.phone.replace(/\D/g, '')
    if (digits.length >= 10) {
      const last4 = digits.slice(-4)
      const last2 = digits.slice(-6, -4)
      return `+1 (${last2}••) •••-${last4}`
    }
    return user.phone
  })()

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await api.auth.logout().catch(() => {})
    } finally {
      setUser(null)
      setView('auth')
      setShowLogoutConfirm(false)
      setLoggingOut(false)
    }
  }

  const sections: Section[] = [
    {
      title: 'Account',
      rows: [
        {
          id: 'edit-profile',
          label: 'Edit Profile',
          icon: User,
          chevron: true,
          onClick: () => setView('edit-profile'),
        },
        {
          id: 'phone',
          label: 'Phone Number',
          icon: Phone,
          value: maskedPhone,
          chevron: true,
          onClick: () => setView('settings-phone'),
        },
        {
          id: 'email',
          label: 'Email',
          icon: Mail,
          value: user?.email || 'Not set',
          chevron: true,
          onClick: () => setView('settings-email'),
        },
      ],
    },
    {
      title: 'Preferences',
      rows: [
        {
          id: 'discovery-prefs',
          label: 'Discovery Preferences',
          icon: SlidersHorizontal,
          value: 'Age, distance, gender',
          chevron: true,
          onClick: () => setView('settings-discovery'),
        },
        {
          id: 'notifications',
          label: 'Notifications',
          icon: Bell,
          chevron: true,
          onClick: () => setView('settings-notifications'),
        },
        {
          id: 'appearance',
          label: 'Appearance / Theme',
          icon: Palette,
          value: user?.settings?.theme ? capitalize(user.settings.theme) : 'Dark',
          chevron: true,
          onClick: () => setView('settings-appearance'),
        },
      ],
    },
    {
      title: 'Privacy & Safety',
      rows: [
        {
          id: 'blocked-users',
          label: 'Blocked Users',
          icon: Shield,
          chevron: true,
          onClick: () => setView('settings-blocked'),
        },
        {
          id: 'privacy-settings',
          label: 'Privacy Settings',
          icon: Lock,
          chevron: true,
          onClick: () => setView('settings-privacy'),
        },
        {
          id: 'safety-center',
          label: 'Safety Center',
          icon: AlertCircle,
          chevron: true,
          onClick: () => toast.info('Safety center coming soon'),
          disabled: true,
        },
      ],
    },
    {
      title: 'Subscription',
      rows: [
        {
          id: 'manage-subscription',
          label: 'Manage Subscription',
          icon: Crown,
          value: user?.isPremium ? 'Premium' : 'Free',
          chevron: true,
          onClick: () => setView('premium'),
        },
        {
          id: 'restore-purchases',
          label: 'Restore Purchases',
          icon: RefreshCw,
          chevron: true,
          onClick: () => toast.info('Restore purchases coming soon'),
          disabled: true,
        },
      ],
    },
    {
      title: 'Support',
      rows: [
        {
          id: 'help',
          label: 'Help & Support',
          icon: HelpCircle,
          chevron: true,
          onClick: () => setView('settings-help'),
        },
        {
          id: 'terms',
          label: 'Terms of Service',
          icon: FileText,
          chevron: true,
          onClick: () => setView('settings-terms'),
        },
        {
          id: 'privacy-policy',
          label: 'Privacy Policy',
          icon: FileText,
          chevron: true,
          onClick: () => setView('settings-privacy-policy'),
        },
      ],
    },
    {
      title: 'Account Actions',
      rows: [
        {
          id: 'logout',
          label: 'Log Out',
          icon: LogOut,
          iconColor: '#FF2D55',
          destructive: true,
          onClick: () => setShowLogoutConfirm(true),
        },
      ],
    },
  ]

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white">
      <header className="shrink-0 px-3 pt-3 pb-3 flex items-center gap-2 border-b border-white/5">
        <button
          onClick={() => setView('profile-me')}
          className="p-2 hover:bg-white/5 rounded-full"
          aria-label="Back to Profile"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          Settings
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 flex flex-col gap-6">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wide px-3 mb-1.5">
              {section.title}
            </h2>
            <div className="bg-[var(--qk-card)] rounded-2xl overflow-hidden border border-white/5">
              {section.rows.map((row, idx) => (
                <button
                  key={row.id}
                  onClick={row.onClick}
                  disabled={row.disabled}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3.5 text-left transition-colors',
                    idx > 0 && 'border-t border-white/5',
                    row.destructive
                      ? 'hover:bg-[var(--qk-accent)]/10'
                      : row.disabled
                        ? 'opacity-50'
                        : 'hover:bg-white/5',
                    !row.disabled && 'active:bg-white/10'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                      row.destructive ? 'bg-[var(--qk-accent)]/15' : 'bg-white/5'
                    )}
                  >
                    <row.icon
                      className={cn('w-4 h-4', row.destructive ? 'text-[var(--qk-accent)]' : 'text-white/70')}
                      strokeWidth={2}
                    />
                  </div>
                  <span
                    className={cn(
                      'flex-1 text-sm font-medium',
                      row.destructive ? 'text-[var(--qk-accent)]' : 'text-white'
                    )}
                  >
                    {row.label}
                  </span>
                  {row.value && (
                    <span className="text-xs text-white/40 truncate max-w-[140px]">
                      {row.value}
                    </span>
                  )}
                  {row.badge && (
                    <span className="text-[10px] font-bold bg-[var(--qk-gold)]/20 text-[var(--qk-gold)] px-2 py-0.5 rounded-full">
                      {row.badge}
                    </span>
                  )}
                  {row.chevron && !row.disabled && (
                    <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
                  )}
                  {row.chevron && row.disabled && (
                    <span className="text-[10px] text-white/30 shrink-0">Soon</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="text-center text-xs text-white/30 pb-4">
          Quicky v1.0.0
        </div>
      </div>

      <AnimatePresence>
        {showLogoutConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-8"
            onClick={() => !loggingOut && setShowLogoutConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="bg-[var(--qk-card)] rounded-3xl p-6 max-w-xs w-full border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[var(--qk-accent)]/15 flex items-center justify-center">
                  <LogOut className="w-7 h-7 text-[var(--qk-accent)]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Log Out?</h2>
                  <p className="text-sm text-white/60 mt-1 text-pretty">
                    Are you sure you want to log out of Quicky?
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full mt-2">
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="w-full bg-[var(--qk-accent)] rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {loggingOut ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Logging out...
                      </>
                    ) : (
                      'Log Out'
                    )}
                  </button>
                  <button
                    onClick={() => setShowLogoutConfirm(false)}
                    disabled={loggingOut}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 font-medium text-sm text-white/80 hover:bg-white/10 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
