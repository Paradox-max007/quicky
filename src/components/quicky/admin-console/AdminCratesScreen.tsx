'use client'

// Quicky — ADMIN: CRATES (crate-tracks PRD — the battle-pass "crate room")
// Everything is admin-owned:
//   · Crate list — name/image/description, unlock price, level count,
//     active, sortOrder; create (auto-seeds levels) / edit / delete
//   · Levels editor — each level carries TWO prizes:
//       - FREE track  (collectible by realm wins alone — no purchase)
//       - CRATE track (pops after the crate pack is bought)
//     plus the cumulative THRESHOLD (crate points to reach the level) and
//     the per-level BUY price. Bulk-set defaults, then per-level overrides.
//   · Realm crate points — PER PLACEMENT (1st-8th) per realm: everyone
//     ranked at settlement earns their place's crate points.
// Players climb levels with crate points (realm placements) or coins
// (bought levels); each track's prize grants exactly once per level.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Save, Trash2, X, PackagePlus, Boxes, Coins, Crown, Gift, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type CrateRow = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  priceCoins: number
  levelCount: number
  isActive: boolean
  sortOrder: number
  levelsConfigured: number
  owners: number
}

type LevelRow = {
  level: number
  thresholdPoints: number
  prizeType: string
  prizeName: string | null
  prizeEmoji: string | null
  quantity: number
  priceCoins: number
  freePrizeType: string
  freePrizeName: string | null
  freePrizeEmoji: string | null
  freeQuantity: number
}

type ItemOption = { id: string; name: string; emoji: string; iconType: string; iconValue: string | null }
type RealmRow = { level: number; name: string; cratePoints: number; cratePointsByPlace: string | null }

const PLACES = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
const DEFAULT_PLACE_POINTS: Record<string, number> = { '1': 100, '2': 80, '3': 60, '4': 40, '5': 25, '6': 15, '7': 10, '8': 5 }

function placePoints(realm: RealmRow, place: string): number {
  if (realm.cratePointsByPlace) {
    try {
      const parsed = JSON.parse(realm.cratePointsByPlace) as Record<string, unknown>
      const v = Number(parsed[place])
      if (Number.isInteger(v) && v >= 0) return v
    } catch {
      /* fall through to the default */
    }
  }
  return DEFAULT_PLACE_POINTS[place] ?? realm.cratePoints
}

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'
const smallInputCls = 'w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white focus:outline-none focus:border-[var(--qk-accent)]/50'
const tinyInputCls = 'w-full rounded-lg border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-white tabular-nums focus:outline-none focus:border-[var(--qk-accent)]/50'

