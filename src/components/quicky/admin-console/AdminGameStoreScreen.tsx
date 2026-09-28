'use client'

// Quicky — ADMIN GAME STORE CONSOLE (Game Economy PRD §63-§66, §59)
//
// Four tabs:
//   · Coin Packages — full CRUD (name / coins / bonus / price / badge /
//     featured / premium-only / order / active, PRD §8)
//   · Crates        — real-money crate products + their DISCLOSED contents
//     (realm points, coins, gift item, cosmetic, PRD §38/§43)
//   · Final Boost   — the final-hours realm boost: default config + per-realm
//     overrides (enabled / hours before end / multiplier, PRD §64/§65)
//   · Monetization  — revenue / coins / crates / gifts aggregates + the
//     funnel event counts + recent purchases (PRD §59-§62)

import { useCallback, useEffect, useState } from 'react'
import { Coins, Package, Flame, BarChart3, Plus, RefreshCw, Save, Trash2, Pencil, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'
import { cn } from '@/lib/utils'

const smallInputCls =
  'w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

type Pkg = {
  id: string
  name: string
  coins: number
  bonusCoins: number
  price: number
  currency: string
  badge: string | null
  featured: boolean
  premiumOnly: boolean
  sortOrder: number
  isActive: boolean
}

type Crate = {
  id: string
  name: string
  description: string | null
  crateType: string
  price: number
  currency: string
  emoji: string
  realmPoints: number
  coins: number
  giftItemId: string | null
  giftQuantity: number
  cosmeticRewardId: string | null
  bonusLabel: string | null
  featured: boolean
  sortOrder: number
  isActive: boolean
}

type Boost = { id: string; realmLevel: number | null; hoursBeforeEnd: number; multiplier: number; enabled: boolean }

type Stats = {
  revenueTotal: number
  avgPurchaseValue: number
  purchaseCount: number
  coinsPurchased: number
  coinsSpent: number
  cratesPurchased: number
  cratesOpened: number
  giftsSent: number
  funnel: { type: string; count: number }[]
  recentPurchases: { id: string; user: string; productType: string; amount: number; currency: string; provider: string; status: string; createdAt: string }[]
}

type Tab = 'packages' | 'crates' | 'boost' | 'stats'
const TABS: { key: Tab; label: string; icon: typeof Coins }[] = [
  { key: 'packages', label: 'Coin Packages', icon: Coins },
  { key: 'crates', label: 'Crates', icon: Package },
  { key: 'boost', label: 'Final Boost', icon: Flame },
  { key: 'stats', label: 'Monetization', icon: BarChart3 },
]

export function AdminGameStoreScreen() {
  const [tab, setTab] = useState<Tab>('packages')
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [packages, setPackages] = useState<Pkg[]>([])
  const [crates, setCrates] = useState<Crate[]>([])
  const [boosts, setBoosts] = useState<Boost[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [giftOptions, setGiftOptions] = useState<{ id: string; name: string; emoji: string }[]>([])
  const [cosmeticOptions, setCosmeticOptions] = useState<{ id: string; name: string; rewardType: string }[]>([])
  const [pkgDraft, setPkgDraft] = useState<Pkg | null>(null)
  const [crateDraft, setCrateDraft] = useState<Crate | null>(null)
  const [saving, setSaving] = useState(false)
  const [refunding, setRefunding] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await api.admin.gameStore.list()
      setPackages((res?.packages ?? []) as Pkg[])
      setCrates((res?.crates ?? []) as Crate[])
      setBoosts((res?.boosts ?? []) as Boost[])
      setStats((res?.stats ?? null) as Stats | null)
      setGiftOptions((res?.giftOptions ?? []) as { id: string; name: string; emoji: string }[])
      setCosmeticOptions((res?.cosmeticOptions ?? []) as { id: string; name: string; rewardType: string }[])
      setLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** PRD §67 — refund a completed purchase (REFUND ledger + balance reconciliation). */
  const refundPurchase = useCallback(
    async (p: Stats['recentPurchases'][number]) => {
      if (!window.confirm(`Refund ${p.user}'s ${p.productType} purchase ($${p.amount.toFixed(2)})?\n\nThis writes a REFUND ledger event and reclaims the credited coins (an unopened crate is revoked).`)) return
      setRefunding(p.id)
      try {
        const res = await api.admin.gameStore.refund(p.id)
        if (res?.ok) {
          toast.success(`Purchase refunded — ${res.coinsReclaimed.toLocaleString()} coins reclaimed${res.crateRevoked ? ' · crate entitlement revoked' : ''}.`)
          void load()
        } else {
          toast.error('Refund failed — is the purchase still COMPLETED?')
        }
      } catch {
        toast.error('Refund request failed.')
      } finally {
        setRefunding(null)
      }
    },
    [load]
  )

  const savePkg = async () => {
    if (!pkgDraft) return
    setSaving(true)
    try {
      const data = { ...pkgDraft }
      const res = pkgDraft.id
        ? await api.admin.gameStore.update('package', pkgDraft.id, data)
        : await api.admin.gameStore.create('package', data)
      if (res?.ok) {
        toast.success(pkgDraft.id ? 'Package updated' : 'Package created')
        setPkgDraft(null)
        await load()
      } else toast.error('Save failed')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveCrate = async () => {
    if (!crateDraft) return
    setSaving(true)
    try {
      const data = { ...crateDraft }
      const res = crateDraft.id
        ? await api.admin.gameStore.update('crate', crateDraft.id, data)
        : await api.admin.gameStore.create('crate', data)
      if (res?.ok) {
        toast.success(crateDraft.id ? 'Crate updated' : 'Crate created')
        setCrateDraft(null)
        await load()
      } else toast.error('Save failed')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveBoost = async (row: Boost) => {
    setSaving(true)
    try {
      const res = await api.admin.gameStore.update('boost', null, {
        realmLevel: row.realmLevel,
        hoursBeforeEnd: row.hoursBeforeEnd,
        multiplier: row.multiplier,
        enabled: row.enabled,
      })
      if (res?.ok) {
        toast.success(row.realmLevel == null ? 'Default boost saved' : `Realm ${row.realmLevel} boost saved`)
        await load()
      } else toast.error('Save failed')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (kind: 'package' | 'crate' | 'boost', id: string, realmLevel?: string) => {
    try {
      const res = await api.admin.gameStore.remove(kind, id, realmLevel)
      if (res?.disabled) toast.success('Crate has purchase history — disabled instead of deleted')
      else toast.success('Deleted')
      await load()
    } catch {
      toast.error('Delete failed')
    }
  }

  if (failed) return <ConsoleRetry onRetry={() => void load()} />
  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16 text-white/40 text-sm gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading Game Store console…
      </div>
    )
  }

  const defaultBoost = boosts.find((b) => b.realmLevel === null) ?? {
    id: '',
    realmLevel: null,
    hoursBeforeEnd: 4,
    multiplier: 2,
    enabled: true,
  }
  const overrides = boosts.filter((b) => b.realmLevel !== null)

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
              tab === key ? 'bg-[var(--qk-accent)] text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
            )}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {label}
          </button>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold bg-white/5 text-white/60 hover:bg-white/10"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Refresh
        </button>
      </div>

      {/* ── Coin Packages ── */}
      {tab === 'packages' && (
        <ConsoleCard
          title="Coin Packages"
          action={
            <button
              onClick={() =>
                setPkgDraft({
                  id: '',
                  name: 'New Pack',
                  coins: 500,
                  bonusCoins: 0,
                  price: 0.99,
                  currency: 'USD',
                  badge: null,
                  featured: false,
                  premiumOnly: false,
                  sortOrder: 99,
                  isActive: true,
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 px-3 py-1.5 text-xs font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/25"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> New package
            </button>
          }
        >
          {pkgDraft && (
            <div className="mb-4 rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/8 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="col-span-2 text-xs font-bold text-white/60">
                Name
                <input className={cn(smallInputCls, 'mt-1')} value={pkgDraft.name} onChange={(e) => setPkgDraft({ ...pkgDraft, name: e.target.value })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Coins
                <input type="number" className={cn(smallInputCls, 'mt-1')} value={pkgDraft.coins} onChange={(e) => setPkgDraft({ ...pkgDraft, coins: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Bonus coins
                <input type="number" className={cn(smallInputCls, 'mt-1')} value={pkgDraft.bonusCoins} onChange={(e) => setPkgDraft({ ...pkgDraft, bonusCoins: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Price
                <input type="number" step="0.01" className={cn(smallInputCls, 'mt-1')} value={pkgDraft.price} onChange={(e) => setPkgDraft({ ...pkgDraft, price: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Badge (optional)
                <input className={cn(smallInputCls, 'mt-1')} placeholder="BEST VALUE" value={pkgDraft.badge ?? ''} onChange={(e) => setPkgDraft({ ...pkgDraft, badge: e.target.value || null })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Sort order
                <input type="number" className={cn(smallInputCls, 'mt-1')} value={pkgDraft.sortOrder} onChange={(e) => setPkgDraft({ ...pkgDraft, sortOrder: Number(e.target.value) })} />
              </label>
              <div className="col-span-2 md:col-span-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-white/70 pt-2">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={pkgDraft.featured} onChange={(e) => setPkgDraft({ ...pkgDraft, featured: e.target.checked })} /> Featured
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={pkgDraft.premiumOnly} onChange={(e) => setPkgDraft({ ...pkgDraft, premiumOnly: e.target.checked })} /> Premium only
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={pkgDraft.isActive} onChange={(e) => setPkgDraft({ ...pkgDraft, isActive: e.target.checked })} /> Active
                </label>
              </div>
              <div className="col-span-2 md:col-span-1 flex gap-2 justify-end items-start pt-1">
                <button onClick={() => setPkgDraft(null)} className="rounded-xl px-3 py-2 text-xs font-bold bg-white/8 hover:bg-white/12">
                  Cancel
                </button>
                <button onClick={() => void savePkg()} disabled={saving} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold bg-[var(--qk-accent)] text-white disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" aria-hidden /> Save
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/35 border-b border-white/8">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Coins</th>
                  <th className="py-2 pr-3">Bonus</th>
                  <th className="py-2 pr-3">Price</th>
                  <th className="py-2 pr-3">Flags</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 pr-3 font-semibold">
                      {p.name} {!p.isActive && <span className="text-[10px] text-white/35">(inactive)</span>}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{p.coins.toLocaleString()}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-[var(--qk-accent)]">+{p.bonusCoins.toLocaleString()}</td>
                    <td className="py-2.5 pr-3 tabular-nums">${p.price.toFixed(2)}</td>
                    <td className="py-2.5 pr-3 text-[10px] font-bold">
                      {p.badge && <span className="mr-1 rounded-full bg-amber-400/15 text-amber-300 px-1.5 py-0.5">{p.badge}</span>}
                      {p.featured && <span className="mr-1 rounded-full bg-[var(--qk-accent)]/15 text-[var(--qk-accent)] px-1.5 py-0.5">FEATURED</span>}
                      {p.premiumOnly && <span className="rounded-full bg-[var(--qk-gold)]/15 text-[var(--qk-gold)] px-1.5 py-0.5">PREMIUM</span>}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-white/50">{p.sortOrder}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <button onClick={() => setPkgDraft({ ...p })} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50" aria-label="Edit package">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => void remove('package', p.id)} className="p-1.5 rounded-lg hover:bg-red-500/15 text-red-300/70" aria-label="Delete package">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ConsoleCard>
      )}

      {/* ── Crates ── */}
      {tab === 'crates' && (
        <ConsoleCard
          title="Real-Money Crates"
          action={
            <button
              onClick={() =>
                setCrateDraft({
                  id: '',
                  name: 'New Crate',
                  description: '',
                  crateType: 'PREMIUM',
                  price: 4.99,
                  currency: 'USD',
                  emoji: '💎',
                  realmPoints: 500,
                  coins: 500,
                  giftItemId: null,
                  giftQuantity: 1,
                  cosmeticRewardId: null,
                  bonusLabel: null,
                  featured: false,
                  sortOrder: 99,
                  isActive: true,
                })
              }
              className="flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 px-3 py-1.5 text-xs font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/25"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> New crate
            </button>
          }
        >
          <p className="text-xs text-white/40 mb-3">
            Crates are bought with REAL MONEY (never coins). Contents are deterministic and fully disclosed in the store (no undisclosed odds).
          </p>
          {crateDraft && (
            <div className="mb-4 rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/8 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="text-xs font-bold text-white/60">
                Name
                <input className={cn(smallInputCls, 'mt-1')} value={crateDraft.name} onChange={(e) => setCrateDraft({ ...crateDraft, name: e.target.value })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Type
                <select className={cn(smallInputCls, 'mt-1')} value={crateDraft.crateType} onChange={(e) => setCrateDraft({ ...crateDraft, crateType: e.target.value })}>
                  {['STARTER', 'PREMIUM', 'ELITE', 'REALM'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-white/60">
                Price
                <input type="number" step="0.01" className={cn(smallInputCls, 'mt-1')} value={crateDraft.price} onChange={(e) => setCrateDraft({ ...crateDraft, price: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                Emoji
                <input className={cn(smallInputCls, 'mt-1')} value={crateDraft.emoji} onChange={(e) => setCrateDraft({ ...crateDraft, emoji: e.target.value })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                ❤️ Realm points
                <input type="number" className={cn(smallInputCls, 'mt-1')} value={crateDraft.realmPoints} onChange={(e) => setCrateDraft({ ...crateDraft, realmPoints: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                🪙 Coins
                <input type="number" className={cn(smallInputCls, 'mt-1')} value={crateDraft.coins} onChange={(e) => setCrateDraft({ ...crateDraft, coins: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                🎁 Gift item
                <select className={cn(smallInputCls, 'mt-1')} value={crateDraft.giftItemId ?? ''} onChange={(e) => setCrateDraft({ ...crateDraft, giftItemId: e.target.value || null })}>
                  <option value="">— none —</option>
                  {giftOptions.map((g) => (
                    <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-white/60">
                Gift quantity
                <input type="number" className={cn(smallInputCls, 'mt-1')} value={crateDraft.giftQuantity} onChange={(e) => setCrateDraft({ ...crateDraft, giftQuantity: Number(e.target.value) })} />
              </label>
              <label className="text-xs font-bold text-white/60">
                ✨ Cosmetic
                <select className={cn(smallInputCls, 'mt-1')} value={crateDraft.cosmeticRewardId ?? ''} onChange={(e) => setCrateDraft({ ...crateDraft, cosmeticRewardId: e.target.value || null })}>
                  <option value="">— none —</option>
                  {cosmeticOptions.map((c) => (
                    <option key={c.id} value={c.id}>[{c.rewardType}] {c.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-white/60">
                Bonus label (optional)
                <input className={cn(smallInputCls, 'mt-1')} placeholder="Guaranteed ❤️ realm points" value={crateDraft.bonusLabel ?? ''} onChange={(e) => setCrateDraft({ ...crateDraft, bonusLabel: e.target.value || null })} />
              </label>
              <label className="col-span-2 text-xs font-bold text-white/60">
                Description (disclosed contents)
                <input className={cn(smallInputCls, 'mt-1')} value={crateDraft.description ?? ''} onChange={(e) => setCrateDraft({ ...crateDraft, description: e.target.value })} />
              </label>
              <div className="col-span-2 md:col-span-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-white/70 pt-2">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={crateDraft.featured} onChange={(e) => setCrateDraft({ ...crateDraft, featured: e.target.checked })} /> Featured
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={crateDraft.isActive} onChange={(e) => setCrateDraft({ ...crateDraft, isActive: e.target.checked })} /> Active
                </label>
                <label className="flex items-center gap-1.5">
                  Order <input type="number" className={cn(smallInputCls, 'w-20')} value={crateDraft.sortOrder} onChange={(e) => setCrateDraft({ ...crateDraft, sortOrder: Number(e.target.value) })} />
                </label>
              </div>
              <div className="col-span-2 md:col-span-1 flex gap-2 justify-end items-start pt-1">
                <button onClick={() => setCrateDraft(null)} className="rounded-xl px-3 py-2 text-xs font-bold bg-white/8 hover:bg-white/12">
                  Cancel
                </button>
                <button onClick={() => void saveCrate()} disabled={saving} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold bg-[var(--qk-accent)] text-white disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" aria-hidden /> Save
                </button>
              </div>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            {crates.map((c) => (
              <div key={c.id} className={cn('rounded-2xl border p-4', c.isActive ? 'border-white/10 bg-white/4' : 'border-white/5 bg-white/2 opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>{c.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                      {c.name}
                      <span className="text-[9px] font-black uppercase tracking-wide rounded-full bg-white/8 text-white/60 px-1.5 py-0.5">{c.crateType}</span>
                      {c.featured && <span className="text-[9px] font-black uppercase tracking-wide rounded-full bg-[var(--qk-accent)]/15 text-[var(--qk-accent)] px-1.5 py-0.5">Featured</span>}
                    </p>
                    <p className="text-xs text-white/50 mt-0.5">{c.description ?? '—'}</p>
                    <p className="text-xs mt-2 flex flex-wrap gap-1.5">
                      {c.realmPoints > 0 && <span className="rounded-full bg-[var(--qk-accent)]/12 text-[var(--qk-accent)] px-2 py-0.5 font-bold tabular-nums">❤️ {c.realmPoints.toLocaleString()}</span>}
                      {c.coins > 0 && <span className="rounded-full bg-[var(--qk-gold)]/12 text-[var(--qk-gold)] px-2 py-0.5 font-bold tabular-nums">🪙 {c.coins.toLocaleString()}</span>}
                      {c.giftItemId && <span className="rounded-full bg-white/8 text-white/70 px-2 py-0.5 font-bold">🎁 ×{c.giftQuantity}</span>}
                      {c.cosmeticRewardId && <span className="rounded-full bg-[var(--qk-purple)]/15 text-[var(--qk-purple)] px-2 py-0.5 font-bold">✨ cosmetic</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-[var(--qk-gold)] tabular-nums">${c.price.toFixed(2)}</p>
                    <div className="flex gap-1 mt-2">
                      <button onClick={() => setCrateDraft({ ...c })} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50" aria-label="Edit crate">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => void remove('crate', c.id)} className="p-1.5 rounded-lg hover:bg-red-500/15 text-red-300/70" aria-label="Delete crate">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ConsoleCard>
      )}

      {/* ── Final Boost (PRD §64/§65) ── */}
      {tab === 'boost' && (
        <>
          <ConsoleCard title="Final-Hours Realm Boost — Default (all realms)">
            <p className="text-xs text-white/40 mb-3">
              Activates automatically at <b>cycle end − hours</b> on the server clock. Every gift then earns the configured ❤️ multiplier until the cycle closes. Never randomized; clearly displayed before spending.
            </p>
            <BoostRow row={defaultBoost} label="Default · every realm" onSave={() => void saveBoost(defaultBoost)} saving={saving} />
          </ConsoleCard>
          <ConsoleCard title="Per-Realm Overrides">
            <p className="text-xs text-white/40 mb-3">
              A realm row overrides the default for that realm only (e.g. Realm 5 → 4×). Overrides apply from the moment they are saved.
            </p>
            <div className="flex flex-col gap-2">
              {overrides.map((b) => (
                <BoostRow key={b.id} row={b} label={`Realm ${b.realmLevel}`} onSave={() => void saveBoost(b)} saving={saving} onDelete={() => void remove('boost', b.id, String(b.realmLevel))} />
              ))}
              {overrides.length === 0 && <p className="text-xs text-white/35 py-2">No overrides — every realm uses the default.</p>}
              <button
                onClick={() => void saveBoost({ id: '', realmLevel: 1, hoursBeforeEnd: 4, multiplier: 4, enabled: true })}
                disabled={saving}
                className="self-start flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 px-3 py-1.5 text-xs font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/25 mt-1"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden /> Add Realm 1 override (4×)
              </button>
            </div>
          </ConsoleCard>
        </>
      )}

      {/* ── Monetization dashboard (PRD §59) ── */}
      {tab === 'stats' && stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Gross revenue" value={`$${stats.revenueTotal.toFixed(2)}`} sub={`${stats.purchaseCount} purchases`} />
            <StatCard label="Avg purchase" value={`$${stats.avgPurchaseValue.toFixed(2)}`} />
            <StatCard label="Coins purchased" value={stats.coinsPurchased.toLocaleString()} sub="lifetime" />
            <StatCard label="Coins spent" value={stats.coinsSpent.toLocaleString()} sub="lifetime" />
            <StatCard label="Crates purchased" value={String(stats.cratesPurchased)} />
            <StatCard label="Crates opened" value={String(stats.cratesOpened)} />
            <StatCard label="Gifts sent" value={stats.giftsSent.toLocaleString()} sub="all-time room gifts" />
            <StatCard label="Provider" value="Sandbox" sub="mock payments" />
          </div>
          <ConsoleCard title="Conversion Funnel (30 days)">
            {stats.funnel.length === 0 ? (
              <p className="text-xs text-white/35">No funnel events recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {stats.funnel
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((f) => (
                    <div key={f.type} className="flex items-center gap-3 text-sm">
                      <span className="w-56 shrink-0 text-xs font-semibold text-white/60 truncate">{f.type}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/6 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, (f.count / Math.max(...stats.funnel.map((x) => x.count))) * 100)}%`, background: 'var(--qk-accent)' }}
                        />
                      </div>
                      <span className="tabular-nums text-xs font-bold w-10 text-right">{f.count}</span>
                    </div>
                  ))}
              </div>
            )}
          </ConsoleCard>
          <ConsoleCard title="Recent Completed Purchases">
            {stats.recentPurchases.length === 0 ? (
              <p className="text-xs text-white/35">No completed purchases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-white/35 border-b border-white/8">
                      <th className="py-2 pr-3">User</th>
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Provider</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentPurchases.map((p) => (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2.5 pr-3 font-semibold truncate max-w-[160px]">{p.user}</td>
                        <td className="py-2.5 pr-3 text-xs font-bold">{p.productType}</td>
                        <td className="py-2.5 pr-3 tabular-nums">${p.amount.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-xs text-white/50">{p.provider}</td>
                        <td className="py-2.5 pr-3 text-xs font-bold">{p.status === 'COMPLETED' ? <span className="text-[#30D158]">COMPLETED</span> : p.status === 'REFUNDED' ? <span className="text-[#FF6B6B]">REFUNDED</span> : <span className="text-white/60">{p.status}</span>}</td>
                        <td className="py-2.5 pr-3 text-xs text-white/40">{new Date(p.createdAt).toLocaleString()}</td>
                        <td className="py-2.5 pr-3">
                          {p.status === 'COMPLETED' && (
                            <button
                              onClick={() => void refundPurchase(p)}
                              disabled={refunding === p.id}
                              className="flex items-center gap-1 rounded-lg border border-[#FF6B6B]/30 bg-[#FF6B6B]/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#FF6B6B] hover:bg-[#FF6B6B]/20 disabled:opacity-40 transition-colors"
                              title="Refund this purchase — writes a REFUND ledger event and reconciles the balance (PRD §67)"
                              data-testid={`admin-refund-${p.id}`}
                            >
                              <RotateCcw className="w-3 h-3" aria-hidden />
                              {refunding === p.id ? 'Refunding…' : 'Refund'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ConsoleCard>
        </>
      )}
    </div>
  )
}

function BoostRow({
  row,
  label,
  onSave,
  onDelete,
  saving,
}: {
  row: Boost
  label: string
  onSave: () => void
  onDelete?: () => void
  saving: boolean
}) {
  // Official "adjust state when a prop changes" pattern (setState during
  // render, never inside an effect — avoids cascading-render lint error).
  const [draft, setDraft] = useState(row)
  const [prevRow, setPrevRow] = useState(row)
  if (row !== prevRow) {
    setPrevRow(row)
    setDraft(row)
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/4 px-4 py-3">
      <p className="text-sm font-bold w-40 shrink-0">{label}</p>
      <label className="text-xs font-bold text-white/60">
        Hours before end
        <input
          type="number"
          step="0.5"
          min="0.5"
          max="48"
          className={cn(smallInputCls, 'mt-1 w-28')}
          value={draft.hoursBeforeEnd}
          onChange={(e) => setDraft({ ...draft, hoursBeforeEnd: Number(e.target.value) })}
        />
      </label>
      <label className="text-xs font-bold text-white/60">
        Multiplier
        <select
          className={cn(smallInputCls, 'mt-1 w-24')}
          value={draft.multiplier}
          onChange={(e) => setDraft({ ...draft, multiplier: Number(e.target.value) })}
        >
          {[2, 3, 4, 5, 8, 10].map((m) => (
            <option key={m} value={m}>{m}×</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs font-bold text-white/70 pb-2.5">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
      </label>
      <div className="ml-auto flex gap-2 pb-1">
        {onDelete && (
          <button onClick={onDelete} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold bg-red-500/15 text-red-300 hover:bg-red-500/25">
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> Remove
          </button>
        )}
        <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold bg-[var(--qk-accent)] text-white disabled:opacity-50">
          <Save className="w-3.5 h-3.5" aria-hidden /> Save
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-white/35">{label}</p>
      <p className="text-xl font-black mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-white/35 mt-0.5">{sub}</p>}
    </div>
  )
}
