'use client'

// Quicky — Admin: REALMS configuration + cycles dashboard (realm PRD §26, §50, §52-§55)
// Realms console, three sections:
//   · Realm configuration — the 15 tiers: threshold / cycle duration /
//     active toggles (edits apply to FUTURE cycles — snapshots keep history)
//   · Win rewards — ONE set per won place (1st ≤ 5, 2nd ≤ 3, 3rd ≤ 1):
//     coins / crate points (amount), sticker sets (bundle) + frames / hats
//     (with level) / name icons from their console catalog pages. ONE
//     system — the old cycle gift-item rewards and the catalog rewards
//     editors are unified into this one.
//   · Active cycles — per-level cycle window + players + cohort count, with
//     a cohort drill-down (live standings) and a manual settlement trigger

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crown, RefreshCw, ChevronDown, ChevronLeft, Play } from 'lucide-react'
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
  cratePointsByPlace: string | null
}

type CatalogRule = { id?: string; realmLevel?: number; position: number; rewardId: string; level: number; quantity: number }
type CatalogReward = { id: string; rewardType: string; name: string; rarity: string; metadata: { coinAmount?: number; cratePoints?: number; itemId?: string; bundleId?: string; levels?: Record<string, unknown> } }

/** ONE reward-set entry per won place (the unified editor's draft shape). */
type RewardEntry = {
  position: number
  kind: 'COINS' | 'CRATE_POINTS' | 'STICKER_SET' | 'REWARD'
  /** COINS / CRATE_POINTS amount (drafted as a string for the input). */
  amount?: string
  /** STICKER_SET → bundle id. */
  bundleId?: string
  /** REWARD → frames / hats / name icons catalog id. */
  rewardId?: string
  /** REWARD → cosmetic level (frames / hats). */
  level?: number
}

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

/** Consolation coin gifts for places 4-8 — { '4': 50, '5': 30, '6': 20, '7': 10, '8': 5 }. */
type ConsolationCoins = Record<'4' | '5' | '6' | '7' | '8', number>
const CONSOLATION_PLACES = ['4', '5', '6', '7', '8'] as const

/** Crate-track placement points (1st-8th) — every ranked player earns their place's points. */
const CRATE_PLACES = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
const CRATE_PLACE_DEFAULTS: Record<string, number> = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 25, '6': 15, '7': 10, '8': 5 }

function placePointsFor(r: RealmDef, place: string): number {
  if (r.cratePointsByPlace) {
    try {
      const parsed = JSON.parse(r.cratePointsByPlace) as Record<string, unknown>
      const v = Number(parsed[place])
      if (Number.isInteger(v) && v >= 0) return v
    } catch {
      /* fall through to the default */
    }
  }
  return CRATE_PLACE_DEFAULTS[place] ?? r.cratePoints
}

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

/** Legacy top-3 gift-item rewards still stored on a realm (migration hint). */
function legacyRewardCount(r: RealmDef): number {
  try {
    const raw = JSON.parse(r.rewards ?? '{}') as Partial<Record<'first' | 'second' | 'third', unknown[]>>
    return (raw.first?.length ?? 0) + (raw.second?.length ?? 0) + (raw.third?.length ?? 0)
  } catch {
    return 0
  }
}

const PLACE_LIMITS: { key: 'first' | 'second' | 'third'; label: string; limit: number }[] = [
  { key: 'first', label: '1st place (max 5 items)', limit: 5 },
  { key: 'second', label: '2nd place (max 3 items)', limit: 3 },
  { key: 'third', label: '3rd place (max 1 item)', limit: 1 },
]

/** Cosmetic kinds pickable in the realm reward set (with a level for frames/hats). */
const PICKABLE_REWARD_TYPES = ['PROFILE_FRAME', 'HAT', 'NAME_DECORATOR'] as const

function typeEmoji(rewardType: string): string {
  if (rewardType === 'PROFILE_FRAME') return '🖼️'
  if (rewardType === 'HAT') return '🎩'
  if (rewardType === 'NAME_DECORATOR') return '👑'
  if (rewardType === 'STICKER_SET') return '✨'
  if (rewardType === 'CRATE_POINTS') return '⭐'
  if (rewardType === 'COINS') return '🪙'
  return '🎁'
}

