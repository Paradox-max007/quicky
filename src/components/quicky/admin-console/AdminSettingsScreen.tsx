'use client'

// Quicky — ADMIN SETTINGS (admin-console PRD §3.2/§4/§17)
//
// Console configuration: the "Open Web App" URL (configurable — never a
// hardcoded production domain), the designated TEST ACCOUNT (server-side
// authorized + environment-restricted "Open as Test User"), and the asset
// storage status (Supabase Storage vs local fallback).
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, HardDrive, RefreshCw, RotateCcw, Save, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type TestAccountInfo = {
  id: string
  userId: string
  displayName: string
  enabled: boolean
  allowedEnvironments: string[]
  environment: string
  environmentAllowed: boolean
  user: { id: string; name: string | null; phone: string; onboarded: boolean; coinBalance: number } | null
} | null

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

export function AdminSettingsScreen() {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [webAppUrl, setWebAppUrl] = useState('')
  const [storage, setStorage] = useState<{ mode: string; bucket: string; configured: boolean } | null>(null)
  const [testAccount, setTestAccount] = useState<TestAccountInfo>(null)
  const [environment, setEnvironment] = useState('development')
  const [userIdDraft, setUserIdDraft] = useState('')
  const [displayName, setDisplayName] = useState('Quicky Tester')
  const [enabled, setEnabled] = useState(false)
  const [allowedEnvironments, setAllowedEnvironments] = useState('development')
  const [savingUrl, setSavingUrl] = useState(false)
  const [savingTest, setSavingTest] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [settingsRes, testRes] = await Promise.all([
        api.admin.consoleSettings.get(),
        api.admin.testAccount.get(),
      ])
      setWebAppUrl(settingsRes?.settings?.webAppUrl ?? '')
      setStorage(settingsRes?.storage ?? null)
      setTestAccount((testRes?.testAccount ?? null) as TestAccountInfo)
      setEnvironment(String(testRes?.environment ?? 'development'))
      if (testRes?.testAccount) {
        setUserIdDraft(testRes.testAccount.userId ?? '')
        setDisplayName(testRes.testAccount.displayName ?? 'Quicky Tester')
        setEnabled(!!testRes.testAccount.enabled)
        setAllowedEnvironments((testRes.testAccount.allowedEnvironments ?? ['development']).join(','))
      }
      setLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveUrl = async () => {
    setSavingUrl(true)
    try {
      await api.admin.consoleSettings.set('webAppUrl', webAppUrl.trim())
      toast.success('Web app URL saved')
    } catch (e: unknown) {
      const err = e as { message?: string; body?: { message?: string } }
      toast.error(err?.body?.message ?? err?.message ?? 'Save failed')
    } finally {
      setSavingUrl(false)
    }
  }

  const saveTestAccount = async () => {
    if (!userIdDraft.trim()) {
      toast.error('Enter the test user id (User ID from the Users screen)')
      return
    }
    setSavingTest(true)
    try {
      await api.admin.testAccount.save({ userId: userIdDraft.trim(), displayName, enabled, allowedEnvironments })
      toast.success('Test account saved')
      await load()
    } catch (e: unknown) {
      const err = e as { message?: string; body?: { message?: string } }
      toast.error(err?.body?.message ?? err?.message ?? 'Save failed')
    } finally {
      setSavingTest(false)
    }
  }

  const reset = async (kind: 'reset-progress' | 'reset-inventory') => {
    if (!testAccount?.userId && !userIdDraft.trim()) {
      toast.error('Save the test account first')
      return
    }
    if (!confirm(kind === 'reset-progress' ? 'Reset test realm/season progression to level 1, season 1?' : 'Clear test rewards, items, stickers and cosmetics?')) return
    try {
      await api.admin.testAccount.reset(testAccount?.userId ?? userIdDraft.trim(), kind)
      toast.success(kind === 'reset-progress' ? 'Progress reset' : 'Inventory cleared')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  if (failed) return <ConsoleRetry onRetry={load} />
  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/40 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading settings…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ConsoleCard title="Web App">
        <p className="text-xs text-white/50 mb-3 leading-relaxed">
          The URL the header&apos;s <b>Open Web App</b> button launches in a new tab. Use a full URL (https://your-app.example) or leave it
          empty to open this deployment&apos;s root. Your admin session is untouched.
        </p>
        <div className="flex gap-2">
          <input value={webAppUrl} onChange={(e) => setWebAppUrl(e.target.value)} placeholder="https://quicky.example.com (empty = this site)" className={inputCls} />
          <button onClick={saveUrl} disabled={savingUrl} className="flex items-center gap-1.5 rounded-xl bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-4 text-xs font-bold disabled:opacity-50 shrink-0">
            <Save className="w-3.5 h-3.5" aria-hidden /> {savingUrl ? '…' : 'Save'}
          </button>
        </div>
      </ConsoleCard>

      <ConsoleCard title="Asset Storage">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${storage?.configured ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-amber-500/15 text-amber-300'}`}>
            <HardDrive className="w-5 h-5" aria-hidden />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold">
              {storage?.mode === 'supabase' ? 'Supabase Storage' : 'Local filesystem fallback'}
            </p>
            <p className="text-[11px] text-white/40 leading-relaxed">
              {storage?.mode === 'supabase'
                ? `Uploads land in the "${storage?.bucket}" bucket (public read). Binaries never live on the app server.`
                : 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to store assets in Supabase Storage. Until then, admin uploads land under /uploads/assets/.'}
            </p>
          </div>
        </div>
      </ConsoleCard>

      <ConsoleCard title="Test Account">
        <p className="text-xs text-white/50 mb-3 leading-relaxed">
          A designated account the admin can open the user app as — the session is created <b>server-side</b> (credentials are never
          exposed to the frontend) and only in allowed environments. Current environment:{' '}
          <span className={`font-bold ${testAccount?.environmentAllowed ? 'text-[#30D158]' : 'text-amber-300'}`}>{environment}</span>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Test user id</label>
            <input value={userIdDraft} onChange={(e) => setUserIdDraft(e.target.value)} placeholder="copy from the Users screen" className={`${inputCls} mt-1`} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={`${inputCls} mt-1`} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Allowed environments (comma-separated)</label>
            <input value={allowedEnvironments} onChange={(e) => setAllowedEnvironments(e.target.value)} placeholder="development,preview" className={`${inputCls} mt-1`} />
            <p className="text-[10px] text-white/30 mt-1">Options: development, preview, staging, production</p>
          </div>
          <div className="flex items-end pb-2.5">
            <label className="flex items-center gap-2 text-xs text-white/60">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[var(--qk-accent)]" />
              Test access enabled
            </label>
          </div>
        </div>

        {testAccount?.user && (
          <p className="text-[11px] text-white/40 mt-3">
            Linked user: <b className="text-white/70">{testAccount.user.name ?? testAccount.user.phone}</b>
            {testAccount.user.onboarded ? ' · onboarded' : ' · needs onboarding'} · {testAccount.user.coinBalance} coins
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button onClick={saveTestAccount} disabled={savingTest} className="flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-4 py-2 text-xs font-bold disabled:opacity-50">
            <Save className="w-3.5 h-3.5" aria-hidden /> {savingTest ? 'Saving…' : 'Save test account'}
          </button>
          <button
            onClick={() => reset('reset-progress')}
            className="flex items-center gap-1.5 rounded-full bg-white/8 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white/70"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Reset progression
          </button>
          <button
            onClick={() => reset('reset-inventory')}
            className="flex items-center gap-1.5 rounded-full bg-white/8 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white/70"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Reset inventory
          </button>
          {testAccount?.environmentAllowed && testAccount?.enabled && (
            <a
              href="/api/quicky/admin/test-account/open"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-xs font-bold text-amber-300"
              title="Opens the user app as the test user in a new tab — this browser's admin session is replaced server-side."
            >
              <TestTube2 className="w-3.5 h-3.5" aria-hidden /> Open as Test User ↗
            </a>
          )}
        </div>
      </ConsoleCard>

      <ConsoleCard title="Admin Navigation">
        <p className="text-xs text-white/50 leading-relaxed">
          <ExternalLink className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" aria-hidden />
          The header&apos;s <b>Open Web App</b> button opens the user-facing app in a separate tab without logging you out. Admins also
          land on this console directly after login (no app redirect).
        </p>
      </ConsoleCard>
    </div>
  )
}
