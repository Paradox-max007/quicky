'use client'

// Quicky — Admin: REALMS configuration + cycles dashboard (realm PRD §26, §50, §52-§55)
// Realms console, three sections:
//   · Realm configuration — the 15 tiers: threshold / cycle duration /
//     active toggles (edits apply to FUTURE cycles — snapshots keep history)
//   · Rewards — per place (1st ≤ 5 items, 2nd ≤ 3, 3rd ≤ 1) picked from the
//     EXISTING gift catalog, granted into the existing inventory
//   · Active cycles — per-level cycle window + players + cohort count, with
//     a cohort drill-down (live standings) and a manual settlement trigger

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crown, RefreshCw, ChevronDown, ChevronLeft, Play, Sparkles } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type RealmDef = {
  id: string
  level: number
  name: string
  description: string | null
  promotionThreshold: number
  cycleDurationDays: number
  isActive: boolean
  rewards: string | null
  cratePoints: number
}

type ItemOption = { id: string; name: string; emoji: string; iconType: string; iconValue: string | null }

type CatalogRule = { id?: string; realmLevel?: number; position: number; rewardId: string; level: number; quantity: number }
type CatalogReward = { id: string; rewardType: string; name: string; rarity: string; metadata: { coinAmount?: number; itemId?: string; bundleId?: string; levels?: Record<string, unknown> } }

type CycleRow = {
  level: number
  name: string
  isActive: boolean
  promotionThreshold: number
  cycleDurationDays: number
  cycle: {
    id: string
    status: string
    startAt: string
    endAt: string
    thresholdSnapshot: number
    cohorts: number
    players: number
  } | null
}

type CohortDetail = {
  id: string
  realmLevel: number
  isFinalized: boolean
  threshold: number
  status: string
  endAt: string | null
  members: { rank: number; userId: string; name: string; avatar: string | null; cyclePoints: number; finalRank: number | null; promoted: boolean }[]
}

type RewardItem = { itemId: string; quantity: number }
type RewardsConfig = { first: RewardItem[]; second: RewardItem[]; third: RewardItem[] }

/** Consolation coin gifts for places 4-8 — { '4': 50, '5': 30, '6': 20, '7': 10, '8': 5 }. */
type ConsolationCoins = Record<'4' | '5' | '6' | '7' | '8', number>
const CONSOLATION_PLACES = ['4', '5', '6', '7', '8'] as const

function parseConsolation(json: string | null | undefined): ConsolationCoins {
  const out = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 } as ConsolationCoins
  try {
    const raw = JSON.parse(json ?? '{}') as { consolationCoins?: Record<string, unknown> }
    for (const p of CONSOLATION_PLACES) {
      const v = Number(raw?.consolationCoins?.[p])
      if (Number.isFinite(v) && v >= 0 && v <= 100_000) out[p] = Math.floor(v)
    }
  } catch {
    // defaults (all zero) are fine
  }
  return out
}

function parseRewards(json: string | null | undefined): RewardsConfig {
  try {
    const raw = JSON.parse(json ?? '{}') as Partial<RewardsConfig>
    return { first: raw.first ?? [], second: raw.second ?? [], third: raw.third ?? [] }
  } catch {
    return { first: [], second: [], third: [] }
  }
}

const PLACE_LIMITS: { key: 'first' | 'second' | 'third'; label: string; limit: number }[] = [
  { key: 'first', label: '1st place (max 5 items)', limit: 5 },
  { key: 'second', label: '2nd place (max 3 items)', limit: 3 },
  { key: 'third', label: '3rd place (max 1 item)', limit: 1 },
]

const COSMETIC_TYPES = ['HAT', 'PROFILE_FRAME', 'NAME_DECORATOR', 'CHAT_BUBBLE']