export function AdminRealmsScreen() {
  const [realms, setRealms] = useState<RealmDef[]>([])
  const [catalogRewards, setCatalogRewards] = useState<CatalogReward[]>([])
  const [catalogRules, setCatalogRules] = useState<CatalogRule[]>([])
  const [stickerBundles, setStickerBundles] = useState<{ id: string; name: string }[]>([])
  /** Draft of the unified reward set while the editor is open on a realm. */
  const [rewardDraft, setRewardDraft] = useState<RewardEntry[]>([])
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
  const [cratePlaceDraft, setCratePlaceDraft] = useState<Record<string, string>>({})
  const [activeDraft, setActiveDraft] = useState(true)
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
      setCycles((cyclesRes?.realms ?? []) as CycleRow[])
      setTotals(cyclesRes?.totals ?? null)
      setCatalogRewards((rulesRes?.rewards ?? []) as CatalogReward[])
      setCatalogRules((rulesRes?.rules ?? []) as CatalogRule[])
      setStickerBundles(((rulesRes?.stickerBundles ?? []) as { id: string; name: string }[]).map((b) => ({ id: b.id, name: b.name })))
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

  /** Read-only chips for a place's saved reward set (resolved from the live
   *  rules + catalog — coins / crate points / sticker sets / cosmetics). */
  const resolvedChips = (realmLevel: number, position: number): { icon: string; label: string }[] =>
    catalogRules
      .filter((rule) => rule.realmLevel === realmLevel && rule.position === position)
      .map((rule) => {
        const reward = catalogRewards.find((c) => c.id === rule.rewardId)
        if (!reward) return { icon: '❓', label: 'Removed reward' }
        if (reward.rewardType === 'COINS') return { icon: '🪙', label: `${(reward.metadata.coinAmount ?? 0).toLocaleString()} coins` }
        if (reward.rewardType === 'CRATE_POINTS') return { icon: '⭐', label: `${(reward.metadata.cratePoints ?? 0).toLocaleString()} crate pts` }
        if (reward.rewardType === 'STICKER_SET') return { icon: '✨', label: `${stickerBundles.find((b) => b.id === reward.metadata.bundleId)?.name ?? 'Sticker set'} (set)` }
        const leveled = reward.rewardType === 'HAT' || reward.rewardType === 'PROFILE_FRAME'
        return { icon: typeEmoji(reward.rewardType), label: `${reward.name}${leveled ? ` · L${rule.level}` : ''}` }
      })

  const startEdit = (r: RealmDef) => {
    setEditing(editing === r.level ? null : r.level)
    setThresholdDraft(String(r.promotionThreshold))
    setDurationDraft(String(r.cycleDurationDays))
    setCratePlaceDraft(Object.fromEntries(CRATE_PLACES.map((p) => [p, String(placePointsFor(r, p))])))
    setActiveDraft(r.isActive)
    setConsolationDraft(Object.fromEntries(CONSOLATION_PLACES.map((p) => [p, String(parseConsolation(r.rewards)[p])])))
    // Seed the unified reward-set draft from the live rules: coins / crate
    // points / sticker sets resolve to their managed kinds, cosmetic rules
    // keep their catalog reference (+ level for frames / hats). Unsupported
    // legacy rules (GIFT items etc.) are dropped — saving replaces the
    // realm's rules wholesale (ONE system).
    setRewardDraft(
      catalogRules
        .filter((rule) => rule.realmLevel === r.level)
        .flatMap((rule): RewardEntry[] => {
          const reward = catalogRewards.find((c) => c.id === rule.rewardId)
          if (reward?.rewardType === 'COINS') return [{ position: rule.position, kind: 'COINS' as const, amount: String(reward.metadata.coinAmount ?? 0) }]
          if (reward?.rewardType === 'CRATE_POINTS') return [{ position: rule.position, kind: 'CRATE_POINTS' as const, amount: String(reward.metadata.cratePoints ?? 0) }]
          if (reward?.rewardType === 'STICKER_SET') return [{ position: rule.position, kind: 'STICKER_SET' as const, bundleId: String(reward.metadata.bundleId ?? '') }]
          if (reward && (PICKABLE_REWARD_TYPES as readonly string[]).includes(reward.rewardType)) {
            return [{ position: rule.position, kind: 'REWARD' as const, rewardId: rule.rewardId, level: rule.level }]
          }
          return []
        })
    )
  }

  const save = async (level: number) => {
    const t = Math.floor(Number(thresholdDraft))
    const d = Math.floor(Number(durationDraft))
    if (!Number.isInteger(t) || t < 0) return toast.error('Threshold must be a whole number ≥ 0.')
    if (!Number.isInteger(d) || d < 1 || d > 30) return toast.error('Cycle duration must be 1-30 days.')
    const cratePlaces: Record<string, number> = {}
    for (const p of CRATE_PLACES) {
      const v = Math.floor(Number(cratePlaceDraft[p] ?? '0'))
      if (!Number.isInteger(v) || v < 0 || v > 100_000) {
        return toast.error('Placement crate points must be whole numbers between 0 and 100,000.')
      }
      cratePlaces[p] = v
    }
    for (const place of PLACE_LIMITS) {
      const position = place.key === 'first' ? 1 : place.key === 'second' ? 2 : 3
      const entries = rewardDraft.filter((e) => e.position === position)
      if (entries.length > place.limit) {
        return toast.error(`${place.label.split(' (')[0]} allows at most ${place.limit} reward${place.limit > 1 ? 's' : ''}.`)
      }
      for (const entry of entries) {
        if (entry.kind === 'COINS' || entry.kind === 'CRATE_POINTS') {
          const amount = Math.floor(Number(entry.amount))
          if (!Number.isInteger(amount) || amount < 1) return toast.error('Reward amounts must be whole numbers ≥ 1.')
        }
        if (entry.kind === 'STICKER_SET' && !entry.bundleId) return toast.error('Pick a sticker bundle for every sticker-set entry.')
        if (entry.kind === 'REWARD' && !entry.rewardId) return toast.error('Pick a frame, hat or name icon for every cosmetic entry.')
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
      // Only the consolation block lives on the realm definition now — the
      // win-reward set lives in RealmRewardRule (ONE system, ONE set).
      await api.admin.realmConfig.update(level, { promotionThreshold: t, cycleDurationDays: d, isActive: activeDraft, cratePointsByPlace: cratePlaces, rewards: { consolationCoins: consolation } })
      if (rewardFor === level) {
        await api.admin.realmRewards.set(
          level,
          rewardDraft.map((e) => ({
            position: e.position,
            kind: e.kind,
            amount: e.kind === 'COINS' || e.kind === 'CRATE_POINTS' ? Math.max(1, Math.floor(Number(e.amount) || 0)) : undefined,
            bundleId: e.kind === 'STICKER_SET' ? e.bundleId : undefined,
            rewardId: e.kind === 'REWARD' ? e.rewardId : undefined,
            level: e.kind === 'REWARD' ? e.level : undefined,
          }))
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
                      <div className="sm:col-span-2 rounded-xl bg-[#0B0E14] border border-white/8 p-3 flex flex-col gap-2">
                        <p className="text-[10px] font-black uppercase tracking-wider text-white/40" title="Crate points granted by PLACEMENT at settlement — every ranked player earns their place's points (advances the battle-pass levels)">
                          Crate points per place 🎁 (battle-pass progress)
                        </p>
                        <div className="grid grid-cols-8 gap-1.5">
                          {CRATE_PLACES.map((p) => (
                            <label key={p} className="flex flex-col gap-1">
                              <span className="text-center text-[9px] font-black text-white/35">{p === '1' ? '1st' : p === '2' ? '2nd' : p === '3' ? '3rd' : `${p}th`}</span>
                              <input
                                value={cratePlaceDraft[p] ?? ''}
                                onChange={(e) => setCratePlaceDraft((d) => ({ ...d, [p]: e.target.value.replace(/[^0-9]/g, '') }))}
                                inputMode="numeric"
                                className="rounded-lg bg-[#0B0E14] border border-white/10 px-1 py-1.5 text-[12px] font-semibold tabular-nums text-center outline-none focus:border-[var(--qk-accent)]/50"
                                aria-label={`Crate points for place ${p}`}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    <label className="flex items-center gap-2.5 text-xs font-semibold text-white/70">
                      <input type="checkbox" checked={activeDraft} onChange={(e) => setActiveDraft(e.target.checked)} className="accent-[var(--qk-accent)] w-4 h-4" />
                      Realm active (players at this level keep earning + competing)
                    </label>

                    {/* §53 — ONE reward set per won place (the unified editor) */}
                    <div className="rounded-xl bg-[#0B0E14] border border-white/8 p-3 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Win rewards — one set per place</p>
                        <button onClick={() => setRewardFor(rewardFor === r.level ? null : r.level)} className="text-[10px] font-bold text-[var(--qk-accent)]">
                          {rewardFor === r.level ? 'Hide editor' : 'Edit rewards'}
                        </button>
                      </div>
                      {legacyRewardCount(r) > 0 && (
                        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300/90">
                          ⚠ {legacyRewardCount(r)} legacy gift-item reward(s) are still stored on this realm — they no longer grant at settlement. Save the realm once to clear them and configure the set below instead.
                        </p>
                      )}
                      {PLACE_LIMITS.map((place) => {
                        const position = place.key === 'first' ? 1 : place.key === 'second' ? 2 : 3
                        const editingRewards = rewardFor === r.level
                        const entries = editingRewards ? rewardDraft.filter((e) => e.position === position) : []
                        const chips = editingRewards ? [] : resolvedChips(r.level, position)
                        const pickable = catalogRewards.filter((c) => (PICKABLE_REWARD_TYPES as readonly string[]).includes(c.rewardType))
                        return (
                          <div key={`set-${place.key}`}>
                            <p className="text-[10px] font-bold text-white/50 mb-1">{place.label}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {editingRewards
                                ? entries.map((entry, i) => {
                                    const reward = entry.kind === 'REWARD' ? catalogRewards.find((c) => c.id === entry.rewardId) : null
                                    const leveled = reward?.rewardType === 'PROFILE_FRAME' || reward?.rewardType === 'HAT'
                                    return (
                                      <span key={`${entry.kind}-${entry.rewardId ?? entry.bundleId ?? i}-${i}`} className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10.5px] font-bold">
                                        <span aria-hidden>{entry.kind === 'COINS' ? '🪙' : entry.kind === 'CRATE_POINTS' ? '⭐' : entry.kind === 'STICKER_SET' ? '✨' : typeEmoji(reward?.rewardType ?? '')}</span>
                                        {(entry.kind === 'COINS' || entry.kind === 'CRATE_POINTS') && (
                                          <>
                                            <input
                                              value={entry.amount ?? ''}
                                              onChange={(e) => {
                                                const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 7)
                                                const next = [...rewardDraft]
                                                const at = rewardDraft.indexOf(entry)
                                                next[at] = { ...entry, amount: v }
                                                setRewardDraft(next)
                                              }}
                                              inputMode="numeric"
                                              className="w-16 rounded bg-black/40 border border-white/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white outline-none focus:border-[var(--qk-accent)]/50"
                                              aria-label={entry.kind === 'COINS' ? 'Coin amount' : 'Crate points amount'}
                                            />
                                            <span className="text-white/40">{entry.kind === 'COINS' ? 'coins' : 'crate pts'}</span>
                                          </>
                                        )}
                                        {entry.kind === 'STICKER_SET' && (
                                          <select
                                            value={entry.bundleId ?? ''}
                                            onChange={(e) => {
                                              const next = [...rewardDraft]
                                              const at = rewardDraft.indexOf(entry)
                                              next[at] = { ...entry, bundleId: e.target.value }
                                              setRewardDraft(next)
                                            }}
                                            className="rounded bg-black/40 border border-white/10 text-[10px] text-white/70 px-1 py-0 outline-none max-w-[130px]"
                                            aria-label="Sticker bundle"
                                          >
                                            <option value="">— pick a bundle —</option>
                                            {stickerBundles.map((b) => (
                                              <option key={b.id} value={b.id}>{b.name}</option>
                                            ))}
                                          </select>
                                        )}
                                        {entry.kind === 'REWARD' && (
                                          <>
                                            {reward?.name ?? 'Reward'}
                                            {leveled && (
                                              <select
                                                value={entry.level ?? 1}
                                                onChange={(e) => {
                                                  const next = [...rewardDraft]
                                                  const at = rewardDraft.indexOf(entry)
                                                  next[at] = { ...entry, level: Math.min(3, Math.max(1, Number(e.target.value) || 1)) }
                                                  setRewardDraft(next)
                                                }}
                                                className="rounded bg-black/40 border border-white/10 text-[9px] text-white/70 px-1 py-0 outline-none"
                                                aria-label="Reward level"
                                              >
                                                <option value={1}>L1</option>
                                                <option value={2}>L2</option>
                                                <option value={3}>L3</option>
                                              </select>
                                            )}
                                          </>
                                        )}
                                        <button
                                          onClick={() => setRewardDraft(rewardDraft.filter((e) => e !== entry))}
                                          className="text-white/40 hover:text-rose-300"
                                          aria-label="Remove reward"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    )
                                  })
                                : chips.map((chip, i) => (
                                    <span key={`${chip.label}-${i}`} className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10.5px] font-bold">
                                      <span aria-hidden>{chip.icon}</span>
                                      {chip.label}
                                    </span>
                                  ))}
                              {editingRewards && entries.length === 0 && <span className="text-[10px] text-white/30 font-semibold">Nothing in this set yet</span>}
                              {!editingRewards && chips.length === 0 && <span className="text-[10px] text-white/30 font-semibold">No reward configured</span>}
                              {editingRewards && entries.length < place.limit && (
                                <select
                                  value=""
                                  onChange={(e) => {
                                    const v = e.target.value
                                    if (!v) return
                                    if (v === 'KIND:COINS') setRewardDraft([...rewardDraft, { position, kind: 'COINS', amount: '100' }])
                                    else if (v === 'KIND:CRATE_POINTS') setRewardDraft([...rewardDraft, { position, kind: 'CRATE_POINTS', amount: '20' }])
                                    else if (v === 'KIND:STICKER_SET') setRewardDraft([...rewardDraft, { position, kind: 'STICKER_SET', bundleId: stickerBundles[0]?.id ?? '' }])
                                    else if (v.startsWith('REWARD:')) setRewardDraft([...rewardDraft, { position, kind: 'REWARD', rewardId: v.slice(7), level: 1 }])
                                  }}
                                  className="rounded-full bg-[#101623] border border-dashed border-white/20 px-2.5 py-1 text-[10.5px] font-bold text-white/60 outline-none"
                                  aria-label={`Add reward to ${place.label}`}
                                >
                                  <option value="">+ Add reward…</option>
                                  {!entries.some((e) => e.kind === 'COINS') && <option value="KIND:COINS">🪙 Coins</option>}
                                  {!entries.some((e) => e.kind === 'CRATE_POINTS') && <option value="KIND:CRATE_POINTS">⭐ Crate points</option>}
                                  {!entries.some((e) => e.kind === 'STICKER_SET') && <option value="KIND:STICKER_SET">✨ Sticker set</option>}
                                  {pickable.map((rw) => (
                                    <option key={rw.id} value={`REWARD:${rw.id}`} disabled={entries.some((e) => e.kind === 'REWARD' && e.rewardId === rw.id)}>
                                      {typeEmoji(rw.rewardType)} {rw.rewardType === 'PROFILE_FRAME' ? 'Frame' : rw.rewardType === 'HAT' ? 'Hat' : 'Name icon'} · {rw.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      <p className="text-[10px] text-white/30">One realm win grants the whole set for the won place as PENDING rewards — players collect them through the reward popup (online instantly, offline next session). Cycle-start snapshots keep history stable.</p>

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
