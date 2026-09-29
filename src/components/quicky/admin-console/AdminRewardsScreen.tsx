'use client'

// Quicky — ADMIN: REWARDED ADS SCREEN (Monetization PRD §9.1)
//
// Reward configuration (enabled, per-currency toggles, 10–100 range, daily
// limit, cooldown, timezone), aggregate stats and a session search table.
// Changing settings never retroactively modifies completed sessions.
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type RewardConfig = {
  enabled: boolean
  coinsEnabled: boolean
  pointsEnabled: boolean
  minReward: number
  maxReward: number
  dailyLimit: number
  cooldownSeconds: number
  timezone: string
}

type SessionRow = {
  id: string
  userId: string
  rewardType: string
  status: string
  provider: string
  rewardAmount: number | null
  createdAt: string
  completedAt: string | null
}

type Payload = {
  config: RewardConfig
  stats: {
    windowDays: number
    impressions: number
    completions: number
    verificationFailureRate: number
    rewardsIssuedCount: number
    byStatus: Record<string, number>
  }
  sessions: SessionRow[]
}

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

export function AdminRewardsScreen() {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [data, setData] = useState<Payload | null>(null)
  const [draft, setDraft] = useState<RewardConfig | null>(null)
  const [userFilter, setUserFilter] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (userId?: string) => {
    setFailed(false)
    try {
      const res = await jsonFetchAdminRewards(userId)
      setData(res)
      setDraft(res.config)
      setLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (key: string, value: string | number | boolean) => {
    setSaving(true)
    try {
      const res = await saveAdminRewardSetting(key, value)
      setDraft(res.config)
      toast.success('Reward setting saved')
    } catch (e: unknown) {
      const err = e as { message?: string }
      toast.error(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return failed ? <ConsoleRetry onRetry={() => void load()} /> : <p className="py-10 text-center text-sm text-white/50">Loading rewarded ads…</p>
  }

  const cfg = draft!
  const stats = data?.stats
  const sessions = data?.sessions ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* ── Reward configuration ─────────────────────────────────── */}
      <ConsoleCard
        title="Reward configuration"
        action={
          <button onClick={() => void load(userFilter || undefined)} className="flex items-center gap-1.5 text-xs font-bold text-white/50 hover:text-white">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Refresh
          </button>
        }
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-3">
            <ToggleRow
              label="Rewarded ads enabled"
              checked={cfg.enabled}
              onChange={(v) => { setDraft({ ...cfg, enabled: v }); void save('rewards.ads.enabled', v) }}
            />
            <ToggleRow
              label="Coins rewards enabled"
              checked={cfg.coinsEnabled}
              onChange={(v) => { setDraft({ ...cfg, coinsEnabled: v }); void save('rewards.ads.coinsEnabled', v) }}
            />
            <ToggleRow
              label="Realm Points rewards enabled"
              checked={cfg.pointsEnabled}
              onChange={(v) => { setDraft({ ...cfg, pointsEnabled: v }); void save('rewards.ads.pointsEnabled', v) }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Min reward (10–100)" value={cfg.minReward} min={10} max={100} onCommit={(v) => void save('rewards.ads.minReward', v)} />
            <NumField label="Max reward (10–100)" value={cfg.maxReward} min={10} max={100} onCommit={(v) => void save('rewards.ads.maxReward', v)} />
            <NumField label="Daily limit / user" value={cfg.dailyLimit} min={1} max={100} onCommit={(v) => void save('rewards.ads.dailyLimit', v)} />
            <NumField label="Cooldown (seconds)" value={cfg.cooldownSeconds} min={5} max={3600} onCommit={(v) => void save('rewards.ads.cooldownSeconds', v)} />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-white/35">
          Settings apply to NEW sessions only — completed sessions are never modified retroactively. The reward range stays within the approved 10–100 terms.
        </p>
      </ConsoleCard>

      {/* ── Provider health + stats ─────────────────────────────── */}
      <ConsoleCard title={`Ad performance (last ${stats?.windowDays ?? 30} days)`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Impressions" value={stats?.impressions ?? 0} />
          <Stat label="Completions" value={stats?.completions ?? 0} />
          <Stat label="Verification failures" value={`${Math.round((stats?.verificationFailureRate ?? 0) * 100)}%`} />
          <Stat label="Rewards issued" value={stats?.rewardsIssuedCount ?? 0} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {Object.entries(stats?.byStatus ?? {}).map(([status, count]) => (
            <span key={status} className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 font-bold text-white/60">
              {status}: {count}
            </span>
          ))}
        </div>
      </ConsoleCard>

      {/* ── Session search ──────────────────────────────────────── */}
      <ConsoleCard
        title="Reward sessions"
        action={
          <div className="flex items-center gap-2">
            <input
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder="Filter by user id"
              className={`${inputCls} !w-52 !py-1.5`}
            />
            <button
              onClick={() => void load(userFilter.trim() || undefined)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--qk-accent)]/40 px-3 py-1.5 text-xs font-bold text-[var(--qk-accent)]"
            >
              <Search className="w-3.5 h-3.5" aria-hidden /> Search
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-white/40 uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Session</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Reward</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sessions.map((s) => (
                <tr key={s.id} className="text-white/75">
                  <td className="py-2 pr-3 font-mono text-[10px]">{s.id.slice(0, 13)}…</td>
                  <td className="py-2 pr-3 font-mono text-[10px]">{s.userId.slice(0, 10)}…</td>
                  <td className="py-2 pr-3">{s.rewardType === 'COINS' ? '🪙 Coins' : '❤️ Points'}</td>
                  <td className="py-2 pr-3">{s.provider}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${
                      s.status === 'COMPLETED' ? 'bg-emerald-400/15 text-emerald-300' :
                      s.status === 'PENDING' ? 'bg-amber-400/15 text-amber-300' :
                      s.status === 'EXPIRED' || s.status === 'FAILED' ? 'bg-red-400/15 text-red-300' :
                      'bg-white/10 text-white/50'
                    }`}>{s.status}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{s.rewardAmount ?? '—'}</td>
                  <td className="py-2 text-white/40">{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-white/40">No sessions found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ConsoleCard>
    </div>
  )
}

// ─── small local components ──────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-white/40 font-bold">{label}</p>
      <p className="text-xl font-black tabular-nums mt-1">{value}</p>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-3.5 py-3">
      <span className="text-[13px] font-semibold">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-[var(--qk-accent)]' : 'bg-white/15'}`}
        aria-pressed={checked}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

function NumField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draftVal, setDraftVal] = useState(String(value))
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-white/50">{label}</span>
      <div className="flex gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          value={draftVal}
          onChange={(e) => setDraftVal(e.target.value)}
          className={inputCls}
        />
        <button
          onClick={() => {
            const n = Math.max(min, Math.min(max, Number(draftVal)))
            if (Number.isFinite(n)) onCommit(n)
          }}
          className="shrink-0 rounded-xl bg-[var(--qk-accent)] px-3 text-xs font-black flex items-center"
          aria-label="Save"
        >
          <Save className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </label>
  )
}

// ─── api client shims (admin group entries) ────────────────────────────────

async function jsonFetchAdminRewards(userId?: string): Promise<Payload> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  const res = await fetch(`/api/quicky/admin/rewarded-ads${qs}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load rewarded-ads data')
  return res.json()
}

async function saveAdminRewardSetting(key: string, value: string | number | boolean): Promise<{ config: RewardConfig }> {
  const res = await fetch('/api/quicky/admin/rewarded-ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ key, value }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? 'Save failed')
  return data
}
