'use client'

// Quicky — ADMIN: sticker management (game-chat PRD §69-§72/§115-§119)
//
// Admin → Game Content → Stickers: Bundles + Stickers. Full CRUD against
// /api/quicky/admin/stickers(/bundles) — every request re-checks isAdmin on
// the SERVER (§127); this UI is convenience, never the security boundary.
// Bundle form fields: name, description, icon (emoji or uploaded image),
// unlock method, season/realm/event linkage, coin price, active, display
// order — the LEAGUE field is gone (admin-console PRD §13.2, user request:
// sticker sets no longer gate on league progression). Sticker MEDIA can be
// uploaded right inside the bundle modal (staged → created on save).
// Sticker form per §118 (name, bundle, asset, order, active) with §119 asset
// validation + direct image upload — and a Sticker-Set dropdown so a single
// sticker can be mapped (or re-mapped) to any pack.
// BATCH PACK UPLOADER: select up to 20 sticker files, preview every one,
// resize them all client-side to the SAME square size (128/256/512, contain
// fit + transparent padding) and store the whole batch under ONE sticker
// set name — either a brand-new set or an existing one.

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Pencil, Trash2, X, UploadCloud, Images, PackagePlus } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import {
  STICKER_BATCH_MAX,
  STICKER_SIZE_OPTIONS,
  disposeStagedFiles,
  stagedToFile,
  stageStickerFile,
  type StagedStickerFile,
  type StickerTargetSize,
} from '@/lib/quicky/sticker-image'
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
  seasonId: string | null
  realmLevel?: number | null
  winnerPositions?: string | null
  season?: { name: string } | null
  priceCoins: number
  purchaseEnabled: boolean
  rewardEnabled: boolean
  isActive: boolean
  sortOrder: number
  stickers: { id: string; name: string; assetUrl: string; sortOrder: number; isActive: boolean }[]
  _count?: { stickers: number; owners: number }
}

/** Sticker image uploaded inside the bundle modal — staged locally, then
 *  created as GameSticker rows right after the bundle is saved. */
type StagedSticker = { name: string; assetUrl: string }

/** Bundle icons may be an emoji OR an uploaded image URL. */
function isImageIcon(icon: string): boolean {
  return /^https?:\/\//i.test(icon) || icon.startsWith('data:image/') || icon.startsWith('/')
}

type BundleForm = {
  id?: string
  name: string
  description: string
  icon: string
  unlockType: string
  seasonId: string
  eventId: string
  realmLevel: string
  winnerPositions: { 1: boolean; 2: boolean; 3: boolean }
  priceCoins: string
  purchaseEnabled: boolean
  rewardEnabled: boolean
  isActive: boolean
  sortOrder: string
  /** media staged in this modal — uploaded images that become the set's
   *  stickers the moment the bundle is created/updated. */
  newStickers: StagedSticker[]
}

// Games PRD §32 + admin-console PRD §13 — acquisition mechanisms
// ("realm" = finalized realm result + winner positions — the min-league-
// points rule was removed per §13.2)
const UNLOCK_TYPES: { value: string; label: string }[] = [
  { value: 'coins', label: '🪙 Coins purchase' },
  { value: 'realm', label: '👑 Realm winners (1st/2nd)' },
  { value: 'season', label: '📅 Season pass' },
  { value: 'event', label: '🎉 Event unlock' },
  { value: 'subscription', label: '⭕ Subscription' },
  { value: 'free', label: '🎁 Free' },
]

const REALM_LEVEL_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 1)

const EMPTY_BUNDLE: BundleForm = {
  name: '',
  description: '',
  icon: '✨',
  unlockType: 'coins',
  seasonId: '',
  eventId: '',
  realmLevel: '',
  winnerPositions: { 1: true, 2: true, 3: false },
  priceCoins: '0',
  purchaseEnabled: true,
  rewardEnabled: false,
  isActive: true,
  sortOrder: '10',
  newStickers: [],
}

function parseBundleWinnerPositions(json: string | null | undefined): { 1: boolean; 2: boolean; 3: boolean } {
  if (!json) return { 1: true, 2: true, 3: false }
  try {
    const arr = JSON.parse(json) as number[]
    return { 1: arr.includes(1), 2: arr.includes(2), 3: arr.includes(3) }
  } catch {
    return { 1: true, 2: true, 3: false }
  }
}

type StickerForm = {
  id?: string
  bundleId: string
  name: string
  assetUrl: string
  sortOrder: string
  isActive: boolean
}

