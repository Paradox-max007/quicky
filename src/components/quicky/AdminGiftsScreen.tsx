'use client'

// Quicky — Admin: Gift Catalog management (v3 PRD §62-§69)
// Two tabs — Categories & Gifts — with full CRUD against /api/quicky/admin/gifts:
//   • Categories: create / rename / icon / order / activate-deactivate (§63)
//   • Gifts: create / edit name, icon, category, price, status, order (§64-§65)
// Deactivation is SOFT (§102): history keeps rendering; the player catalog
// stops showing the row. Saving here changes the room gift catalog with NO
// frontend deployment (§104) — the catalog endpoint reads these tables live.

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Pencil, X, PackageOpen, UploadCloud, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'
import { GiftIcon } from '@/components/quicky/GiftIcon'
import { giftAvailabilityLabel } from '@/lib/quicky/gift-availability'

type AdminCategory = {
  id: string
  name: string
  slug: string
  icon: string
  sortOrder: number
  isActive: boolean
}
type AdminGift = {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  emoji: string
  iconType: string
  iconValue: string | null
  coinPrice: number
  tier: string
  availableFrom: string | null
  availableUntil: string | null
  isActive: boolean
  sortOrder: number
}

type GiftForm = {
  id?: string
  name: string
  description: string
  icon: string
  categoryId: string
  priceCoins: string
  tier: 'default' | 'premium' | 'seasonal'
  availableFrom: string // '' = none (YYYY-MM-DD)
  availableUntil: string // '' = none (YYYY-MM-DD)
  isActive: boolean
  sortOrder: string
}
type CategoryForm = {
  id?: string
  name: string
  icon: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_GIFT: GiftForm = {
  name: '',
  description: '',
  icon: '🎁',
  categoryId: '',
  priceCoins: '10',
  tier: 'default',
  availableFrom: '',
  availableUntil: '',
  isActive: true,
  sortOrder: '99',
}
const EMPTY_CATEGORY: CategoryForm = { name: '', icon: '🎁', sortOrder: '99', isActive: true }

/** 'YYYY-MM-DD' → start-of-day ISO ('' → null). */
const dayStart = (v: string): string | null => (v ? new Date(`${v}T00:00:00`).toISOString() : null)
/** 'YYYY-MM-DD' → end-of-day ISO so the last day stays sendable ('' → null). */
const dayEnd = (v: string): string | null => (v ? new Date(`${v}T23:59:59.999`).toISOString() : null)
/** ISO/Date-string → 'YYYY-MM-DD' for the date inputs (null → ''). */
const isoToDay = (v: string | null | undefined): string => {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function AdminGiftsScreen({ onBack }: { onBack?: () => void } = {}) {
  const setView = useQuickyStore((s) => s.setView)
  const [tab, setTab] = useState<'gifts' | 'categories'>('gifts')
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [gifts, setGifts] = useState<AdminGift[]>([])
  const [loading, setLoading] = useState(true)
  const [giftForm, setGiftForm] = useState<GiftForm | null>(null)
  const [catForm, setCatForm] = useState<CategoryForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.admin.gifts.list()
      setCategories(res.categories ?? [])
      setGifts(res.gifts ?? [])
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveGift = async () => {
    if (!giftForm || saving) return
    if (!giftForm.name.trim()) return toast.error('Name is required')
    const price = Math.floor(Number(giftForm.priceCoins))
    if (!Number.isFinite(price) || price < 0) return toast.error('Price must be ≥ 0')
    if (giftForm.availableFrom && giftForm.availableUntil && giftForm.availableFrom > giftForm.availableUntil) {
      return toast.error('“Available until” must be on or after “available from”')
    }
    setSaving(true)
    const data = {
      name: giftForm.name.trim(),
      description: giftForm.description.trim(),
      icon: giftForm.icon.trim() || '🎁',
      categoryId: giftForm.categoryId || null,
      priceCoins: price,
      tier: giftForm.tier,
      availableFrom: dayStart(giftForm.availableFrom),
      availableUntil: dayEnd(giftForm.availableUntil),
      isActive: giftForm.isActive,
      sortOrder: Math.floor(Number(giftForm.sortOrder)) || 0,
    }
    try {
      if (giftForm.id) await api.admin.gifts.update('gift', giftForm.id, data)
      else await api.admin.gifts.create('gift', data)
      toast.success(giftForm.id ? 'Gift updated' : 'Gift created')
      setGiftForm(null)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveCategory = async () => {
    if (!catForm || saving) return
    if (!catForm.name.trim()) return toast.error('Name is required')
    setSaving(true)
    const data = {
      name: catForm.name.trim(),
      icon: catForm.icon.trim() || '🎁',
      sortOrder: Math.floor(Number(catForm.sortOrder)) || 0,
      isActive: catForm.isActive,
    }
    try {
      if (catForm.id) await api.admin.gifts.update('category', catForm.id, data)
      else await api.admin.gifts.create('category', data)
      toast.success(catForm.id ? 'Category updated' : 'Category created')
      setCatForm(null)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleGift = async (g: AdminGift) => {
    try {
      await api.admin.gifts.update('gift', g.id, { isActive: !g.isActive })
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Update failed')
    }
  }
  const toggleCategory = async (c: AdminCategory) => {
    try {
      await api.admin.gifts.update('category', c.id, { isActive: !c.isActive })
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Update failed')
    }
  }

  // admin-console PRD §18.1 — persistent move-up/move-down reorder.
  const move = async (kind: 'gift' | 'category', id: string, direction: 'up' | 'down') => {
    if (movingId) return
    setMovingId(id)
    try {
      await api.admin.gifts.move(kind, id, direction)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Reorder failed')
    } finally {
      setMovingId(null)
    }
  }

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—'

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white">
      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2">
        <button onClick={() => (onBack ? onBack() : setView('settings'))} className="p-2 rounded-full hover:bg-white/10" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Admin · Gifts</h1>
      </header>

      {/* Tabs */}
      <div className="shrink-0 px-4 pb-2 flex gap-2">
        {(['gifts', 'categories'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setGiftForm(null); setCatForm(null) }}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-bold capitalize border transition-colors',
              tab === t ? 'bg-[var(--qk-accent)] border-transparent text-white' : 'bg-white/5 border-white/10 text-white/60'
            )}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => (tab === 'gifts' ? setGiftForm(EMPTY_GIFT) : setCatForm(EMPTY_CATEGORY))}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold bg-white/10 border border-white/15 hover:bg-white/15"
        >
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8">
        {/* ─── GIFT FORM (§65 + admin-console PRD §6.1 — two fields per row,
             image upload or URL) ─── */}
        {tab === 'gifts' && giftForm && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 bg-[var(--qk-card)] border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm">{giftForm.id ? 'EDIT GIFT' : 'CREATE GIFT'}</h3>
              <button onClick={() => setGiftForm(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel"><X className="w-4 h-4" /></button>
            </div>

            {/* Two fields per row (admin-console PRD §6.1) */}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Gift name
                <input className="qk-input" value={giftForm.name} onChange={(e) => setGiftForm({ ...giftForm, name: e.target.value })} placeholder="Rose" maxLength={40} />
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Coin price
                <input className="qk-input" type="number" min={0} value={giftForm.priceCoins} onChange={(e) => setGiftForm({ ...giftForm, priceCoins: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Gift category
                <select className="qk-input" value={giftForm.categoryId} onChange={(e) => setGiftForm({ ...giftForm, categoryId: e.target.value })}>
                  <option value="">— none —</option>
                  {categories.filter((c) => c.isActive).map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Classification
                <select
                  className="qk-input"
                  value={giftForm.tier}
                  onChange={(e) => setGiftForm({ ...giftForm, tier: e.target.value as GiftForm['tier'] })}
                  title="Optional rarity / premium classification (admin-console PRD §6.1)"
                >
                  <option value="default">Default</option>
                  <option value="premium">Premium</option>
                  <option value="seasonal">Seasonal</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-white/60 flex items-center gap-2 pb-2.5 col-span-2">
                <input type="checkbox" checked={giftForm.isActive} onChange={(e) => setGiftForm({ ...giftForm, isActive: e.target.checked })} className="w-4 h-4 accent-[var(--qk-accent)]" />
                Status: {giftForm.isActive ? 'Active' : 'Hidden'}
              </label>
            </div>

            {/* Gift description (admin-console PRD §6.1 required field) */}
            <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
              Description
              <textarea
                className="qk-input min-h-[54px] resize-y"
                value={giftForm.description}
                onChange={(e) => setGiftForm({ ...giftForm, description: e.target.value })}
                placeholder="A single rose to break the ice."
                maxLength={200}
              />
            </label>

            {/* Gift image — upload from machine OR paste URL/emoji (PRD §6.1) */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Gift image</p>
                <span className="text-[9px] text-white/30">upload → Supabase Storage · or URL / emoji</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="h-12 w-12 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <GiftIcon
                    icon={giftForm.icon || '🎁'}
                    iconType={/^(https?:\/\/|data:image\/|\/)/i.test(giftForm.icon.trim()) ? 'image' : 'emoji'}
                    className="h-8 w-8 text-2xl"
                    imgClassName="h-8 w-8"
                  />
                </span>
                <label className="flex-1 min-w-0 text-xs font-semibold text-white/60 flex flex-col gap-1">
                  Image URL or emoji
                  <input className="qk-input" value={giftForm.icon} onChange={(e) => setGiftForm({ ...giftForm, icon: e.target.value })} placeholder="🌹 or https://…/rose.png" maxLength={600} />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex-1 min-w-0 cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors">
                  <UploadCloud className="w-3.5 h-3.5" aria-hidden />
                  <span className="gift-upload-label">{uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Upload image (PNG / WebP / GIF)'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 4 * 1024 * 1024) {
                        toast.error('Images must be 4 MB or smaller')
                        return
                      }
                      setUploading(true)
                      setUploadProgress(0)
                      void api.admin.assets
                        .upload(file, 'gifts', setUploadProgress)
                        .then((res) => {
                          setGiftForm((f) => (f ? { ...f, icon: res.url } : f))
                          toast.success('Gift image uploaded', { description: res.storage.mode === 'supabase' ? 'Stored in Supabase Storage' : 'Stored in local uploads' })
                        })
                        .catch((err: unknown) => {
                          toast.error(err instanceof Error ? err.message : 'Upload failed')
                        })
                        .finally(() => {
                          setUploading(false)
                          setUploadProgress(null)
                          e.target.value = ''
                        })
                    }}
                  />
                </label>
                {uploading && <RefreshCw className="w-4 h-4 animate-spin text-white/40 shrink-0" aria-hidden />}
              </div>
              {uploadProgress !== null && (
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-[var(--qk-accent)] transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
              <span className="text-[10px] text-white/35">Uploads are validated server-side and stored in Supabase Storage (bucket quicky-assets) — never as binaries on the app server.</span>
            </div>

            {/* Optional availability window (admin-console PRD §6.1) */}
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Available from
                <input
                  className="qk-input"
                  type="date"
                  value={giftForm.availableFrom}
                  onChange={(e) => setGiftForm({ ...giftForm, availableFrom: e.target.value })}
                  title="Optional — the gift becomes purchasable/sendable from this day (00:00)"
                />
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Available until
                <input
                  className="qk-input"
                  type="date"
                  value={giftForm.availableUntil}
                  onChange={(e) => setGiftForm({ ...giftForm, availableUntil: e.target.value })}
                  title="Optional — the last day the gift is sendable (through 23:59)"
                />
              </label>
            </div>
            <p className="-mt-1 text-[10px] text-white/35">Leave both empty for an always-available gift. Outside the window the gift is hidden from every catalog and sending is blocked.</p>

            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Display order
                <input className="qk-input" type="number" value={giftForm.sortOrder} onChange={(e) => setGiftForm({ ...giftForm, sortOrder: e.target.value })} />
              </label>
            </div>
            <button onClick={saveGift} disabled={saving || uploading} className="bg-coral-gradient rounded-xl py-3 font-black text-sm active:scale-[0.98] transition-transform disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Gift'}
            </button>
          </motion.div>
        )}

        {/* ─── CATEGORY FORM (§63) ─── */}
        {tab === 'categories' && catForm && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 bg-[var(--qk-card)] border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm">{catForm.id ? 'EDIT CATEGORY' : 'CREATE CATEGORY'}</h3>
              <button onClick={() => setCatForm(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Name
                <input className="qk-input" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="Romantic" maxLength={40} />
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Icon (emoji)
                <input className="qk-input" value={catForm.icon} onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} maxLength={8} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Order
                <input className="qk-input" type="number" value={catForm.sortOrder} onChange={(e) => setCatForm({ ...catForm, sortOrder: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-white/70 flex items-center gap-2 pb-2">
                <input type="checkbox" checked={catForm.isActive} onChange={(e) => setCatForm({ ...catForm, isActive: e.target.checked })} className="w-4 h-4 accent-[var(--qk-accent)]" />
                Active
              </label>
            </div>
            <button onClick={saveCategory} disabled={saving} className="bg-coral-gradient rounded-xl py-3 font-black text-sm active:scale-[0.98] transition-transform disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Category'}
            </button>
          </motion.div>
        )}

        {loading ? (
          <p className="text-sm text-white/40 text-center py-10">Loading catalog…</p>
        ) : tab === 'gifts' ? (
          <div className="flex flex-col gap-2">
            {gifts.length === 0 && (
              <div className="flex flex-col items-center text-white/40 py-12 gap-2">
                <PackageOpen className="w-8 h-8" />
                <p className="text-sm">No gifts yet — create the first one.</p>
              </div>
            )}
            {gifts.map((g, i) => {
              const availability = giftAvailabilityLabel(g)
              const outOfWindow =
                (g.availableFrom && new Date(g.availableFrom).getTime() > Date.now()) ||
                (g.availableUntil && new Date(g.availableUntil).getTime() < Date.now())
              return (
              <div key={g.id} className={cn('bg-[var(--qk-card)] border border-white/10 rounded-2xl px-3.5 py-3 flex items-center gap-3', (outOfWindow || !g.isActive) && 'opacity-60')}>
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => void move('gift', g.id, 'up')}
                    disabled={movingId === g.id || i === 0}
                    className="p-1 rounded-full hover:bg-white/10 disabled:opacity-25"
                    aria-label={`Move ${g.name} up`}
                    title="Move up (persists the new order)"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] font-black text-white/35">{i + 1}</span>
                  <button
                    onClick={() => void move('gift', g.id, 'down')}
                    disabled={movingId === g.id || i === gifts.length - 1}
                    className="p-1 rounded-full hover:bg-white/10 disabled:opacity-25"
                    aria-label={`Move ${g.name} down`}
                    title="Move down (persists the new order)"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className="w-9 h-9 flex items-center justify-center shrink-0" aria-hidden>
                  <GiftIcon
                    icon={g.iconType === 'image' || g.iconType === 'png' ? (g.iconValue ?? g.emoji) : g.emoji}
                    iconType={g.iconType}
                    className="h-7 w-7 text-2xl"
                    imgClassName="h-7 w-7"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-bold text-sm truncate">{g.name}</p>
                    {g.tier !== 'default' && (
                      <span
                        className={cn(
                          'text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full border shrink-0',
                          g.tier === 'premium'
                            ? 'bg-[var(--qk-gold)]/15 border-[var(--qk-gold)]/30 text-[var(--qk-gold)]'
                            : 'bg-sky-400/10 border-sky-400/25 text-sky-300'
                        )}
                      >
                        {g.tier}
                      </span>
                    )}
                    {outOfWindow && (
                      <span className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-white/15 bg-white/5 text-white/45 shrink-0" title="Outside its availability window">
                        SCHEDULED
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/45 truncate">
                    {catName(g.categoryId)} · 🪙 {g.coinPrice}
                    {availability && <span className="text-white/35"> · {availability}</span>}
                  </p>
                </div>
                <button
                  onClick={() => toggleGift(g)}
                  className={cn(
                    'text-[10px] font-black uppercase tracking-wide rounded-full px-2.5 py-1 border shrink-0',
                    g.isActive ? 'bg-emerald-400/15 border-emerald-300/30 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'
                  )}
                >
                  {g.isActive ? 'Active' : 'Off'}
                </button>
                <button
                  onClick={() => setGiftForm({
                    id: g.id,
                    name: g.name,
                    description: g.description ?? '',
                    icon: g.iconValue ?? g.emoji,
                    categoryId: g.categoryId ?? '',
                    priceCoins: String(g.coinPrice),
                    tier: (['premium', 'seasonal'].includes(g.tier) ? g.tier : 'default') as GiftForm['tier'],
                    availableFrom: isoToDay(g.availableFrom),
                    availableUntil: isoToDay(g.availableUntil),
                    isActive: g.isActive,
                    sortOrder: String(g.sortOrder),
                  })}
                  className="p-2 rounded-full hover:bg-white/10 shrink-0"
                  aria-label={`Edit ${g.name}`}
                >
                  <Pencil className="w-4 h-4 text-white/60" />
                </button>
              </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {categories.map((c, i) => (
              <div key={c.id} className="bg-[var(--qk-card)] border border-white/10 rounded-2xl px-3.5 py-3 flex items-center gap-3">
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => void move('category', c.id, 'up')}
                    disabled={movingId === c.id || i === 0}
                    className="p-1 rounded-full hover:bg-white/10 disabled:opacity-25"
                    aria-label={`Move ${c.name} up`}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] font-black text-white/35">{i + 1}</span>
                  <button
                    onClick={() => void move('category', c.id, 'down')}
                    disabled={movingId === c.id || i === categories.length - 1}
                    className="p-1 rounded-full hover:bg-white/10 disabled:opacity-25"
                    aria-label={`Move ${c.name} down`}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className="text-2xl w-9 text-center" aria-hidden>{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{c.name}</p>
                  <p className="text-[11px] text-white/45 truncate">/{c.slug}</p>
                </div>
                <button
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    'text-[10px] font-black uppercase tracking-wide rounded-full px-2.5 py-1 border',
                    c.isActive ? 'bg-emerald-400/15 border-emerald-300/30 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'
                  )}
                >
                  {c.isActive ? 'Active' : 'Off'}
                </button>
                <button
                  onClick={() => setCatForm({ id: c.id, name: c.name, icon: c.icon, sortOrder: String(c.sortOrder), isActive: c.isActive })}
                  className="p-2 rounded-full hover:bg-white/10"
                  aria-label={`Edit ${c.name}`}
                >
                  <Pencil className="w-4 h-4 text-white/60" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