export function AdminRealmsScreen() {
  const [realms, setRealms] = useState<RealmDef[]>([])
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([])
  const [catalogRewards, setCatalogRewards] = useState<CatalogReward[]>([])
  const [catalogRules, setCatalogRules] = useState<CatalogRule[]>([])
  const [catalogDraft, setCatalogDraft] = useState<CatalogRule[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [totals, setTotals] = useState<{ activeCycles: number; cohorts: number; players: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [rewardFor, setRewardFor] = useState<number | null>(null)
  const [cohortId, setCohortId] = useState<string | null>(null)
  const [cohort, setCohort] = useState<CohortDetail | null>(null)

  // Editable fields for the open realm row.
  const [thresholdDraft, setThresholdDraft] = useState('')
  const [durationDraft, setDurationDraft] = useState('')
  const [cratePointsDraft, setCratePointsDraft] = useState('')
  const [activeDraft, setActiveDraft] = useState(true)
  const [rewardsDraft, setRewardsDraft] = useState<RewardsConfig>({ first: [], second: [], third: [] })
  const [consolationDraft, setConsolationDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [configRes, cyclesRes, rulesRes] = await Promise.all([
        api.admin.realmConfig.list(),
        api.admin.realmCycles.dashboard(),
        api.admin.realmRewards.list().catch(() => null),
      ])
      setRealms((configRes?.realms ?? []) as RealmDef[])
      setItemOptions((configRes?.itemOptions ?? []) as ItemOption[])
      setCycles((cyclesRes?.realms ?? []) as CycleRow[])
      setTotals(cyclesRes?.totals ?? null)
      setCatalogRewards((rulesRes?.rewards ?? []) as CatalogReward[])
      setCatalogRules((rulesRes?.rules ?? []) as CatalogRule[])
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const cycleByLevel = useMemo(() => new Map(cycles.map((c) => [c.level, c])), [cycles])

  const startEdit = (r: RealmDef) => {
    setEditing(editing === r.level ? null : r.level)
    setThresholdDraft(String(r.promotionThreshold))
    setDurationDraft(String(r.cycleDurationDays))
    setCratePointsDraft(String(r.cratePoints ?? r.level))
    setActiveDraft(r.isActive)
    setRewardsDraft(parseRewards(r.rewards))
    setConsolationDraft(Object.fromEntries(CONSOLATION_PLACES.map((p) => [p, String(parseConsolation(r.rewards)[p])])))
    setCatalogDraft(
      catalogRules
        .filter((rule) => rule.realmLevel === r.level)
        .map((rule) => ({ position: rule.position, rewardId: rule.rewardId, level: rule.level, quantity: rule.quantity }))
    )
  }

  const save = async (level: number) => {
    const t = Math.floor(Number(thresholdDraft))
    const d = Math.floor(Number(durationDraft))
    const cp = Math.floor(Number(cratePointsDraft))
    if (!Number.isInteger(t) || t < 0) return toast.error('Threshold must be a whole number ≥ 0.')
    if (!Number.isInteger(d) || d < 1 || d > 30) return toast.error('Cycle duration must be 1-30 days.')
    if (!Number.isInteger(cp) || cp < 0 || cp > 10_000) return toast.error('Crate points must be a whole number between 0 and 10,000.')
    for (const place of PLACE_LIMITS) {
      if (rewardsDraft[place.key].length > place.limit) {
        return toast.error(`${place.label.split(' (')[0]} allows at most ${place.limit} item${place.limit > 1 ? 's' : ''}.`)
      }
    }
    const consolation: Record<string, number> = {}
    for (const p of CONSOLATION_PLACES) {
      const v = Math.floor(Number(consolationDraft[p] ?? '0'))
      if (!Number.isInteger(v) || v < 0 || v > 100_000) {
        return toast.error('Consolation coins must be whole numbers between 0 and 100,000.')
      }
      consolation[p] = v
    }
    setSaving(true)
    try {
      await api.admin.realmConfig.update(level, { promotionThreshold: t, cycleDurationDays: d, isActive: activeDraft, cratePoints: cp, rewards: { ...rewardsDraft, consolationCoins: consolation } })
      if (rewardFor === level) {
        await api.admin.realmRewards.set(
          level,
          catalogDraft.map((rule) => ({ position: rule.position, rewardId: rule.rewardId, level: rule.level, quantity: rule.quantity }))
        )
      }
      toast.success(`${realms.find((r) => r.level === level)?.name ?? 'Realm'} saved — applies to future cycles`)
      setEditing(null)
      await load()
    } catch (e: any) {
      toast.error(e?.body?.message ?? 'Could not save the realm configuration.')
    } finally {
      setSaving(false)
    }
  }

  const openCohort = async (id: string) => {
    if (cohortId === id) {
      setCohortId(null)
      setCohort(null)
      return
    }
    setCohortId(id)
    setCohort(null)
    try {
      const res = await api.admin.realmCycles.cohort(id)
      setCohort(res?.cohort ?? null)
    } catch {
      toast.error('Could not load the cohort.')
    }
  }

  const settleNow = async () => {
    try {
      const res = await api.admin.realmCycles.settle()
      toast.success(res?.settled ? `Settled ${res.settled} cycle${res.settled > 1 ? 's' : ''}` : 'No cycles were due')
      await load()
    } catch {
      toast.error('Settlement failed.')
    }
  }

  if (!loaded) return <p className="text-sm text-white/50 py-6 text-center">Loading realms…</p>
  if (failed) return <ConsoleRetry onRetry={() => void load()} />

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* §54 — current-cycle dashboard header */}
      <ConsoleCard
        title="Current cycle"
        action={
          <button
            onClick={() => void settleNow()}
            className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold text-white/70 hover:border-[var(--qk-accent)]/50 hover:text-[var(--qk-accent)]"
            title="Run the idempotent settlement job now (due cycles only)"
          >
            <Play className="w-3 h-3" /> Settle due cycles
          </button>
        }
      >
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/5 border border-white/8 py-2.5">
            <p className="text-[9px] font-black uppercase tracking-wider text-white/35">Active cycles</p>
            <p className="text-xl font-black tabular-nums">{totals?.activeCycles ?? 0}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/8 py-2.5">
            <p className="text-[9px] font-black uppercase tracking-wider text-white/35">Cohorts</p>
            <p className="text-xl font-black tabular-nums">{totals?.cohorts ?? 0}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/8 py-2.5">
            <p className="text-[9px] font-black uppercase tracking-wider text-white/35">Players</p>
            <p className="text-xl font-black tabular-nums">{totals?.players ?? 0}</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-white/35">Cycles settle automatically when they end (rank ≤ 3 + threshold → promotion, points reset, next cycle). This button runs the idempotent job manually.</p>
      </ConsoleCard>

      {/* §52 — the 15 realms */}
      <ConsoleCard
        title="Realm configuration"
        action={
          <button onClick={() => void load()} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50" aria-label="Refresh realms">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        }
      >
        <div className="flex flex-col gap-1.5">
          {realms.map((r) => {
            const cyc = cycleByLevel.get(r.level)?.cycle ?? null
            const isOpen = editing === r.level
            return (
              <div key={r.id} className="rounded-xl border border-white/8 bg-white/[0.03]">
                <button onClick={() => (isOpen ? setEditing(null) : startEdit(r))} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                  <span className="w-7 text-center text-[11px] font-black tabular-nums text-white/40">{r.level}</span>
                  <Crown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--qk-gold)' }} aria-hidden />
                  <span className="flex-1 min-w-0 truncate text-sm font-bold">{r.name}</span>
                  {cyc && (
                    <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-white/45">
                      <span className="tabular-nums">{cyc.players}p</span>·<span className="tabular-nums">{cyc.cohorts}c</span>
                    </span>
                  )}
                  <span className="text-[11px] font-black tabular-nums text-white/60">{r.level >= 15 ? '—' : r.promotionThreshold.toLocaleString()}</span>
                  <span className={cn('text-[10px] font-black uppercase', r.isActive ? 'text-[#30D158]' : 'text-white/30')}>{r.isActive ? 'Active' : 'Off'}</span>
                  {isOpen ? <ChevronDown className="w-4 h-4 text-white/40" /> : <ChevronLeft className="w-4 h-4 text-white/25 rotate-[-90deg]" />}
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 flex flex-col gap-3 border-t border-white/8 pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Promotion threshold {r.level >= 15 && '(cap — no promotion)'}</span>
                        <input
                          value={thresholdDraft}
                          onChange={(e) => setThresholdDraft(e.target.value.replace(/[^0-9]/g, ''))}
                          inputMode="numeric"
                          disabled={r.level >= 15}
                          className="rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:border-[var(--qk-accent)]/50 disabled:opacity-40"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Cycle duration (days)</span>
                        <input
                          value={durationDraft}
                          onChange={(e) => setDurationDraft(e.target.value.replace(/[^0-9]/g, ''))}
                          inputMode="numeric"
                          className="rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:border-[var(--qk-accent)]/50"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Crate points on win 🎁</span>
                        <input
                          value={cratePointsDraft}
                          onChange={(e) => setCratePointsDraft(e.target.value.replace(/[^0-9]/g, ''))}
                          inputMode="numeric"
                          title="Crate points granted to players who WIN this realm (promotion at settlement) — advances their crate's levels 1-for-1"
                          className="rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:border-[var(--qk-accent)]/50"
                        />
                      </label>
                    </div>

                    <label className="flex items-center gap-2.5 text-xs font-semibold text-white/70">
                      <input type="checkbox" checked={activeDraft} onChange={(e) => setActiveDraft(e.target.checked)} className="accent-[var(--qk-accent)] w-4 h-4" />
                      Realm active (players at this level keep earning + competing)
                    </label>

                    {/* §53 — rewards editor */}
                    <div className="rounded-xl bg-[#0B0E14] border border-white/8 p-3 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Cycle rewards (top 3)</p>
                        <button onClick={() => setRewardFor(rewardFor === r.level ? null : r.level)} className="text-[10px] font-bold text-[var(--qk-accent)]">
                          {rewardFor === r.level ? 'Hide editor' : 'Edit rewards'}
                        </button>
                      </div>
                      {PLACE_LIMITS.map((place) => (
                        <div key={place.key}>
                          <p className="text-[10px] font-bold text-white/50 mb-1">{place.label}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(rewardFor === r.level ? rewardsDraft[place.key] : parseRewards(r.rewards)[place.key]).map((it, i) => {
                              const item = itemOptions.find((o) => o.id === it.itemId)
                              return (
                                <span key={`${it.itemId}-${i}`} className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10.5px] font-bold">
                                  <span aria-hidden>{item?.emoji ?? '🎁'}</span>
                                  {item?.name ?? 'Item'}
                                  <span style={{ color: 'var(--qk-gold)' }}>×{it.quantity}</span>
                                  {rewardFor === r.level && (
                                    <button
                                      onClick={() => setRewardsDraft({ ...rewardsDraft, [place.key]: rewardsDraft[place.key].filter((_, idx) => idx !== i) })}
                                      className="text-white/40 hover:text-rose-300"
                                      aria-label="Remove reward"
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              )
                            })}
                            {(rewardFor === r.level ? rewardsDraft[place.key].length === 0 : parseRewards(r.rewards)[place.key].length === 0) && (
                              <span className="text-[10px] text-white/30 font-semibold">No reward configured</span>
                            )}
                            {rewardFor === r.level && rewardsDraft[place.key].length < place.limit && (
                              <select
                                value=""
                                onChange={(e) => {
                                  const itemId = e.target.value
                                  if (!itemId) return
                                  setRewardsDraft({ ...rewardsDraft, [place.key]: [...rewardsDraft[place.key], { itemId, quantity: 1 }] })
                                }}
                                className="rounded-full bg-[#101623] border border-dashed border-white/20 px-2.5 py-1 text-[10.5px] font-bold text-white/60 outline-none"
                              >
                                <option value="">+ Add reward…</option>
                                {itemOptions.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.emoji} {o.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          {rewardFor === r.level && rewardsDraft[place.key].length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {rewardsDraft[place.key].map((it, i) => (
                                <input
                                  key={`${it.itemId}-qty-${i}`}
                                  value={it.quantity}
                                  onChange={(e) => {
                                    const qty = e.target.value.replace(/[^0-9]/g, '')
                                    const next = [...rewardsDraft[place.key]]
                                    next[i] = { ...it, quantity: Math.max(1, Math.floor(Number(qty) || 1)) }
                                    setRewardsDraft({ ...rewardsDraft, [place.key]: next })
                                  }}
                                  inputMode="numeric"
                                  className="w-16 rounded-lg bg-[#0B0E14] border border-white/10 px-2 py-1 text-[11px] font-bold tabular-nums outline-none focus:border-[var(--qk-accent)]/50"
                                  aria-label={`Quantity for ${itemOptions.find((o) => o.id === it.itemId)?.name ?? 'reward'}`}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-white/30">Legacy gift-item rewards are granted into the existing player inventory at settlement. Cycle-start snapshots keep history stable.</p>

                      {/* Consolation coins — places 4th-8th ("try hard next time") */}
                      <div className="mt-1 rounded-xl border border-[var(--qk-gold)]/20 bg-[var(--qk-gold)]/[0.04] p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-[var(--qk-gold)] mb-2">Consolation coins — places 4th to 8th</p>
                        {rewardFor === r.level ? (
                          <div className="grid grid-cols-5 gap-1.5">
                            {CONSOLATION_PLACES.map((p) => (
                              <label key={p} className="flex flex-col items-center gap-1">
                                <span className="text-[9px] font-black text-white/40">{p}th</span>
                                <input
                                  value={consolationDraft[p] ?? '0'}
                                  onChange={(e) => setConsolationDraft({ ...consolationDraft, [p]: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) })}
                                  inputMode="numeric"
                                  className="w-full rounded-lg bg-[#0B0E14] border border-white/10 px-1 py-1.5 text-[11px] font-bold tabular-nums text-center outline-none focus:border-[var(--qk-accent)]/50"
                                  aria-label={`${p}th place consolation coins`}
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {CONSOLATION_PLACES.map((p) => {
                              const v = parseConsolation(r.rewards)[p]
                              return (
                                <span key={p} className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10.5px] font-bold tabular-nums">
                                  {p}th <span style={{ color: 'var(--qk-gold)' }}>+{v.toLocaleString()} 🪙</span>
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
                          Credited to the players finishing 4th-8th at settlement (the “try hard next time” card). Snapshotted at cycle start — edits apply to future cycles.
                        </p>
                      </div>

                      {/* Admin-console PRD §10 — catalog rewards (claimable via the reward popup) */}
                      <div className="mt-2.5 rounded-xl border border-[var(--qk-accent)]/20 bg-[var(--qk-accent)]/[0.04] p-3 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--qk-accent)]">
                            <Sparkles className="w-3 h-3" aria-hidden /> Catalog rewards — reward popup collection
                          </p>
                          <span className="text-[9px] text-white/30">from the Rewards &amp; Cosmetics catalog</span>
                        </div>
                        {PLACE_LIMITS.map((place) => {
                          const idx = place.key === 'first' ? 1 : place.key === 'second' ? 2 : 3
                          const draft = catalogDraft.filter((c) => c.position === idx)
                          return (
                            <div key={`cat-${place.key}`}>
                              <p className="text-[10px] font-bold text-white/50 mb-1">{place.label}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {draft.map((rule, i) => {
                                  const reward = catalogRewards.find((r) => r.id === rule.rewardId)
                                  const isCosmetic = COSMETIC_TYPES.includes(reward?.rewardType ?? '')
                                  return (
                                    <span key={`${rule.rewardId}-${rule.level}-${i}`} className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10.5px] font-bold">
                                      {reward?.name ?? 'Reward'}
                                      {isCosmetic && <span className="text-[9px] text-[var(--qk-accent)]">L{rule.level}</span>}
                                      <span style={{ color: 'var(--qk-gold)' }}>×{rule.quantity}</span>
                                      {isCosmetic && (
                                        <select
                                          value={rule.level}
                                          onChange={(e) => {
                                            const next = [...catalogDraft]
                                            const at = catalogDraft.indexOf(rule)
                                            next[at] = { ...rule, level: Math.min(3, Math.max(1, Number(e.target.value) || 1)) }
                                            setCatalogDraft(next)
                                          }}
                                          className="rounded bg-black/40 border border-white/10 text-[9px] text-white/70 px-1 py-0 outline-none"
                                          aria-label="Reward level"
                                        >
                                          <option value={1}>L1</option>
                                          <option value={2}>L2</option>
                                          <option value={3}>L3</option>
                                        </select>
                                      )}
                                      <input
                                        value={rule.quantity}
                                        onChange={(e) => {
                                          const qty = Math.max(1, Math.floor(Number(e.target.value.replace(/[^0-9]/g, '')) || 1))
                                          const next = [...catalogDraft]
                                          const at = catalogDraft.indexOf(rule)
                                          next[at] = { ...rule, quantity: qty }
                                          setCatalogDraft(next)
                                        }}
                                        inputMode="numeric"
                                        className="w-12 rounded bg-black/40 border border-white/10 px-1 py-0.5 text-[10px] font-bold tabular-nums text-white outline-none"
                                        aria-label={`Quantity for ${reward?.name ?? 'reward'}`}
                                      />
                                      <button
                                        onClick={() => setCatalogDraft(catalogDraft.filter((c) => c !== rule))}
                                        className="text-white/40 hover:text-rose-300"
                                        aria-label="Remove catalog reward"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  )
                                })}
                                {draft.length === 0 && <span className="text-[10px] text-white/30 font-semibold">No catalog reward</span>}
                                {draft.length < place.limit && (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const rewardId = e.target.value
                                      if (!rewardId) return
                                      setCatalogDraft([...catalogDraft, { position: idx, rewardId, level: 1, quantity: 1 }])
                                    }}
                                    className="rounded-full bg-[#101623] border border-dashed border-white/20 px-2.5 py-1 text-[10.5px] font-bold text-white/60 outline-none"
                                  >
                                    <option value="">+ Add catalog reward…</option>
                                    {catalogRewards.map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {r.rewardType.replace('_', ' ')} · {r.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        <p className="text-[10px] text-white/30">Catalog rewards become PENDING grants at settlement — players collect them through the reward popup (online instantly, offline on next session).</p>
                      </div>
                    </div>

                    {cyc && (
                      <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-white/60">
                        <span>
                          Cycle: <span className="text-white/85">{new Date(cyc.startAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → {new Date(cyc.endAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        </span>
                        <span>Players: <span className="text-white/85 tabular-nums">{cyc.players}</span></span>
                        <span>Cohorts: <span className="text-white/85 tabular-nums">{cyc.cohorts}</span></span>
                        <span>Threshold snapshot: <span className="text-white/85 tabular-nums">{cyc.thresholdSnapshot.toLocaleString()}</span></span>
                        {cyc.cohorts > 0 && (
                          <button onClick={() => void openCohort('')} className="text-[10px] font-bold text-[var(--qk-accent)]" disabled>
                            Cohort drill-down via Live Tables
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void save(r.level)}
                        disabled={saving}
                        className="rounded-full px-4 py-2 text-xs font-black text-[var(--qk-on-accent)] disabled:opacity-50 active:scale-95 transition-transform"
                        style={{ background: 'var(--qk-accent)' }}
                      >
                        {saving ? 'Saving…' : 'Save realm'}
                      </button>
                      <button onClick={() => setEditing(null)} className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-white/60">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[10px] text-white/35">Threshold/duration changes apply to FUTURE cycles — the running cycle keeps its snapshot (history is never rewritten).</p>
      </ConsoleCard>

      {cohort && (
        <ConsoleCard title={`Cohort · ${cohort.realmLevel === 0 ? '' : `Realm level ${cohort.realmLevel}`} · ${cohort.status}`} action={<button onClick={() => setCohort(null)} className="text-[10px] font-bold text-white/50">Close</button>}>
          <div className="flex flex-col gap-1">
            {cohort.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/8 px-3 py-2">
                <span className="w-6 text-center text-[11px] font-black tabular-nums" style={m.rank <= 3 ? { color: 'var(--qk-gold)' } : { color: 'rgba(255,255,255,0.4)' }}>
                  {m.rank}
                </span>
                {m.avatar ? (
                  <img src={m.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[11px]" aria-hidden>👤</span>
                )}
                <span className="flex-1 min-w-0 truncate text-[12px] font-bold">{m.name}</span>
                {m.promoted && <span className="text-[9px] font-black uppercase text-[#30D158]">Promoted</span>}
                <span className="text-[12px] font-black tabular-nums">{m.cyclePoints.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </ConsoleCard>
      )}
    </div>
  )
}