export function AdminCratesScreen() {
  const [crates, setCrates] = useState<CrateRow[]>([])
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([])
  const [realms, setRealms] = useState<RealmRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [levelsFor, setLevelsFor] = useState<CrateRow | null>(null)
  const [levels, setLevels] = useState<LevelRow[]>([])
  const [levelsLoading, setLevelsLoading] = useState(false)
  const [bulk, setBulk] = useState({
    prizeType: 'COINS', itemId: '', prizeName: '', prizeEmoji: '', quantity: '20', priceCoins: '100',
    freePrizeType: 'COINS', freeItemId: '', freePrizeName: '', freePrizeEmoji: '', freeQuantity: '10', thresholdStep: '20',
  })
  const [busy, setBusy] = useState(false)
  const [crateDraft, setCrateDraft] = useState<Record<string, string>>({})
  const [realmPlaceDraft, setRealmPlaceDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await api.admin.crates.list()
      setCrates((res?.crates ?? []) as CrateRow[])
      setItemOptions((res?.itemOptions ?? []) as ItemOption[])
      setRealms((res?.realms ?? []) as RealmRow[])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patchCrate = async (id: string, data: Record<string, unknown>, okMsg: string) => {
    setBusy(true)
    try {
      const res = await api.admin.crates.update({ id, ...data })
      if (res?.error) toast.error(res.message ?? 'Update failed')
      else {
        toast.success(okMsg)
        await load()
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const removeCrate = async (row: CrateRow) => {
    if (!confirm(`Delete "${row.name}"?${row.owners ? `\n\n${row.owners} player(s) own it — it will be deactivated instead.` : ''}`)) return
    try {
      const res = await api.admin.crates.remove(row.id)
      if (res?.error) toast.error(res.message ?? 'Crate deactivated (has owners)')
      else toast.success('Crate deleted')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const openLevels = async (row: CrateRow) => {
    setLevelsFor(row)
    setLevels([])
    setLevelsLoading(true)
    try {
      // The level track comes from the user-facing detail route (same data
      // the pass screen renders — admin sees exactly what players see).
      const res = await api.crates.detail(row.id)
      setLevels((res?.levels ?? []) as LevelRow[])
    } catch {
      toast.error('Could not load levels')
    } finally {
      setLevelsLoading(false)
    }
  }

  const applyBulk = async () => {
    if (!levelsFor) return
    const data: Record<string, unknown> = { action: 'levels_bulk' }
    if (bulk.prizeType === 'COINS') {
      data.prizeType = 'COINS'
      data.prizeName = bulk.prizeName || 'Coin Drop'
      data.prizeEmoji = bulk.prizeEmoji || '🪙'
    } else {
      if (!bulk.itemId) return toast.error('Pick a gift item for CRATE prizes')
      data.prizeType = 'GIFT'
      data.itemId = bulk.itemId
    }
    data.quantity = Number(bulk.quantity) || 1
    data.priceCoins = Number(bulk.priceCoins) || 0
    if (bulk.freePrizeType === 'COINS') {
      data.freePrizeType = 'COINS'
      data.freePrizeName = bulk.freePrizeName || 'Free Coins'
      data.freePrizeEmoji = bulk.freePrizeEmoji || '🪙'
    } else {
      if (!bulk.freeItemId) return toast.error('Pick a gift item for FREE prizes')
      data.freePrizeType = 'GIFT'
      data.freeItemId = bulk.freeItemId
    }
    data.freeQuantity = Number(bulk.freeQuantity) || 1
    const step = Number(bulk.thresholdStep)
    if (Number.isInteger(step) && step >= 1) data.thresholdStep = step
    setBusy(true)
    try {
      await api.admin.crates.update({ id: levelsFor.id, ...data })
      toast.success('Bulk-applied to every level')
      await openLevels(levelsFor)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk update failed')
    } finally {
      setBusy(false)
    }
  }

  const saveLevel = async (
    level: number,
    draft: {
      prizeType: string; itemId: string; prizeName: string; prizeEmoji: string; quantity: string; priceCoins: string
      freePrizeType: string; freeItemId: string; freePrizeName: string; freePrizeEmoji: string; freeQuantity: string; thresholdPoints: string
    },
  ) => {
    if (!levelsFor) return
    const data: Record<string, unknown> = { action: 'level_update', level }
    if (draft.prizeType === 'COINS') {
      data.prizeType = 'COINS'
      data.prizeName = draft.prizeName || 'Coin Drop'
      data.prizeEmoji = draft.prizeEmoji || '🪙'
    } else {
      data.prizeType = 'GIFT'
      data.itemId = draft.itemId
    }
    data.quantity = Number(draft.quantity) || 1
    data.priceCoins = Number(draft.priceCoins) || 0
    if (draft.freePrizeType === 'COINS') {
      data.freePrizeType = 'COINS'
      data.freePrizeName = draft.freePrizeName || 'Free Coins'
      data.freePrizeEmoji = draft.freePrizeEmoji || '🪙'
    } else {
      data.freePrizeType = 'GIFT'
      data.freeItemId = draft.freeItemId
    }
    data.freeQuantity = Number(draft.freeQuantity) || 1
    const t = Number(draft.thresholdPoints)
    if (Number.isInteger(t) && t >= 0) data.thresholdPoints = t
    try {
      await api.admin.crates.update({ id: levelsFor.id, ...data })
      toast.success(`Level ${level} saved`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : `Level ${level} save failed`)
    }
  }

  const saveRealmPlaces = async (realm: RealmRow, values: Record<string, string>) => {
    const table: Record<string, number> = {}
    for (const p of PLACES) {
      const n = Number(values[p] ?? String(placePoints(realm, p)))
      if (!Number.isInteger(n) || n < 0 || n > 100_000) return toast.error(`Place ${p} must be a whole number 0-100,000`)
      table[p] = n
    }
    try {
      await api.admin.realmConfig.update(realm.level, { cratePointsByPlace: table })
      toast.success(`${realm.name}: placement crate points saved`)
      setRealmPlaceDraft((d) => {
        const next = { ...d }
        for (const p of PLACES) delete next[`${realm.level}:${p}`]
        return next
      })
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (failed) return <ConsoleRetry onRetry={load} />
  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/40 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading crates…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ConsoleCard
        title="Crates (the battle pass)"
        action={
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-full border border-[var(--qk-accent)]/40 px-3 py-1.5 text-[11px] font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/10"
          >
            <PackagePlus className="w-3.5 h-3.5" aria-hidden /> New crate
          </button>
        }
      >
        <p className="text-xs text-white/55 leading-relaxed mb-3">
          A crate is the {`100-level`} battle pass (opened from the 👑 room chip). Each level has a <b>FREE prize</b> (won by realm placements
          alone) and a <b>CRATE prize</b> (needs the pack bought). Players climb levels with <b>crate points</b> (per-realm placement points vs
          each level&apos;s <b>threshold</b>) or <b>buy levels</b> (coins). Each prize grants exactly once.
        </p>
        <div className="flex flex-col gap-2">
          {crates.map((row) => (
            <div key={row.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
              <div className="flex items-center gap-3 flex-wrap">
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                ) : (
                  <span className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-lg" aria-hidden>🎁</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate flex items-center gap-2">
                    {row.name}
                    {!row.isActive && <span className="text-[9px] font-black uppercase text-amber-300 bg-amber-400/10 border border-amber-400/25 rounded-full px-1.5 py-0.5">Inactive</span>}
                  </p>
                  <p className="text-[11px] text-white/45 truncate">
                    {row.priceCoins.toLocaleString()} 🪙 pack · {row.levelsConfigured}/{row.levelCount} levels · {row.owners} owners
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => void openLevels(row)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/5 flex items-center gap-1">
                    <Boxes className="w-3.5 h-3.5" aria-hidden /> Levels
                  </button>
                  <button onClick={() => setCrateDraft({ [row.id]: String(row.priceCoins) })} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/5">Edit</button>
                  <button
                    onClick={() => void patchCrate(row.id, { isActive: !row.isActive }, row.isActive ? 'Crate deactivated' : 'Crate activated')}
                    disabled={busy}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold border ${row.isActive ? 'border-amber-400/30 text-amber-300 hover:bg-amber-400/10' : 'border-[#30D158]/30 text-[#30D158] hover:bg-[#30D158]/10'}`}
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => void removeCrate(row)} className="rounded-lg border border-red-400/25 text-red-300 px-2.5 py-1.5 text-[11px] font-bold hover:bg-red-400/10 flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              {crateDraft[row.id] !== undefined && (
                <div className="mt-2.5 border-t border-white/8 pt-2.5 flex flex-wrap items-center gap-2">
                  <input className={smallInputCls + ' max-w-[160px]'} placeholder="Name" defaultValue={row.name} onBlur={(e) => setCrateDraft((d) => ({ ...d, [`${row.id}:name`]: e.target.value }))} />
                  <input className={smallInputCls + ' max-w-[220px]'} placeholder="Image URL" defaultValue={row.imageUrl ?? ''} onBlur={(e) => setCrateDraft((d) => ({ ...d, [`${row.id}:imageUrl`]: e.target.value }))} />
                  <input className={smallInputCls + ' max-w-[120px]'} placeholder="Pack price 🪙" defaultValue={String(row.priceCoins)} onBlur={(e) => setCrateDraft((d) => ({ ...d, [row.id]: e.target.value }))} />
                  <button
                    onClick={() => {
                      const data: Record<string, unknown> = { priceCoins: Number(crateDraft[row.id]) || row.priceCoins }
                      const name = crateDraft[`${row.id}:name`]
                      const imageUrl = crateDraft[`${row.id}:imageUrl`]
                      if (name) data.name = name
                      if (imageUrl !== undefined) data.imageUrl = imageUrl
                      void patchCrate(row.id, data, 'Crate updated')
                    }}
                    disabled={busy}
                    className="rounded-lg bg-[var(--qk-accent)] px-3 py-1.5 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden /> Save
                  </button>
                  <button onClick={() => setCrateDraft((d) => { const n = { ...d }; delete n[row.id]; return n })} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold">Close</button>
                </div>
              )}
            </div>
          ))}
          {crates.length === 0 && <p className="text-xs text-white/40 py-4 text-center">No crates yet — create one (levels auto-seed).</p>}
        </div>
      </ConsoleCard>

      <ConsoleCard title="Realm crate points (per placement 1st-8th)">
        <p className="text-xs text-white/55 leading-relaxed mb-3">
          When a realm&apos;s cycle settles, <b>every player ranked 1st-8th</b> earns their place&apos;s crate points from that realm&apos;s table
          (defaults: 1st=100 … 8th=5). Crate points are the pass progress — they open prizes at each level&apos;s threshold. Edit any realm&apos;s
          places; the row save persists all 8.
        </p>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {realms.map((realm) => {
            const key = (place: string) => `${realm.level}:${place}`
            const dirty = PLACES.some((p) => realmPlaceDraft[key(p)] !== undefined && realmPlaceDraft[key(p)] !== String(placePoints(realm, p)))
            return (
              <div key={realm.level} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-[var(--qk-gold)] shrink-0" aria-hidden />
                  <span className="text-[12px] font-bold flex-1 min-w-0 truncate">
                    {realm.level}. {realm.name}
                  </span>
                  {dirty && (
                    <button
                      onClick={() => void saveRealmPlaces(realm, Object.fromEntries(PLACES.map((p) => [p, realmPlaceDraft[key(p)] ?? String(placePoints(realm, p))])))}
                      className="rounded-lg bg-[var(--qk-accent)] px-2 py-1 text-[10px] font-bold flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" aria-hidden /> Save places
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {PLACES.map((p) => (
                    <label key={p} className="block" title={`Place ${p} crate points`}>
                      <span className="block text-center text-[9px] font-black text-white/35 mb-0.5">{p === '1' ? '1st' : p === '2' ? '2nd' : p === '3' ? '3rd' : `${p}th`}</span>
                      <input
                        className={tinyInputCls + ' text-center'}
                        defaultValue={String(placePoints(realm, p))}
                        onChange={(e) => setRealmPlaceDraft((d) => ({ ...d, [key(p)]: e.target.value }))}
                        aria-label={`${realm.name} place ${p} crate points`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </ConsoleCard>

      {/* ── Create modal ─────────────────────────────────────────────────── */}
      {creating && (
        <CreateCrateModal
          itemOptions={itemOptions}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}

      {/* ── Levels editor modal ───────────────────────────────────────────── */}
      {levelsFor && (
        <LevelsEditor
          crate={levelsFor}
          levels={levels}
          loading={levelsLoading}
          itemOptions={itemOptions}
          bulk={bulk}
          setBulk={setBulk}
          onBulk={applyBulk}
          onSaveLevel={saveLevel}
          busy={busy}
          onClose={() => setLevelsFor(null)}
        />
      )}
    </div>
  )
}

function CreateCrateModal({ itemOptions, onClose, onSaved }: { itemOptions: ItemOption[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [priceCoins, setPriceCoins] = useState('500')
  const [levelCount, setLevelCount] = useState('100')
  const [prizeType, setPrizeType] = useState('COINS')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('20')
  const [levelPrice, setLevelPrice] = useState('100')
  const [freePrizeType, setFreePrizeType] = useState('COINS')
  const [freeItemId, setFreeItemId] = useState('')
  const [freeQuantity, setFreeQuantity] = useState('10')
  const [thresholdStep, setThresholdStep] = useState('20')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!name.trim()) return toast.error('Name is required')
    setBusy(true)
    try {
      await api.admin.crates.create({
        name: name.trim(),
        description: description.trim() || null,
        imageUrl: imageUrl.trim() || null,
        priceCoins: Number(priceCoins) || 0,
        levelCount: Number(levelCount) || 100,
        prizeType,
        itemId: prizeType === 'GIFT' ? itemId : undefined,
        prizeName: prizeType === 'COINS' ? 'Coin Drop' : undefined,
        prizeEmoji: prizeType === 'COINS' ? '🪙' : undefined,
        quantity: Number(quantity) || 1,
        levelPriceCoins: Number(levelPrice) || 0,
        freePrizeType,
        freeItemId: freePrizeType === 'GIFT' ? freeItemId : undefined,
        freePrizeName: freePrizeType === 'COINS' ? 'Free Coins' : undefined,
        freePrizeEmoji: freePrizeType === 'COINS' ? '🪙' : undefined,
        freeQuantity: Number(freeQuantity) || 1,
        thresholdStep: Number(thresholdStep) || 20,
      })
      toast.success('Crate created — levels seeded')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label="New crate">
      <div className="w-full max-w-md max-h-[86vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#101623] p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">New crate</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8"><X className="w-4 h-4" aria-hidden /></button>
        </div>
        <label className="text-[11px] font-bold text-white/50">Name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Realm Crate" /></label>
        <label className="text-[11px] font-bold text-white/50">Description (optional)<input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The battle pass…" /></label>
        <label className="text-[11px] font-bold text-white/50">Image URL (optional)<input className={inputCls} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-[11px] font-bold text-white/50">Pack price 🪙<input className={inputCls} value={priceCoins} onChange={(e) => setPriceCoins(e.target.value)} /></label>
          <label className="text-[11px] font-bold text-white/50">Levels (1-100)<input className={inputCls} value={levelCount} onChange={(e) => setLevelCount(e.target.value)} /></label>
          <label className="text-[11px] font-bold text-white/50">Threshold step<input className={inputCls} value={thresholdStep} onChange={(e) => setThresholdStep(e.target.value)} title="Level N's cumulative crate-point threshold = N × step" /></label>
        </div>
        <p className="text-[11px] font-black uppercase tracking-wide text-[#30D158]/80 mt-1 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" aria-hidden /> Free-track default prize (won by realm wins)</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[11px] font-bold text-white/50">
            Free prize type
            <select className={inputCls} value={freePrizeType} onChange={(e) => setFreePrizeType(e.target.value)}>
              <option value="COINS">Coins</option>
              <option value="GIFT">Gift item</option>
            </select>
          </label>
          {freePrizeType === 'GIFT' ? (
            <label className="text-[11px] font-bold text-white/50">
              Gift item
              <select className={inputCls} value={freeItemId} onChange={(e) => setFreeItemId(e.target.value)}>
                <option value="">— pick —</option>
                {itemOptions.map((it) => (
                  <option key={it.id} value={it.id}>{it.emoji} {it.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-[11px] font-bold text-white/50">Free coins per level<input className={inputCls} value={freeQuantity} onChange={(e) => setFreeQuantity(e.target.value)} /></label>
          )}
        </div>
        <p className="text-[11px] font-black uppercase tracking-wide text-[var(--qk-gold)]/80 mt-1 flex items-center gap-1.5"><Gift className="w-3.5 h-3.5" aria-hidden /> Crate-track default prize (needs the pack)</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[11px] font-bold text-white/50">
            Prize type
            <select className={inputCls} value={prizeType} onChange={(e) => setPrizeType(e.target.value)}>
              <option value="COINS">Coins</option>
              <option value="GIFT">Gift item</option>
            </select>
          </label>
          {prizeType === 'GIFT' ? (
            <label className="text-[11px] font-bold text-white/50">
              Gift item
              <select className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">— pick —</option>
                {itemOptions.map((it) => (
                  <option key={it.id} value={it.id}>{it.emoji} {it.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-[11px] font-bold text-white/50">Coins per level<input className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          )}
        </div>
        <label className="text-[11px] font-bold text-white/50">Per-level BUY price (coins)<input className={inputCls} value={levelPrice} onChange={(e) => setLevelPrice(e.target.value)} /></label>
        <div className="flex gap-2 justify-end mt-1">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold">Cancel</button>
          <button onClick={() => void create()} disabled={busy} className="rounded-xl bg-[var(--qk-accent)] px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
            <PackagePlus className="w-3.5 h-3.5" aria-hidden /> Create crate
          </button>
        </div>
      </div>
    </div>
  )
}

type LevelDraft = {
  prizeType: string; itemId: string; prizeName: string; prizeEmoji: string; quantity: string; priceCoins: string
  freePrizeType: string; freeItemId: string; freePrizeName: string; freePrizeEmoji: string; freeQuantity: string; thresholdPoints: string
}

type BulkDraft = Omit<LevelDraft, 'thresholdPoints'> & { thresholdStep: string }

function LevelsEditor({
  crate,
  levels,
  loading,
  itemOptions,
  bulk,
  setBulk,
  onBulk,
  onSaveLevel,
  busy,
  onClose,
}: {
  crate: CrateRow
  levels: LevelRow[]
  loading: boolean
  itemOptions: ItemOption[]
  bulk: BulkDraft
  setBulk: (b: BulkDraft) => void
  onBulk: () => void
  onSaveLevel: (level: number, draft: LevelDraft) => Promise<void>
  busy: boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label="Crate levels">
      <div className="w-full max-w-2xl max-h-[88vh] rounded-2xl border border-white/10 bg-[#101623] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-3 border-b border-white/8">
          <div>
            <h3 className="text-sm font-black">Levels — {crate.name}</h3>
            <p className="text-[11px] text-white/40">{levels.length} configured · threshold + free prize + crate prize + buy price</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8"><X className="w-4 h-4" aria-hidden /></button>
        </div>

        {/* Bulk set */}
        <div className="p-4 border-b border-white/8 flex flex-col gap-2">
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-[10px] font-bold text-white/50 w-28">
              Threshold step
              <input className={smallInputCls} value={bulk.thresholdStep} onChange={(e) => setBulk({ ...bulk, thresholdStep: e.target.value })} title="Level N threshold = N × step (applied to all)" />
            </label>
            <label className="text-[10px] font-bold text-white/50 w-24">
              Level price 🪙
              <input className={smallInputCls} value={bulk.priceCoins} onChange={(e) => setBulk({ ...bulk, priceCoins: e.target.value })} />
            </label>
            <button onClick={() => void onBulk()} disabled={busy} className="rounded-lg bg-[var(--qk-accent)] px-3 py-2 text-[11px] font-bold flex items-center gap-1">
              <Coins className="w-3.5 h-3.5" aria-hidden /> Apply all defaults
            </button>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-[10px] font-bold text-[#30D158]/70 w-20">
              FREE type
              <select className={smallInputCls} value={bulk.freePrizeType} onChange={(e) => setBulk({ ...bulk, freePrizeType: e.target.value })}>
                <option value="COINS">Coins</option>
                <option value="GIFT">Gift</option>
              </select>
            </label>
            {bulk.freePrizeType === 'GIFT' ? (
              <label className="text-[10px] font-bold text-white/50 flex-1 min-w-[140px]">
                Free item
                <select className={smallInputCls} value={bulk.freeItemId} onChange={(e) => setBulk({ ...bulk, freeItemId: e.target.value })}>
                  <option value="">— pick —</option>
                  {itemOptions.map((it) => (
                    <option key={it.id} value={it.id}>{it.emoji} {it.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-[10px] font-bold text-white/50 w-20">
                Free qty
                <input className={smallInputCls} value={bulk.freeQuantity} onChange={(e) => setBulk({ ...bulk, freeQuantity: e.target.value })} />
              </label>
            )}
            <label className="text-[10px] font-bold text-[var(--qk-gold)]/70 w-20">
              CRATE type
              <select className={smallInputCls} value={bulk.prizeType} onChange={(e) => setBulk({ ...bulk, prizeType: e.target.value })}>
                <option value="COINS">Coins</option>
                <option value="GIFT">Gift</option>
              </select>
            </label>
            {bulk.prizeType === 'GIFT' ? (
              <label className="text-[10px] font-bold text-white/50 flex-1 min-w-[140px]">
                Crate item
                <select className={smallInputCls} value={bulk.itemId} onChange={(e) => setBulk({ ...bulk, itemId: e.target.value })}>
                  <option value="">— pick —</option>
                  {itemOptions.map((it) => (
                    <option key={it.id} value={it.id}>{it.emoji} {it.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-[10px] font-bold text-white/50 w-20">
                Crate qty
                <input className={smallInputCls} value={bulk.quantity} onChange={(e) => setBulk({ ...bulk, quantity: e.target.value })} />
              </label>
            )}
          </div>
        </div>

        {/* Level rows */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-white/40 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading levels…
            </div>
          )}
          {levels.map((lv) => (
            <LevelEditorRow key={lv.level} level={lv} itemOptions={itemOptions} onSave={onSaveLevel} />
          ))}
          {!loading && levels.length === 0 && <p className="text-xs text-white/40 py-6 text-center">No level rows — create them via bulk-apply or level_update.</p>}
        </div>
      </div>
    </div>
  )
}

function LevelEditorRow({ level, itemOptions, onSave }: { level: LevelRow; itemOptions: ItemOption[]; onSave: (level: number, draft: LevelDraft) => Promise<void> }) {
  const matchedItem = itemOptions.find((o) => o.name === (level.prizeName ?? ''))
  const matchedFreeItem = itemOptions.find((o) => o.name === (level.freePrizeName ?? ''))
  const [prizeType, setPrizeType] = useState(level.prizeType === 'GIFT' ? 'GIFT' : 'COINS')
  const [itemId, setItemId] = useState(matchedItem?.id ?? '')
  const [prizeName, setPrizeName] = useState(level.prizeName ?? '')
  const [prizeEmoji, setPrizeEmoji] = useState(level.prizeEmoji ?? '')
  const [quantity, setQuantity] = useState(String(level.quantity))
  const [priceCoins, setPriceCoins] = useState(String(level.priceCoins))
  const [freePrizeType, setFreePrizeType] = useState(level.freePrizeType === 'GIFT' ? 'GIFT' : 'COINS')
  const [freeItemId, setFreeItemId] = useState(matchedFreeItem?.id ?? '')
  const [freePrizeName, setFreePrizeName] = useState(level.freePrizeName ?? '')
  const [freePrizeEmoji, setFreePrizeEmoji] = useState(level.freePrizeEmoji ?? '')
  const [freeQuantity, setFreeQuantity] = useState(String(level.freeQuantity ?? 1))
  const [thresholdPoints, setThresholdPoints] = useState(String(level.thresholdPoints ?? 0))
  const [dirty, setDirty] = useState(false)

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setDirty(true)
  }

  const save = () => {
    void onSave(level.level, {
      prizeType, itemId, prizeName, prizeEmoji, quantity, priceCoins,
      freePrizeType, freeItemId, freePrizeName, freePrizeEmoji, freeQuantity, thresholdPoints,
    }).then(() => setDirty(false))
  }

  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-2.5 py-2 flex flex-col gap-1.5">
      {/* Line 0: level + threshold + price + save */}
      <div className="flex items-center gap-2">
        <span className="w-9 text-center text-[11px] font-black tabular-nums text-white/50 shrink-0" aria-label={`Level ${level.level}`}>{level.level}</span>
        <label className="text-[10px] font-bold text-white/45 w-32 shrink-0">
          Threshold pts
          <input className={tinyInputCls} value={thresholdPoints} onChange={(e) => touch(setThresholdPoints)(e.target.value)} title="Cumulative crate points to reach this level" />
        </label>
        <label className="text-[10px] font-bold text-white/45 w-28 shrink-0">
          Buy price 🪙
          <input className={tinyInputCls} value={priceCoins} onChange={(e) => touch(setPriceCoins)(e.target.value)} />
        </label>
        <button
          onClick={save}
          disabled={!dirty}
          className={`ml-auto rounded-lg px-2.5 py-1.5 text-[10px] font-bold border shrink-0 ${dirty ? 'bg-[var(--qk-accent)] border-transparent' : 'border-white/10 text-white/30'}`}
        >
          Save
        </button>
      </div>
      {/* Line 1: FREE track prize */}
      <div className="flex items-center gap-2 pl-2 border-l-2 border-[#30D158]/40">
        <span className="text-[9px] font-black uppercase tracking-wide text-[#30D158] w-12 shrink-0" title="Free track — collectible by realm wins">Free</span>
        <select className={tinyInputCls + ' w-20 shrink-0'} value={freePrizeType} onChange={(e) => touch(setFreePrizeType)(e.target.value)}>
          <option value="COINS">Coins</option>
          <option value="GIFT">Gift</option>
        </select>
        {freePrizeType === 'GIFT' ? (
          <select
            className={tinyInputCls + ' flex-1 min-w-0'}
            value={freeItemId}
            onChange={(e) => {
              const it = itemOptions.find((o) => o.id === e.target.value)
              touch(setFreeItemId)(e.target.value)
              touch(setFreePrizeName)(it?.name ?? '')
              if (it?.emoji) touch(setFreePrizeEmoji)(it.emoji)
            }}
          >
            <option value="">— pick —</option>
            {itemOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.emoji} {o.name}</option>
            ))}
          </select>
        ) : (
          <>
            <input className={tinyInputCls + ' flex-1 min-w-0'} placeholder="Free prize name" value={freePrizeName} onChange={(e) => touch(setFreePrizeName)(e.target.value)} />
            <input className={tinyInputCls + ' w-12 shrink-0'} placeholder="🪙" value={freePrizeEmoji} onChange={(e) => touch(setFreePrizeEmoji)(e.target.value)} />
          </>
        )}
        <input className={tinyInputCls + ' w-16 shrink-0'} placeholder="qty" value={freeQuantity} onChange={(e) => touch(setFreeQuantity)(e.target.value)} aria-label="Free prize quantity" />
      </div>
      {/* Line 2: CRATE track prize */}
      <div className="flex items-center gap-2 pl-2 border-l-2 border-[var(--qk-gold)]/40">
        <span className="text-[9px] font-black uppercase tracking-wide text-[var(--qk-gold)] w-12 shrink-0" title="Crate track — needs the pack bought">Crate</span>
        <select className={tinyInputCls + ' w-20 shrink-0'} value={prizeType} onChange={(e) => touch(setPrizeType)(e.target.value)}>
          <option value="COINS">Coins</option>
          <option value="GIFT">Gift</option>
        </select>
        {prizeType === 'GIFT' ? (
          <select
            className={tinyInputCls + ' flex-1 min-w-0'}
            value={itemId}
            onChange={(e) => {
              const it = itemOptions.find((o) => o.id === e.target.value)
              touch(setItemId)(e.target.value)
              touch(setPrizeName)(it?.name ?? '')
              if (it?.emoji) touch(setPrizeEmoji)(it.emoji)
            }}
          >
            <option value="">— pick —</option>
            {itemOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.emoji} {o.name}</option>
            ))}
          </select>
        ) : (
          <>
            <input className={tinyInputCls + ' flex-1 min-w-0'} placeholder="Prize name" value={prizeName} onChange={(e) => touch(setPrizeName)(e.target.value)} />
            <input className={tinyInputCls + ' w-12 shrink-0'} placeholder="🪙" value={prizeEmoji} onChange={(e) => touch(setPrizeEmoji)(e.target.value)} />
          </>
        )}
        <input className={tinyInputCls + ' w-16 shrink-0'} placeholder="qty" value={quantity} onChange={(e) => touch(setQuantity)(e.target.value)} aria-label="Crate prize quantity" />
      </div>
    </div>
  )
}
