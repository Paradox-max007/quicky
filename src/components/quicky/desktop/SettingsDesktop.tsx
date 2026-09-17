'use client'

// Quicky — DESKTOP SETTINGS (Web Premium PRD §37-§38/§73)
// "Settings Navigation | Settings Content" with persistent category
// selection — never a mobile form stretched across the desktop. The right
// panel renders the app's REAL settings screens (account, notifications,
// appearance, privacy, dating, subscription…), so desktop and mobile always
// behave identically and there is exactly one implementation of each rule.

import { useEffect, useState } from 'react'
import {
  User, Phone, Mail, Bell, Palette, SlidersHorizontal, Shield, ShieldCheck,
  Crown, HelpCircle, FileText, LogOut, Gift, Sparkles, HeartHandshake, Settings as SettingsIcon,
  Gamepad2 } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { EditProfileScreen } from '../EditProfileScreen'
import { PhoneNumberScreen } from '../PhoneNumberScreen'
import { EmailScreen } from '../EmailScreen'
import { NotificationsScreen } from '../NotificationsScreen'
import { AppearanceScreen } from '../AppearanceScreen'
import { DiscoveryPreferencesScreen } from '../DiscoveryPreferencesScreen'
import { PrivacySettingsScreen } from '../PrivacySettingsScreen'
import { BlockedUsersScreen } from '../BlockedUsersScreen'
import { HelpSupportScreen } from '../HelpSupportScreen'
import { TermsOfServiceScreen, PrivacyPolicyScreen } from '../LegalScreens'
import { PremiumView } from '../PremiumView'
import { cn } from '@/lib/utils'

type CatId =
  | 'profile' | 'phone' | 'email'
  | 'notifications' | 'appearance' | 'dating'
  | 'privacy' | 'blocked'
  | 'subscription'
  | 'admin-gifts' | 'admin-rules' | 'admin-stickers' | 'admin-games'
  | 'help' | 'legal'

const GROUPS: { title: string; items: { id: CatId; label: string; icon: any }[] }[] = [
  {
    title: 'Account',
    items: [
      { id: 'profile', label: 'Edit Profile', icon: User },
      { id: 'phone', label: 'Phone Number', icon: Phone },
      { id: 'email', label: 'Email', icon: Mail },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'appearance', label: 'Appearance', icon: Palette },
      { id: 'dating', label: 'Dating', icon: SlidersHorizontal },
    ],
  },
  {
    title: 'Privacy & Safety',
    items: [
      { id: 'privacy', label: 'Privacy Settings', icon: Shield },
      { id: 'blocked', label: 'Blocked Users', icon: ShieldCheck },
    ],
  },
  {
    title: 'Subscription',
    items: [{ id: 'subscription', label: 'Manage Premium', icon: Crown }],
  },
  {
    title: 'Support',
    items: [
      { id: 'help', label: 'Help & Support', icon: HelpCircle },
      { id: 'legal', label: 'Terms & Policies', icon: FileText },
    ],
  },
]

const ADMIN_ITEMS: { id: CatId; label: string; icon: any }[] = [
  { id: 'admin-gifts', label: 'Gift Catalog', icon: Gift },
  { id: 'admin-rules', label: 'How It Works Rules', icon: HeartHandshake },
  { id: 'admin-stickers', label: 'Sticker Bundles', icon: Sparkles },
  { id: 'admin-games', label: 'Game Configuration', icon: Gamepad2 },
]

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-h-0 flex flex-col">{children}</div>
}