/** Admin-side staged sticker — keeps the RAW file so the whole batch can
 *  be re-staged client-side when the uniform size changes. */
type AdminStagedSticker = StagedStickerFile & { file: File }

/** Batch pack uploader: select up to 20 sticker files, preview them, resize
 *  every image to the SAME square size and store the whole thing as one
 *  batch under a single sticker set name (new set, or an existing one). */
type BatchForm = {
  mode: 'new' | 'existing'
  targetBundleId: string
  name: string
  description: string
  icon: string
  unlockType: string
  priceCoins: string
  isActive: boolean
}

// Batch-modal unlock options — linkage-dependent unlocks (realm / season /
// event) are attached afterwards through the full bundle editor; the three
// below are self-sufficient per bundles-route validation.
const BATCH_UNLOCK_TYPES = UNLOCK_TYPES.filter((t) => ['coins', 'free', 'subscription'].includes(t.value))

const EMPTY_BATCH: BatchForm = {
  mode: 'new',
  targetBundleId: '',
  name: '',
  description: '',
  icon: '✨',
  unlockType: 'coins',
  priceCoins: '0',
  isActive: true,
}

export function AdminStickersScreen({ onBack }: { onBack?: () => void } = {}) {
  const setView = useQuickyStore((s) => s.setView)
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [seasons, setSeasons] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [bundleForm, setBundleForm] = useState<BundleForm | null>(null)
  const [stickerForm, setStickerForm] = useState<StickerForm | null>(null)
  // ── batch pack uploader state ──
  const [batchForm, setBatchForm] = useState<BatchForm | null>(null)
  const [batchStaged, setBatchStaged] = useState<AdminStagedSticker[]>([])
  const [batchTarget, setBatchTarget] = useState<StickerTargetSize>(256)
  const [staging, setStaging] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchProgress, setBatchProgress] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.admin.stickers.bundles()
      setBundles(res.bundles ?? [])
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
    // §117: at least one acquisition route — event/season/subscription/free/
    // realm unlocks carry their own requirement instead.
    const price = Math.floor(Number(bundleForm.priceCoins)) || 0
    const realmLevel = bundleForm.realmLevel ? Math.floor(Number(bundleForm.realmLevel)) : null
    const selfSufficient = ['event', 'season', 'subscription', 'free', 'realm'].includes(bundleForm.unlockType)
    if (!bundleForm.purchaseEnabled && !bundleForm.rewardEnabled && !selfSufficient) {
      return toast.error('Enable coin purchase or a reward unlock')
    }
    if (bundleForm.unlockType === 'event' && !bundleForm.eventId) {
      return toast.error('Pick the event for this event-unlock set')
    }
    if (bundleForm.unlockType === 'realm' && !realmLevel) {
      return toast.error('Pick the realm level this sticker set belongs to')
    }
    const positions = ([1, 2, 3] as const).filter((p) => bundleForm.winnerPositions[p])
    if (bundleForm.unlockType === 'realm' && positions.length === 0) {
      return toast.error('Select at least one winner position (1st / 2nd)')
    }
    setSaving(true)
    const data = {
      name: bundleForm.name.trim(),
      description: bundleForm.description.trim() || undefined,
      icon: bundleForm.icon.trim() || '✨',
      unlockType: bundleForm.unlockType,
      seasonId: bundleForm.seasonId || null,
      eventId: bundleForm.eventId || null,
      realmLevel,
      winnerPositions: bundleForm.unlockType === 'realm' ? positions : null,
      priceCoins: price,
      purchaseEnabled: bundleForm.purchaseEnabled,
      rewardEnabled: bundleForm.rewardEnabled,
      isActive: bundleForm.isActive,
      sortOrder: Math.floor(Number(bundleForm.sortOrder)) || 0,
    }
    try {
      let bundleId: string | null = null
      if (bundleForm.id) {
        await api.admin.stickers.updateBundle(bundleForm.id, data)
        bundleId = bundleForm.id
      } else {
        const res = await api.admin.stickers.createBundle(data)
        bundleId = (res as any)?.bundle?.id ?? null
      }
      // Media staged inside the modal — create the sticker rows right after
      // the bundle exists (each upload already lives in Supabase Storage).
      if (bundleId && bundleForm.newStickers.length > 0) {
        let ok = 0
        for (const s of bundleForm.newStickers) {
          try {
            await api.admin.stickers.createSticker({
              bundleId,
              name: s.name,
              assetUrl: s.assetUrl,
              sortOrder: 100 + ok,
              isActive: true,
            })
            ok++
          } catch {
            // keep going — one failed sticker must not sink the whole set
          }
        }
        if (ok > 0) toast.success(`${ok} sticker${ok > 1 ? 's' : ''} added to the set`)
      }
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
    if (!stickerForm.bundleId) return toast.error('Pick the sticker set (pack) this sticker belongs to')
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

  // ── Batch pack uploader ────────────────────────────────────────────────
  // Up to STICKER_BATCH_MAX files staged client-side (resized to ONE uniform
  // square size with transparent padding), then stored as a single batch
  // under one sticker set name — new set or existing set.

  const closeBatch = () => {
    disposeStagedFiles(batchStaged)
    setBatchStaged([])
    setBatchForm(null)
    setBatchProgress(null)
  }

  const pickBatchFiles = async (files: File[]) => {
    if (!batchForm || staging || batchSaving) return
    if (batchStaged.length >= STICKER_BATCH_MAX) {
      toast.error(`A batch holds at most ${STICKER_BATCH_MAX} stickers`)
      return
    }
    setStaging(true)
    const staged: AdminStagedSticker[] = []
    const skipped: string[] = []
    try {
      for (const file of files) {
        if (batchStaged.length + staged.length >= STICKER_BATCH_MAX) {
          skipped.push(`${file.name}: batch limit is ${STICKER_BATCH_MAX}`)
          continue
        }
        if (!file.type.startsWith('image/')) {
          skipped.push(`${file.name}: not an image`)
          continue
        }
        try {
          const s = await stageStickerFile(file, batchTarget)
          staged.push({ ...s, file })
        } catch (e) {
          skipped.push(`${file.name}: ${e instanceof Error ? e.message : 'could not stage'}`)
        }
      }
      if (staged.length > 0) setBatchStaged((prev) => [...prev, ...staged])
      if (skipped.length > 0) {
        toast.error(`${skipped.length} file${skipped.length > 1 ? 's' : ''} skipped`, {
          description: skipped.slice(0, 4).join(' · '),
        })
      }
    } finally {
      setStaging(false)
    }
  }

  /** Uniform size changed — re-stage EVERY raw file at the new size,
   *  preserving admin-edited names. */
  const restageAll = async (target: StickerTargetSize) => {
    if (target === batchTarget || staging || batchSaving) return
    setBatchTarget(target)
    if (batchStaged.length === 0) return
    setStaging(true)
    const current = batchStaged
    try {
      const next: AdminStagedSticker[] = []
      const failed: string[] = []
      for (const s of current) {
        try {
          const fresh = await stageStickerFile(s.file, target)
          next.push({ ...fresh, name: s.name, file: s.file })
        } catch {
          failed.push(s.name)
        }
      }
      disposeStagedFiles(current)
      setBatchStaged(next)
      if (failed.length > 0) {
        toast.error(`${failed.length} sticker${failed.length > 1 ? 's' : ''} could not be resized to ${target}px — removed from the batch`)
      }
    } finally {
      setStaging(false)
    }
  }

  const removeStaged = (uid: string) => {
    setBatchStaged((prev) => {
      const found = prev.find((s) => s.uid === uid)
      if (found) {
        try {
          URL.revokeObjectURL(found.previewUrl)
        } catch {
          /* ignore */
        }
      }
      return prev.filter((s) => s.uid !== uid)
    })
  }

  const saveBatch = async () => {
    if (!batchForm || batchSaving || staging) return
    if (batchStaged.length === 0) return toast.error('Pick at least one sticker image for the batch')
    let bundleId = ''
    let setName = ''
    const isNew = batchForm.mode === 'new'
    if (isNew) {
      if (!batchForm.name.trim()) return toast.error('Give the new sticker set a name')
      const price = Math.floor(Number(batchForm.priceCoins)) || 0
      if (batchForm.unlockType === 'coins' && price <= 0) {
        return toast.error('Coin packs need a price — set one, or choose the Free unlock')
      }
    } else {
      const target = bundles.find((b) => b.id === batchForm.targetBundleId)
      if (!target) return toast.error('Choose which sticker set this batch joins')
      bundleId = target.id
      setName = target.name
    }
    setBatchSaving(true)
    try {
      if (isNew) {
        const price = Math.floor(Number(batchForm.priceCoins)) || 0
        const res = await api.admin.stickers.createBundle({
          name: batchForm.name.trim(),
          description: batchForm.description.trim() || undefined,
          icon: batchForm.icon.trim() || '✨',
          unlockType: batchForm.unlockType,
          priceCoins: price,
          purchaseEnabled: batchForm.unlockType === 'coins' || batchForm.unlockType === 'free',
          rewardEnabled: false,
          isActive: batchForm.isActive,
          sortOrder: 10,
        })
        bundleId = (res as any)?.bundle?.id ?? ''
        setName = batchForm.name.trim()
        if (!bundleId) throw new Error('Bundle id missing in server response')
      }
      let ok = 0
      let failed = 0
      for (let i = 0; i < batchStaged.length; i++) {
        const s = batchStaged[i]
        setBatchProgress(`Uploading ${i + 1} / ${batchStaged.length}…`)
        try {
          const up = await api.admin.assets.upload(stagedToFile(s, i), 'stickers')
          await api.admin.stickers.createSticker({
            bundleId,
            name: s.name.trim() || 'Sticker',
            assetUrl: up.url,
            sortOrder: 100 + i,
            isActive: true,
          })
          ok++
        } catch {
          failed++
        }
      }
      if (ok > 0) toast.success(`${ok} sticker${ok > 1 ? 's' : ''} saved to “${setName}”`)
      if (failed > 0) {
        toast.warning(`${failed} upload${failed > 1 ? 's' : ''} failed — add the missing ones with another batch`)
      }
      closeBatch()
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Batch save failed')
    } finally {
      setBatchSaving(false)
      setBatchProgress(null)
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
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setBatchForm({ ...EMPTY_BATCH, mode: 'existing', targetBundleId: bundles[0]?.id ?? '' })}
            className="rounded-xl px-3 py-2 text-xs font-black flex items-center gap-1.5 bg-white/10 hover:bg-white/15"
            aria-label="Batch add a sticker pack"
          >
            <PackagePlus className="h-4 w-4" /> Batch Pack
          </button>
          <button
            onClick={() => setBundleForm({ ...EMPTY_BUNDLE })}
            className="bg-coral-gradient rounded-xl px-3 py-2 text-xs font-black flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Add Bundle
          </button>
        </div>
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
              <span className="w-8 h-8 flex items-center justify-center shrink-0" aria-hidden>
                {isImageIcon(b.icon) ? <img src={b.icon} alt="" className="w-8 h-8 object-contain" /> : <span className="text-2xl leading-none">{b.icon}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm">{b.name}</p>
                  {!b.isActive && <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-white/10 text-white/60">INACTIVE</span>}
                </div>
                <p className="text-[11px] text-white/50 mt-0.5">
                  <span className="font-bold text-white/70">{b.unlockType ?? 'coins'}</span>
                  {b.unlockType === 'event' && (b as any).event ? ` (${(b as any).event.name})` : ''}
                  {b.unlockType === 'realm' && b.realmLevel ? ` (realm ${b.realmLevel} · ${parseBundleWinnerPositions(b.winnerPositions)[1] ? '1st' : ''}${parseBundleWinnerPositions(b.winnerPositions)[1] && parseBundleWinnerPositions(b.winnerPositions)[2] ? ' + ' : ''}${parseBundleWinnerPositions(b.winnerPositions)[2] ? '2nd' : ''}${parseBundleWinnerPositions(b.winnerPositions)[3] ? ' + 3rd' : ''})` : ''}
                  {' · '}
                  {b.season ? `Season: ${b.season.name ?? b.season} · ` : ''}
                  {b.purchaseEnabled ? `🪙 ${b.priceCoins}` : ''}
                  {b.purchaseEnabled && b.rewardEnabled ? ' · ' : ''}
                  {b.rewardEnabled ? '🏆 reward unlock' : ''}
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
                        seasonId: b.seasonId ?? '',
                        eventId: (b as any).eventId ?? '',
                        realmLevel: b.realmLevel ? String(b.realmLevel) : '',
                        winnerPositions: parseBundleWinnerPositions(b.winnerPositions),
                        priceCoins: String(b.priceCoins),
                        purchaseEnabled: b.purchaseEnabled,
                        rewardEnabled: b.rewardEnabled,
                        isActive: b.isActive,
                        sortOrder: String(b.sortOrder),
                        newStickers: [],
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
                <button
                  onClick={() => setBatchForm({ ...EMPTY_BATCH, mode: 'existing', targetBundleId: b.id })}
                  className="text-[10px] font-black px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15"
                  aria-label={`Batch add stickers to ${b.name}`}
                >
                  ⇪ Batch add
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
              {/* Bundle icon — emoji OR uploaded image; live preview beside it. */}
              <div className="flex items-end gap-2.5">
                <div className="flex-1 min-w-0">
                  <Field label="Icon (emoji or image URL)">
                    <input value={bundleForm.icon} onChange={(e) => setBundleForm({ ...bundleForm, icon: e.target.value })} className={inputCls} placeholder="✨" />
                  </Field>
                </div>
                <span className="w-11 h-11 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden" aria-hidden>
                  {isImageIcon(bundleForm.icon) ? (
                    <img src={bundleForm.icon} alt="" className="w-8 h-8 object-contain" />
                  ) : (
                    <span className="text-2xl leading-none">{bundleForm.icon || '✨'}</span>
                  )}
                </span>
              </div>
              <label className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors">
                <UploadCloud className="w-3.5 h-3.5" aria-hidden />
                {uploading ? 'Uploading icon…' : 'Upload bundle icon image (PNG / WebP / GIF) → Supabase Storage'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/svg+xml"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (file.size > 4 * 1024 * 1024) {
                      toast.error('Images must be 4 MB or smaller')
                      return
                    }
                    setUploading(true)
                    void api.admin.assets
                      .upload(file, 'stickers')
                      .then((res) => {
                        setBundleForm((f) => (f ? { ...f, icon: res.url } : f))
                        toast.success('Icon uploaded', { description: res.storage.mode === 'supabase' ? 'Stored in Supabase Storage' : 'Stored in local uploads' })
                      })
                      .catch((err: unknown) => {
                        toast.error(err instanceof Error ? err.message : 'Upload failed')
                      })
                      .finally(() => {
                        setUploading(false)
                        e.target.value = ''
                      })
                  }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
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
                <Field label="Season">
                  <select value={bundleForm.seasonId} onChange={(e) => setBundleForm({ ...bundleForm, seasonId: e.target.value })} className={inputCls}>
                    <option value="">— none —</option>
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Realm Level (realm unlock)">
                  <select
                    value={bundleForm.realmLevel}
                    onChange={(e) => setBundleForm({ ...bundleForm, realmLevel: e.target.value })}
                    className={inputCls}
                    data-testid="bundle-realm-level"
                  >
                    <option value="">— none —</option>
                    {REALM_LEVEL_OPTIONS.map((lvl) => (
                      <option key={lvl} value={String(lvl)}>Realm {lvl}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Coin Price">
                  <input value={bundleForm.priceCoins} onChange={(e) => setBundleForm({ ...bundleForm, priceCoins: e.target.value, purchaseEnabled: true })} className={inputCls} inputMode="numeric" />
                </Field>
              </div>
              {/* Admin-console PRD §13 — winner positions for realm-linked sets */}
              {bundleForm.unlockType === 'realm' && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--qk-accent)]/25 bg-[var(--qk-accent)]/[0.06] px-3 py-2.5 text-xs">
                  <span className="font-black text-[10px] uppercase tracking-wider text-[var(--qk-accent)]">Winner positions</span>
                  {([1, 2, 3] as const).map((p) => (
                    <label key={p} className="flex items-center gap-1.5 font-semibold">
                      <input
                        type="checkbox"
                        checked={bundleForm.winnerPositions[p]}
                        onChange={(e) => setBundleForm({ ...bundleForm, winnerPositions: { ...bundleForm.winnerPositions, [p]: e.target.checked } })}
                      />
                      {p === 1 ? '1st place' : p === 2 ? '2nd place' : '3rd place'}
                    </label>
                  ))}
                  <span className="text-[10px] text-white/40">Final rank in a settled cycle of the linked realm unlocks the set.</span>
                </div>
              )}
              <div className="flex flex-wrap gap-3 text-xs">
                <label className="flex items-center gap-1.5 font-semibold">
                  <input type="checkbox" checked={bundleForm.purchaseEnabled} onChange={(e) => setBundleForm({ ...bundleForm, purchaseEnabled: e.target.checked })} />
                  Coin purchase
                </label>
                <label className="flex items-center gap-1.5 font-semibold">
                  <input type="checkbox" checked={bundleForm.rewardEnabled} onChange={(e) => setBundleForm({ ...bundleForm, rewardEnabled: e.target.checked })} />
                  Reward unlock
                </label>
                <label className="flex items-center gap-1.5 font-semibold">
                  <input type="checkbox" checked={bundleForm.isActive} onChange={(e) => setBundleForm({ ...bundleForm, isActive: e.target.checked })} />
                  Active
                </label>
              </div>

              {/* ── Sticker media upload — the whole point of this modal: pick
                  images from the admin's machine, they upload to Supabase
                  immediately and become GameSticker rows the moment this
                  bundle is saved (created bundles get them right away;
                  existing bundles get them appended). ─────────────────── */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-white/60">
                    <Images className="w-3.5 h-3.5" aria-hidden /> Sticker media
                  </span>
                  {bundleForm.id && (
                    <span className="text-[10px] font-semibold text-white/35">
                      {(bundles.find((x) => x.id === bundleForm.id)?.stickers?.length ?? 0)} existing
                    </span>
                  )}
                </div>
                {bundleForm.newStickers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {bundleForm.newStickers.map((s, i) => (
                      <div
                        key={`${s.assetUrl}-${i}`}
                        className="relative w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-0.5 overflow-hidden group"
                      >
                        <img src={s.assetUrl} alt={s.name} className="w-10 h-10 object-contain" />
                        <input
                          value={s.name}
                          onChange={(e) =>
                            setBundleForm((f) =>
                              f ? { ...f, newStickers: f.newStickers.map((n, j) => (j === i ? { ...n, name: e.target.value } : n)) } : f
                            )
                          }
                          className="w-full px-1 text-[9px] font-semibold text-white/70 bg-transparent border-0 outline-none text-center truncate"
                          placeholder="name"
                          maxLength={40}
                          aria-label={`Name for sticker ${i + 1}`}
                        />
                        <button
                          onClick={() => setBundleForm((f) => (f ? { ...f, newStickers: f.newStickers.filter((_, j) => j !== i) } : f))}
                          className="absolute top-0.5 right-0.5 w-4.5 h-4.5 rounded-full bg-rose-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ width: 18, height: 18 }}
                          aria-label={`Remove sticker ${s.name}`}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors">
                  <UploadCloud className="w-3.5 h-3.5" aria-hidden />
                  {uploading
                    ? 'Uploading…'
                    : `Upload sticker images (multiple) — added to this set on save · max ${STICKER_BATCH_MAX} per batch`}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/svg+xml"
                    className="hidden"
                    multiple
                    disabled={uploading || bundleForm.newStickers.length >= STICKER_BATCH_MAX}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length === 0) return
                      const room = STICKER_BATCH_MAX - bundleForm.newStickers.length
                      if (room <= 0) {
                        toast.error(`A set holds at most ${STICKER_BATCH_MAX} stickers per batch — save, then add more`)
                        return
                      }
                      const take = files.slice(0, room)
                      if (files.length > room) {
                        toast.error(`Only ${room} more can be staged — batch uploads cap at ${STICKER_BATCH_MAX}`)
                      }
                      const tooBig = take.find((f) => f.size > 4 * 1024 * 1024)
                      if (tooBig) {
                        toast.error('Images must be 4 MB or smaller')
                        return
                      }
                      setUploading(true)
                      void Promise.all(
                        take.map(async (file) => {
                          const res = await api.admin.assets.upload(file, 'stickers')
                          return { name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Sticker', assetUrl: res.url }
                        })
                      )
                        .then((staged) => {
                          setBundleForm((f) => (f ? { ...f, newStickers: [...f.newStickers, ...staged] } : f))
                          toast.success(`${staged.length} sticker${staged.length > 1 ? 's' : ''} uploaded`, {
                            description: 'They join the set when you save this bundle',
                          })
                        })
                        .catch((err: unknown) => {
                          toast.error(err instanceof Error ? err.message : 'Upload failed')
                        })
                        .finally(() => {
                          setUploading(false)
                          e.target.value = ''
                        })
                    }}
                  />
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

      {/* ─── Batch pack uploader — up to 20 files → ONE uniform size → ONE set */}
      <AnimatePresenceSheet>
        {batchForm && (
          <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => closeBatch()} />
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="relative w-[min(94vw,28rem)] max-h-[88vh] overflow-y-auto bg-[var(--qk-card)] border border-white/15 rounded-3xl p-4 flex flex-col gap-2.5"
              data-testid="batch-pack-modal"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-sm">Batch Add Pack</h3>
                  <p className="text-[10px] text-white/40 leading-tight">Up to {STICKER_BATCH_MAX} files · resized to one size · stored as one batch</p>
                </div>
                <button onClick={() => closeBatch()} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Target: brand-new named set, or an existing set */}
              <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/5 border border-white/10">
                {(['new', 'existing'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setBatchForm((f) => (f ? { ...f, mode: m } : f))}
                    className={cn(
                      'flex-1 rounded-xl px-2 py-1.5 text-[11px] font-black transition-colors',
                      batchForm.mode === m ? 'bg-[var(--qk-accent)] text-[var(--qk-on-accent)]' : 'text-white/55 hover:text-white/85'
                    )}
                    aria-pressed={batchForm.mode === m}
                  >
                    {m === 'new' ? 'New sticker set' : 'Add to existing set'}
                  </button>
                ))}
              </div>

              {batchForm.mode === 'new' ? (
                <>
                  <Field label="Sticker Set Name *">
                    <input value={batchForm.name} onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })} className={inputCls} placeholder="Party Animals" />
                  </Field>
                  <Field label="Description">
                    <input value={batchForm.description} onChange={(e) => setBatchForm({ ...batchForm, description: e.target.value })} className={inputCls} placeholder="The whole gang in one drop" />
                  </Field>
                  <div className="flex items-end gap-2.5">
                    <div className="flex-1 min-w-0">
                      <Field label="Icon (emoji or image URL)">
                        <input value={batchForm.icon} onChange={(e) => setBatchForm({ ...batchForm, icon: e.target.value })} className={inputCls} placeholder="🎉" />
                      </Field>
                    </div>
                    <span className="w-11 h-11 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden" aria-hidden>
                      {isImageIcon(batchForm.icon) ? (
                        <img src={batchForm.icon} alt="" className="w-8 h-8 object-contain" />
                      ) : (
                        <span className="text-2xl leading-none">{batchForm.icon || '✨'}</span>
                      )}
                    </span>
                  </div>
                  <label className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors">
                    <UploadCloud className="w-3.5 h-3.5" aria-hidden />
                    {uploading ? 'Uploading icon…' : 'Upload set icon image → Supabase Storage'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/svg+xml"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.size > 4 * 1024 * 1024) {
                          toast.error('Images must be 4 MB or smaller')
                          return
                        }
                        setUploading(true)
                        void api.admin.assets
                          .upload(file, 'stickers')
                          .then((res) => {
                            setBatchForm((f) => (f ? { ...f, icon: res.url } : f))
                            toast.success('Icon uploaded', { description: res.storage.mode === 'supabase' ? 'Stored in Supabase Storage' : 'Stored in local uploads' })
                          })
                          .catch((err: unknown) => {
                            toast.error(err instanceof Error ? err.message : 'Upload failed')
                          })
                          .finally(() => {
                            setUploading(false)
                            e.target.value = ''
                          })
                      }}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Unlock Method">
                      <select value={batchForm.unlockType} onChange={(e) => setBatchForm({ ...batchForm, unlockType: e.target.value })} className={inputCls}>
                        {BATCH_UNLOCK_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </Field>
                    {batchForm.unlockType === 'coins' ? (
                      <Field label="Coin Price *">
                        <input value={batchForm.priceCoins} onChange={(e) => setBatchForm({ ...batchForm, priceCoins: e.target.value })} className={inputCls} inputMode="numeric" placeholder="500" />
                      </Field>
                    ) : (
                      <Field label="Active">
                        <select value={batchForm.isActive ? '1' : '0'} onChange={(e) => setBatchForm({ ...batchForm, isActive: e.target.value === '1' })} className={inputCls}>
                          <option value="1">Active</option>
                          <option value="0">Inactive</option>
                        </select>
                      </Field>
                    )}
                  </div>
                  <p className="text-[10px] text-white/35 leading-snug">
                    Realm / season / event linkage and full pricing can be attached right afterwards by editing the created set.
                  </p>
                </>
              ) : (
                <Field label="Add This Batch To Set *">
                  <select
                    value={batchForm.targetBundleId}
                    onChange={(e) => setBatchForm({ ...batchForm, targetBundleId: e.target.value })}
                    className={inputCls}
                    data-testid="batch-target-set"
                  >
                    <option value="">— choose a sticker set —</option>
                    {bundles.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
              )}

              {/* ── the batch itself: files → previews → ONE uniform size ── */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-white/60">
                    <Images className="w-3.5 h-3.5" aria-hidden /> Sticker batch
                  </span>
                  <span className="text-[10px] font-bold text-white/40" data-testid="batch-count">
                    {batchStaged.length} / {STICKER_BATCH_MAX}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-white/50">Resize all to</span>
                  {STICKER_SIZE_OPTIONS.map((px) => (
                    <button
                      key={px}
                      onClick={() => void restageAll(px)}
                      disabled={staging || batchSaving || batchStaged.length === 0 || batchTarget === px}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-black border transition-colors disabled:opacity-40',
                        batchTarget === px
                          ? 'bg-[var(--qk-accent)] text-[var(--qk-on-accent)] border-transparent'
                          : 'bg-white/5 border-white/15 text-white/60 hover:text-white'
                      )}
                      aria-pressed={batchTarget === px}
                    >
                      {px}px
                    </button>
                  ))}
                </div>
                {staging && <p className="text-[10px] font-semibold text-white/40">Resizing previews…</p>}
                {batchStaged.length > 0 && (
                  <div className="grid grid-cols-4 gap-2" data-testid="batch-staged-grid">
                    {batchStaged.map((s, i) => (
                      <div
                        key={s.uid}
                        className="relative rounded-xl bg-white/5 border border-white/10 flex flex-col items-center gap-0.5 overflow-hidden group"
                      >
                        <img src={s.previewUrl} alt={s.name} className="w-12 h-12 object-contain mt-1" />
                        <span className="text-[8px] font-bold text-white/35">{s.resized ? `${s.width}×${s.height}` : 'original'}</span>
                        <input
                          value={s.name}
                          onChange={(e) => setBatchStaged((prev) => prev.map((n, j) => (j === i ? { ...n, name: e.target.value } : n)))}
                          className="w-full px-1 text-[9px] font-semibold text-white/70 bg-transparent border-0 outline-none text-center truncate"
                          placeholder="name"
                          maxLength={40}
                          aria-label={`Name for sticker ${i + 1}`}
                        />
                        <button
                          onClick={() => removeStaged(s.uid)}
                          className="absolute top-0.5 right-0.5 rounded-full bg-rose-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ width: 18, height: 18 }}
                          aria-label={`Remove ${s.name}`}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors">
                  <UploadCloud className="w-3.5 h-3.5" aria-hidden />
                  {staging
                    ? 'Staging…'
                    : `Select up to ${STICKER_BATCH_MAX} sticker images (PNG / WebP / JPG / GIF / SVG)`}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/svg+xml"
                    className="hidden"
                    multiple
                    disabled={staging || batchSaving || batchStaged.length >= STICKER_BATCH_MAX}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      e.target.value = ''
                      if (files.length > 0) void pickBatchFiles(files)
                    }}
                  />
                </label>
                <p className="text-[10px] text-white/35 leading-snug">
                  Every image is resized to the SAME square size with transparent padding; animated GIFs and SVGs keep their original file.
                </p>
              </div>

              <button
                onClick={() => void saveBatch()}
                disabled={batchSaving || staging || batchStaged.length === 0}
                className="mt-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-black tracking-wide disabled:opacity-50"
              >
                {batchSaving
                  ? (batchProgress ?? 'Saving…')
                  : `Save Batch — ${batchStaged.length} sticker${batchStaged.length === 1 ? '' : 's'}`}
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
              {/* Map this sticker to a pack — choosing another set here re-maps
                  an existing sticker (server PATCH validates the target). */}
              <Field label="Sticker Set (pack) *">
                <select
                  value={stickerForm.bundleId}
                  onChange={(e) => setStickerForm({ ...stickerForm, bundleId: e.target.value })}
                  className={inputCls}
                  data-testid="sticker-set-select"
                >
                  <option value="">— choose a sticker set —</option>
                  {bundles.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sticker Asset * (emoji or https://…/sticker.png)">
                <input value={stickerForm.assetUrl} onChange={(e) => setStickerForm({ ...stickerForm, assetUrl: e.target.value })} className={inputCls} placeholder="😍" />
              </Field>
              {/* Admin-console PRD §6 — upload the sticker icon from the admin's machine */}
              <label className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors">
                <UploadCloud className="w-3.5 h-3.5" aria-hidden />
                Upload sticker image (PNG / WebP / GIF) → Supabase Storage
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
                    void api.admin.assets
                      .upload(file, 'stickers')
                      .then((res) => {
                        setStickerForm((f) => (f ? { ...f, assetUrl: res.url } : f))
                        toast.success('Sticker image uploaded', { description: res.storage.mode === 'supabase' ? 'Stored in Supabase Storage' : 'Stored in local uploads' })
                      })
                      .catch((err: unknown) => {
                        toast.error(err instanceof Error ? err.message : 'Upload failed')
                      })
                      .finally(() => {
                        e.target.value = ''
                      })
                  }}
                />
              </label>
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
