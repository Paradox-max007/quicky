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
import { ArrowLeft, Plus, Pencil, X, PackageOpen } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'
import { GiftIcon } from '@/components/quicky/GiftIcon'

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
  emoji: string
  iconType: string
  iconValue: string | null
  coinPrice: number
  isActive: boolean
  sortOrder: number
}

type GiftForm = {
  id?: string
  name: string
  icon: string
  categoryId: string
  priceCoins: string
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

const EMPTY_GIFT: GiftForm = { name: '', icon: '🎁', categoryId: '', priceCoins: '10', isActive: true, sortOrder: '99' }
const EMPTY_CATEGORY: CategoryForm = { name: '', icon: '🎁', sortOrder: '99', isActive: true }

export function AdminGiftsScreen({ onBack }: { onBack?: () => void } = {}) {
  const setView = useQuickyStore((s) => s.setView)
  const [tab, setTab] = useState<'gifts' | 'categories'>('gifts')
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [gifts, setGifts] = useState<AdminGift[]>([])
  const [loading, setLoading] = useState(true)
  const [giftForm, setGiftForm] = useState<GiftForm | null>(null)
  const [catForm, setCatForm] = useState<CategoryForm | null>(null)
  const [saving, setSaving] = useState(false)

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
    setSaving(true)
    const data = {
      name: giftForm.name.trim(),
      icon: giftForm.icon.trim() || '🎁',
      categoryId: giftForm.categoryId || null,
      priceCoins: price,
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
        {/* ─── GIFT FORM (§65) ─── */}
        {tab === 'gifts' && giftForm && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 bg-[var(--qk-card)] border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm">{giftForm.id ? 'EDIT GIFT' : 'CREATE GIFT'}</h3>
              <button onClick={() => setGiftForm(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel"><X className="w-4 h-4" /></button>
            </div>
            <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
              Name
              <input className="qk-input" value={giftForm.name} onChange={(e) => setGiftForm({ ...giftForm, name: e.target.value })} placeholder="Rose" maxLength={40} />
            </label>
            <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
              Category
              <select className="qk-input" value={giftForm.categoryId} onChange={(e) => setGiftForm({ ...giftForm, categoryId: e.target.value })}>
                <option value="">— none —</option>
                {categories.filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Icon (emoji or PNG URL)
                <input className="qk-input" value={giftForm.icon} onChange={(e) => setGiftForm({ ...giftForm, icon: e.target.value })} placeholder="🌹 or https://…/rose.png" maxLength={600} />
                <span className="text-[10px] text-white/35 font-normal">Paste an image URL (https://, data:image or /path.png) for a PNG gift icon — anything else is treated as an emoji.</span>
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                <span>Preview</span>
                <span className="h-[38px] rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <GiftIcon
                    icon={giftForm.icon || '🎁'}
                    iconType={/^(https?:\/\/|data:image\/|\/)/i.test(giftForm.icon.trim()) ? 'image' : 'emoji'}
                    className="h-7 w-7 text-2xl"
                    imgClassName="h-7 w-7"
                  />
                </span>
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Price (coins)
                <input className="qk-input" type="number" min={0} value={giftForm.priceCoins} onChange={(e) => setGiftForm({ ...giftForm, priceCoins: e.target.value })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Display order
                <input className="qk-input" type="number" value={giftForm.sortOrder} onChange={(e) => setGiftForm({ ...giftForm, sortOrder: e.target.value })} />
              </label>
              <label className="text-xs font-semibold text-white/70 flex items-center gap-2 pb-2">
                <input type="checkbox" checked={giftForm.isActive} onChange={(e) => setGiftForm({ ...giftForm, isActive: e.target.checked })} className="w-4 h-4 accent-[var(--qk-accent)]" />
                Active
              </label>
            </div>
            <button onClick={saveGift} disabled={saving} className="bg-coral-gradient rounded-xl py-3 font-black text-sm active:scale-[0.98] transition-transform disabled:opacity-50">
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
            {gifts.map((g) => (
              <div key={g.id} className="bg-[var(--qk-card)] border border-white/10 rounded-2xl px-3.5 py-3 flex items-center gap-3">
                <span className="w-9 h-9 flex items-center justify-center shrink-0" aria-hidden>
                  <GiftIcon
                    icon={g.iconType === 'image' || g.iconType === 'png' ? (g.iconValue ?? g.emoji) : g.emoji}
                    iconType={g.iconType}
                    className="h-7 w-7 text-2xl"
                    imgClassName="h-7 w-7"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{g.name}</p>
                  <p className="text-[11px] text-white/45 truncate">
                    {catName(g.categoryId)} · 🪙 {g.coinPrice} · order {g.sortOrder}
                  </p>
                </div>
                <button
                  onClick={() => toggleGift(g)}
                  className={cn(
                    'text-[10px] font-black uppercase tracking-wide rounded-full px-2.5 py-1 border',
                    g.isActive ? 'bg-emerald-400/15 border-emerald-300/30 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'
                  )}
                >
                  {g.isActive ? 'Active' : 'Off'}
                </button>
                <button
                  onClick={() => setGiftForm({
                    id: g.id, name: g.name, icon: g.iconValue ?? g.emoji, categoryId: g.categoryId ?? '',
                    priceCoins: String(g.coinPrice), isActive: g.isActive, sortOrder: String(g.sortOrder),
                  })}
                  className="p-2 rounded-full hover:bg-white/10"
                  aria-label={`Edit ${g.name}`}
                >
                  <Pencil className="w-4 h-4 text-white/60" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <div key={c.id} className="bg-[var(--qk-card)] border border-white/10 rounded-2xl px-3.5 py-3 flex items-center gap-3">
                <span className="text-2xl w-9 text-center" aria-hidden>{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{c.name}</p>
                  <p className="text-[11px] text-white/45 truncate">/{c.slug} · order {c.sortOrder}</p>
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