export function SettingsDesktop() {
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const user = useQuickyStore((s) => s.user)
  // Refactor PRD §11/§12: a web Edit Profile action may request a specific
  // section (Settings → Edit Profile). Consume the request once on mount.
  const requestedSection = useQuickyStore((s) => s.settingsSection)
  const clearSettingsSection = useQuickyStore((s) => s.clearSettingsSection)
  const [cat, setCat] = useState<CatId>((requestedSection as CatId) ?? 'profile')
  useEffect(() => {
    if (requestedSection) clearSettingsSection()
  }, [])
  const [confirmLogout, setConfirmLogout] = useState(false)

  const logout = async () => {
    try {
      await api.auth.logout().catch(() => {})
    } finally {
      setUser(null)
      setView('auth')
    }
  }

  const groups = user?.isAdmin
    ? [...GROUPS.slice(0, 4), { title: 'Admin', items: ADMIN_ITEMS }, GROUPS[4]]
    : GROUPS

  return (
    <div className="w-full h-full flex gap-7" data-testid="desktop-settings-page">
      {/* ── Settings navigation (§73: persistent category selection) ────── */}
      <aside className="w-[250px] shrink-0 h-full overflow-y-auto qk-desk-scroll" data-testid="settings-nav">
        <div className="flex items-center gap-2 mb-5 px-2">
          <SettingsIcon className="w-5 h-5 text-white/70" />
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        </div>
        {/* Games PRD §55 — dedicated admin console (separate shell at /admin). */}
        {user?.isAdmin && (
          <button
            onClick={() => window.open('/admin', '_blank')}
            className="mb-5 mx-2 flex items-center gap-2 rounded-xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 px-3 py-2.5 text-xs font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/20 transition-colors"
            data-testid="open-admin-console"
          >
            <Shield className="w-4 h-4" aria-hidden />
            Open Admin Console
          </button>
        )}
        {groups.map((g) => (
          <div key={g.title} className="mb-5">
            <p className="text-[10px] font-bold tracking-[0.18em] text-white/35 uppercase mb-1.5 px-2">{g.title}</p>
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const active = cat === it.id
                return (
                  <button
                    key={it.id}
                    onClick={() => setCat(it.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-sm transition-colors',
                      active ? 'bg-white/10 text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <it.icon className={cn('w-4 h-4 shrink-0', active ? 'text-[var(--qk-accent)]' : 'text-white/50')} />
                    {it.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <button
          onClick={() => setConfirmLogout(true)}
          className="mt-2 flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-[#FF6481] hover:bg-[var(--qk-accent)]/10 transition-colors w-full text-left"
          data-testid="settings-logout"
        >
          <LogOut className="w-4 h-4" /> Log Out
        </button>
        <p className="text-[10px] text-white/25 px-2.5 mt-4">Quicky v1.0.0</p>
      </aside>

      {/* ── Settings content — the REAL screens, reused (§81) ────────────── */}
      <section className="flex-1 min-w-0 h-full rounded-3xl border border-white/8 bg-[var(--qk-card)]/40 overflow-hidden" data-testid="settings-content">
        <Panel>
          {cat === 'profile' && <EditProfileScreen />}
          {cat === 'phone' && <PhoneNumberScreen inline />}
          {cat === 'email' && <EmailScreen inline />}
          {cat === 'notifications' && <NotificationsScreen />}
          {cat === 'appearance' && <AppearanceScreen />}
          {cat === 'dating' && <DiscoveryPreferencesScreen />}
          {cat === 'privacy' && <PrivacySettingsScreen />}
          {cat === 'blocked' && <BlockedUsersScreen />}
          {cat === 'help' && <HelpSupportScreen />}
          {cat === 'admin-gifts' && <AdminSlot kind="gifts" />}
          {cat === 'admin-rules' && <AdminSlot kind="rules" />}
          {cat === 'admin-stickers' && <AdminSlot kind="stickers" />}
          {cat === 'admin-games' && <AdminSlot kind="games" />}
          {cat === 'subscription' && (
            <div className="h-full overflow-y-auto qk-desk-scroll">
              <PremiumView />
            </div>
          )}
          {cat === 'legal' && (
            <div className="h-full overflow-y-auto qk-desk-scroll">
              <TermsOfServiceScreen />
              <div className="h-8" />
              <PrivacyPolicyScreen />
            </div>
          )}
        </Panel>
      </section>

      {/* Logout confirm — centered premium modal (§31) */}
      <AnimatePresence>
        {confirmLogout && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md"
            onClick={() => setConfirmLogout(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="bg-[var(--qk-card)] rounded-3xl p-6 max-w-xs w-full border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[var(--qk-accent)]/15 flex items-center justify-center">
                  <LogOut className="w-7 h-7 text-[var(--qk-accent)]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Log Out?</h2>
                  <p className="text-sm text-white/60 mt-1">Are you sure you want to log out of Quicky?</p>
                </div>
                <div className="flex flex-col gap-2 w-full mt-2">
                  <button
                    onClick={logout}
                    className="w-full bg-[var(--qk-accent)] rounded-2xl py-3 font-semibold text-sm active:scale-[0.98] transition-transform"
                  >
                    Log Out
                  </button>
                  <button
                    onClick={() => setConfirmLogout(false)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 font-medium text-sm text-white/80 hover:bg-white/10 transition-colors"
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

/**
 * The three admin screens are self-contained full views; inside the settings
 * panel they render the same way the phone screens do (their own chrome),
 * just hosted in the content area.
 */
function AdminSlot({ kind }: { kind: 'gifts' | 'rules' | 'stickers' | 'games' }) {
  const [Comp, setComp] = useState<null | React.ComponentType>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      if (kind === 'gifts') {
        const m = await import('../AdminGiftsScreen')
        if (alive) setComp(() => m.AdminGiftsScreen)
      } else if (kind === 'rules') {
        const m = await import('../AdminRulesScreen')
        if (alive) setComp(() => m.AdminRulesScreen)
      } else if (kind === 'games') {
        const m = await import('../AdminGamesScreen')
        if (alive) setComp(() => m.AdminGamesScreen)
      } else {
        const m = await import('../AdminStickersScreen')
        if (alive) setComp(() => m.AdminStickersScreen)
      }
    })()
    return () => {
      alive = false
    }
  }, [kind])
  if (!Comp) return null
  return (
    <div className="h-full overflow-y-auto qk-desk-scroll">
      <Comp />
    </div>
  )
}
