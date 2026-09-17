'use client'

// Quicky — ADMIN: sticker management (game-chat PRD §69-§72/§115-§119)
//
// Admin → Game Content → Stickers: Bundles + Stickers. Full CRUD against
// /api/quicky/admin/stickers(/bundles) — every request re-checks isAdmin on
// the SERVER (§127); this UI is convenience, never the security boundary.
// Bundle form fields per §117 (name, description, icon, league, season,
// coin price, minimum league points, active, display order); sticker form
// per §118 (name, bundle, asset, order, active) with §119 asset validation.

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Pencil, Trash2, X } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'

type Bundle = {
  id: string
  name: string
  description: string | null
  icon: string
  unlockType?: string
  eventId?: string | null
  event?: { name: string } | null
  leagueId: string | null
  seasonId: string | null
  league?: { name: string } | null
  season?: { name: string } | null
  priceCoins: number
  minimumLeaguePoints: number
  purchaseEnabled: boolean
  rewardEnabled: boolean
  isActive: boolean
  sortOrder: number
  stickers: { id: string; name: string; assetUrl: string; sortOrder: number; isActive: boolean }[]
  _count?: { stickers: number; owners: number }
}

type BundleForm = {
  id?: string
  name: string
  description: string
  icon: string
  unlockType: string
  leagueId: string
  seasonId: string
  eventId: string
  priceCoins: string
  minimumLeaguePoints: string
  purchaseEnabled: boolean
  rewardEnabled: boolean
  isActive: boolean
  sortOrder: string
}

// Games PRD §32 — acquisition mechanisms (admin-configurable)
const UNLOCK_TYPES: { value: string; label: string }[] = [
  { value: 'coins', label: '🪙 Coins purchase' },
  { value: 'league', label: '🏆 League reward' },
  { value: 'season', label: '📅 Season pass' },
  { value: 'event', label: '🎉 Event unlock' },
  { value: 'subscription', label: '👑 Subscription' },
  { value: 'free', label: '🎁 Free' },
]

const EMPTY_BUNDLE: BundleForm = {
  name: '',
  description: '',
  icon: '✨',
  unlockType: 'coins',
  leagueId: '',
  seasonId: '',
  eventId: '',
  priceCoins: '0',
  minimumLeaguePoints: '0',
  purchaseEnabled: true,
  rewardEnabled: false,
  isActive: true,
  sortOrder: '10',
}

type StickerForm = {
  id?: string
  bundleId: string
  name: string
  assetUrl: string
  sortOrder: string
  isActive: boolean
}

export function AdminStickersScreen({ onBack }: { onBack?: () => void } = {}) {
  const setView = useQuickyStore((s) => s.setView)
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [leagues, setLeagues] = useState<any[]>([])
  const [seasons, setSeasons] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [bundleForm, setBundleForm] = useState<BundleForm | null>(null)
  const [stickerForm, setStickerForm] = useState<StickerForm | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.admin.stickers.bundles()
      setBundles(res.bundles ?? [])
      setLeagues(res.leagues ?? [])
      setSeasons(res.seasons ?? [])
      setEvents((res as any).events ?? [])
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load sticker bundles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveBundle = async () => {
    if (!bundleForm || saving) return
    if (!bundleForm.name.trim()) return toast.error('Bundle name is required')
    // §117: at least one acquisition route — event/season/subscription/free
    // unlocks carry their own requirement instead.
    const price = Math.floor(Number(bundleForm.priceCoins)) || 0
    const points = Math.floor(Number(bundleForm.minimumLeaguePoints)) || 0
    const selfSufficient = ['event', 'season', 'subscription', 'free'].includes(bundleForm.unlockType)
    if (!bundleForm.purchaseEnabled && !bundleForm.rewardEnabled && !selfSufficient) {
      return toast.error('Enable coin purchase or league reward')
    }
    if (bundleForm.unlockType === 'event' && !bundleForm.eventId) {
      return toast.error('Pick the event for this event-unlock set')
    }
    setSaving(true)
    const data = {
      name: bundleForm.name.trim(),
      description: bundleForm.description.trim() || undefined,
      icon: bundleForm.icon.trim() || '✨',
      unlockType: bundleForm.unlockType,
      leagueId: bundleForm.leagueId || null,
      seasonId: bundleForm.seasonId || null,
      eventId: bundleForm.eventId || null,
      priceCoins: price,
      minimumLeaguePoints: points,
      purchaseEnabled: bundleForm.purchaseEnabled,
      rewardEnabled: bundleForm.rewardEnabled,
      isActive: bundleForm.isActive,
      sortOrder: Math.floor(Number(bundleForm.sortOrder)) || 0,
    }
    try {
      if (bundleForm.id) await api.admin.stickers.updateBundle(bundleForm.id, data)
      else await api.admin.stickers.createBundle(data)
      toast.success(bundleForm.id ? 'Bundle updated' : 'Bundle created')
      setBundleForm(null)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveSticker = async () => {
    if (!stickerForm || saving) return
    if (!stickerForm.name.trim()) return toast.error('Sticker name is required')
    if (!stickerForm.assetUrl.trim()) return toast.error('Sticker asset is required')
    setSaving(true)
    const data = {
      bundleId: stickerForm.bundleId,
      name: stickerForm.name.trim(),
      assetUrl: stickerForm.assetUrl.trim(),
      sortOrder: Math.floor(Number(stickerForm.sortOrder)) || 0,
      isActive: stickerForm.isActive,
    }
    try {
      if (stickerForm.id) await api.admin.stickers.updateSticker(stickerForm.id, data)
      else await api.admin.stickers.createSticker(data)
      toast.success(stickerForm.id ? 'Sticker updated' : 'Sticker added')
      setStickerForm(null)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10 relative z-10">
        <button onClick={() => (onBack ? onBack() : setView('settings'))} className="p-2 rounded-full hover:bg-white/10" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="font-black text-base leading-tight">Sticker Bundles</h1>
          <p className="text-white/40 text-[11px] leading-tight">Game Content · admin-managed</p>
        </div>
        <button
          onClick={() => setBundleForm({ ...EMPTY_BUNDLE })}
          className="ml-auto bg-coral-gradient rounded-xl px-3 py-2 text-xs font-black flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Bundle
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {loading && <p className="text-white/40 text-sm py-8 text-center">Loading…</p>}

        {!loading && bundles.length === 0 && (
          <p className="text-white/40 text-sm py-8 text-center">
            No bundles yet. Create one to open the sticker store.
          </p>
        )}

        {bundles.map((b) => (
          <div
            key={b.id}
            data-testid={`bundle-${b.id}`}
            className={cn(
              'bg-white/5 border border-white/10 rounded-2xl p-3.5',
              !b.isActive && 'opacity-55'
            )}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden>{b.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm">{b.name}</p>
                  {!b.isActive && <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-white/10 text-white/60">INACTIVE</span>}
                </div>
                <p className="text-[11px] text-white/50 mt-0.5">
                  <span className="font-bold text-white/70">{b.unlockType ?? 'coins'}</span>
                  {b.unlockType === 'event' && (b as any).event ? ` (${(b as any).event.name})` : ''}
                  {' · '}
                  {b.league ? `League: ${b.league.name} · ` : ''}
                  {b.season ? `Season: ${b.season.name ?? b.season} · ` : ''}
                  {b.purchaseEnabled ? `🪙 ${b.priceCoins}` : ''}
                  {b.purchaseEnabled && b.rewardEnabled ? ' · ' : ''}
                  {b.rewardEnabled ? `🏆 min ${b.minimumLeaguePoints} pts` : ''}
                </p>
                {b.description && <p className="text-[11px] text-white/40 mt-0.5 line-clamp-2">{b.description}</p>}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <div className="flex gap-1.5">
                  <button
                    onClick={() =>
                      setBundleForm({
                        id: b.id,
                        name: b.name,
                        description: b.description ?? '',
                        icon: b.icon,
                        unlockType: (b as any).unlockType ?? 'coins',
                        leagueId: b.leagueId ?? '',
                        seasonId: b.seasonId ?? '',
                        eventId: (b as any).eventId ?? '',
                        priceCoins: String(b.priceCoins),
                        minimumLeaguePoints: String(b.minimumLeaguePoints),
                        purchaseEnabled: b.purchaseEnabled,
                        rewardEnabled: b.rewardEnabled,
                        isActive: b.isActive,
                        sortOrder: String(b.sortOrder),
                      })
                    }
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/15"
                    aria-label={`Edit ${b.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {confirmDeleteId === b.id ? (
                    <button
                      onClick={async () => {
                        try {
                          await api.admin.stickers.removeBundle(b.id)
                          toast.success('Bundle deleted')
                          setConfirmDeleteId(null)
                          await load()
                        } catch (e: any) {
                          toast.error(e.message ?? 'Delete failed')
                        }
                      }}
                      className="px-2 py-2 rounded-lg bg-rose-500/90 text-[10px] font-black"
                    >
                      SURE?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(b.id)}
                      className="p-2 rounded-lg bg-white/10 hover:bg-rose-500/40"
                      aria-label={`Delete ${b.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setStickerForm({ bundleId: b.id, name: '', assetUrl: '', sortOrder: String((b.stickers?.length ?? 0) + 1), isActive: true })}
                  className="text-[10px] font-black px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15"
                >
                  + Sticker
                </button>
              </div>
            </div>

            {/* §72: bundle preview — the stickers under it */}
            {(b.stickers?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-white/10">
                {b.stickers.map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      setStickerForm({
                        id: s.id,
                        bundleId: b.id,
                        name: s.name,
                        assetUrl: s.assetUrl,
                        sortOrder: String(s.sortOrder),
                        isActive: s.isActive,
                      })
                    }
                    className={cn(
                      'w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/15 relative group',
                      !s.isActive && 'opacity-40'
                    )}
                    title={`${s.name} · order ${s.sortOrder}${s.isActive ? '' : ' · inactive'}`}
                  >
                    {s.assetUrl.startsWith('https://') ? (
                       
                      <img src={s.assetUrl} alt={s.name} className="w-7 h-7 object-contain" />
                    ) : (
                      <span className="text-xl" aria-hidden>{s.assetUrl}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ─── Bundle form (§116/§117) ─────────────────────────────────────────── */}
      <AnimatePresenceSheet>
        {bundleForm && (
          <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setBundleForm(null)} />
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="relative w-[min(94vw,26rem)] max-h-[86vh] overflow-y-auto bg-[var(--qk-card)] border border-white/15 rounded-3xl p-4 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-black text-sm">{bundleForm.id ? 'Edit Bundle' : 'Add Bundle'}</h3>
                <button onClick={() => setBundleForm(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Field label="Bundle Name *">
                <input value={bundleForm.name} onChange={(e) => setBundleForm({ ...bundleForm, name: e.target.value })} className={inputCls} placeholder="Summer Hearts" />
              </Field>
              <Field label="Description">
                <input value={bundleForm.description} onChange={(e) => setBundleForm({ ...bundleForm, description: e.target.value })} className={inputCls} placeholder="Five sizzling summer kisses…" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Icon">
                  <input value={bundleForm.icon} onChange={(e) => setBundleForm({ ...bundleForm, icon: e.target.value })} className={inputCls} placeholder="✨" />
                </Field>
                <Field label="Display Order">
                  <input value={bundleForm.sortOrder} onChange={(e) => setBundleForm({ ...bundleForm, sortOrder: e.target.value })} className={inputCls} inputMode="numeric" />
                </Field>
                {/* Games PRD §32/§63 — acquisition method (admin-configurable) */}
                <Field label="Unlock Method">
                  <select
                    value={bundleForm.unlockType}
                    onChange={(e) => setBundleForm({ ...bundleForm, unlockType: e.target.value })}
                    className={inputCls}
                    data-testid="bundle-unlock-type"
                  >
                    {UNLOCK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Event">
                  <select
                    value={bundleForm.eventId}
                    onChange={(e) => setBundleForm({ ...bundleForm, eventId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">— none —</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="League">
                  <select value={bundleForm.leagueId} onChange={(e) => setBundleForm({ ...bundleForm, leagueId: e.target.value })} className={inputCls}>
                    <option value="">— none —</option>
                    {leagues.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Season">
                  <select value={bundleForm.seasonId} onChange={(e) => setBundleForm({ ...bundleForm, seasonId: e.target.value })} className={inputCls}>
                    <option value="">— none —</option>
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Coin Price">
                  <input value={bundleForm.priceCoins} onChange={(e) => setBundleForm({ ...bundleForm, priceCoins: e.target.value, purchaseEnabled: true })} className={inputCls} inputMode="numeric" />
                </Field>
                <Field label="Min League Points">
                  <input value={bundleForm.minimumLeaguePoints} onChange={(e) => setBundleForm({ ...bundleForm, minimumLeaguePoints: e.target.value, rewardEnabled: true })} className={inputCls} inputMode="numeric" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <label className="flex items-center gap-1.5 font-semibold">
                  <input type="checkbox" checked={bundleForm.purchaseEnabled} onChange={(e) => setBundleForm({ ...bundleForm, purchaseEnabled: e.target.checked })} />
                  Coin purchase
                </label>
                <label className="flex items-center gap-1.5 font-semibold">
                  <input type="checkbox" checked={bundleForm.rewardEnabled} onChange={(e) => setBundleForm({ ...bundleForm, rewardEnabled: e.target.checked })} />
                  League reward
                </label>
                <label className="flex items-center gap-1.5 font-semibold">
                  <input type="checkbox" checked={bundleForm.isActive} onChange={(e) => setBundleForm({ ...bundleForm, isActive: e.target.checked })} />
                  Active
                </label>
              </div>
              <button
                onClick={() => void saveBundle()}
                disabled={saving}
                className="mt-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-black tracking-wide disabled:opacity-50"
              >
                {saving ? 'Saving…' : bundleForm.id ? 'Save Changes' : 'Create Bundle'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresenceSheet>

      {/* ─── Sticker form (§118) ─────────────────────────────────────────────── */}
      <AnimatePresenceSheet>
        {stickerForm && (
          <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setStickerForm(null)} />
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="relative w-[min(94vw,26rem)] max-h-[86vh] overflow-y-auto bg-[var(--qk-card)] border border-white/15 rounded-3xl p-4 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-black text-sm">{stickerForm.id ? 'Edit Sticker' : 'Add Sticker'}</h3>
                <button onClick={() => setStickerForm(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Field label="Sticker Name *">
                <input value={stickerForm.name} onChange={(e) => setStickerForm({ ...stickerForm, name: e.target.value })} className={inputCls} placeholder="Heart Eyes" />
              </Field>
              <Field label="Sticker Asset * (emoji or https://…/sticker.png)">
                <input value={stickerForm.assetUrl} onChange={(e) => setStickerForm({ ...stickerForm, assetUrl: e.target.value })} className={inputCls} placeholder="😍" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Display Order">
                  <input value={stickerForm.sortOrder} onChange={(e) => setStickerForm({ ...stickerForm, sortOrder: e.target.value })} className={inputCls} inputMode="numeric" />
                </Field>
                <Field label="Active">
                  <select value={stickerForm.isActive ? '1' : '0'} onChange={(e) => setStickerForm({ ...stickerForm, isActive: e.target.value === '1' })} className={inputCls}>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </Field>
              </div>
              <button
                onClick={() => void saveSticker()}
                disabled={saving}
                className="mt-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-black tracking-wide disabled:opacity-50"
              >
                {saving ? 'Saving…' : stickerForm.id ? 'Save Sticker' : 'Add Sticker'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresenceSheet>
    </div>
  )
}

const inputCls =
  'w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-white/50 mb-1 block">{label}</span>
      {children}
    </label>
  )
}

function AnimatePresenceSheet({ children }: { children: React.ReactNode }) {
  return <motion.div>{children}</motion.div>
}
