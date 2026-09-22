'use client'

// Quicky — ADMIN REWARDS & COSMETICS (admin-console PRD §8/§9/§10)
//
// The reusable reward catalog. Rewards are created HERE first, saved, then
// assigned to realm winner positions in the Realms screen (§10 workflow).
//
// Type-specific fields:
//   COINS          → coin amount
//   STICKER_SET    → sticker bundle picker
//   GIFT           → gift catalog item picker
//   HAT / PROFILE_FRAME / NAME_DECORATOR / CHAT_BUBBLE → 3 cosmetic levels
//     · Level 1 + 2: static asset (image upload or URL, or emoji glyph)
//     · Level 3: REAL animation asset (animated image URL — GIF/WebP/APNG —
//       or a frame sequence with fps/loop) — never CSS-only (§9.2)
//   NAME_DECORATOR → left/right decorations (emoji or image URL)
//   CHAT_BUBBLE    → color / border / light-text / optional frame image
//
// Includes a LIVE PREVIEW (static levels render the asset; level 3 plays
// the animated image or cycles the frame sequence at the configured fps).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'
import { ImageUploader, AssetPreview, isProbablyImageUrl } from './ImageUploader'

type RewardType = 'COINS' | 'STICKER_SET' | 'GIFT' | 'HAT' | 'PROFILE_FRAME' | 'NAME_DECORATOR' | 'CHAT_BUBBLE'

type LevelAsset = { kind: 'image'; url: string } | { kind: 'emoji'; glyph: string }
type CosmeticAnimation = { type: 'animated-image'; url: string } | { type: 'frames'; frameUrls: string[]; fps: number; loop: boolean }

type RewardRow = {
  id: string
  rewardType: RewardType
  name: string
  description: string | null
  rarity: string
  status: string
  icon: string
  ruleCount: number
  grantCount: number
  metadata: {
    coinAmount?: number
    itemId?: string
    bundleId?: string
    levels?: Partial<Record<1 | 2 | 3, LevelAsset | CosmeticAnimation>>
    decorator?: { left?: string; right?: string }
    bubble?: { color?: string; border?: string; textLight?: boolean; frameUrl?: string }
  }
}

const COSMETIC_TYPES: RewardType[] = ['HAT', 'PROFILE_FRAME', 'NAME_DECORATOR', 'CHAT_BUBBLE']
const REWARD_TYPE_OPTIONS: { value: RewardType; label: string }[] = [
  { value: 'COINS', label: '🪙 In-game Coins' },
  { value: 'STICKER_SET', label: '✨ Sticker Set' },
  { value: 'GIFT', label: '🎁 Gift Item' },
  { value: 'HAT', label: '🎩 Profile Hat' },
  { value: 'PROFILE_FRAME', label: '🖼️ Profile Frame' },
  { value: 'NAME_DECORATOR', label: '👑 Name Decorator' },
  { value: 'CHAT_BUBBLE', label: '💬 Chat Bubble' },
]
const RARITY_OPTIONS = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

/** Narrow a level asset to a displayable src (image URL, emoji or animated). */
function assetSrc(asset: LevelAsset | CosmeticAnimation | null | undefined): string | null {
  if (!asset) return null
  if ('kind' in asset) return asset.kind === 'image' ? asset.url : asset.glyph
  if (asset.type === 'animated-image') return asset.url
  return asset.frameUrls[0] ?? null
}

/** Level-3 frame sequence player (admin preview). */
function FramePlayer({ asset, className }: { asset: Extract<CosmeticAnimation, { type: 'frames' }>; className?: string }) {
  const [frame, setFrame] = useState(0)
  const fps = Math.max(1, Math.min(24, Math.floor(asset.fps) || 8))
  useEffect(() => {
    if (asset.frameUrls.length < 2) return
    const id = setInterval(() => setFrame((f) => (f + 1) % asset.frameUrls.length), 1000 / fps)
    return () => clearInterval(id)
  }, [asset.frameUrls.length, fps])
  const url = asset.frameUrls[Math.min(frame, asset.frameUrls.length - 1)]
  if (!url) return null
   
  return <img src={url} alt="frame" className={`object-contain ${className ?? ''}`} />
}

/** Renders ANY level asset (static, animated image, or frame sequence). */
export function CosmeticAssetRender({ asset, className }: { asset: LevelAsset | CosmeticAnimation | null | undefined; className?: string }) {
  if (!asset) return null
  if ('type' in asset && asset.type === 'frames') return <FramePlayer asset={asset} className={className} />
  const src = assetSrc(asset)
  if (!src) return null
  if (isProbablyImageUrl(src)) {
     
    return <img src={src} alt="cosmetic" className={`object-contain ${className ?? ''}`} />
  }
  return <span className={`flex items-center justify-center ${className ?? ''}`}>{src}</span>
}

export function AdminRewardsScreen() {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rewards, setRewards] = useState<RewardRow[]>([])
  const [giftItems, setGiftItems] = useState<{ id: string; name: string }[]>([])
  const [stickerBundles, setStickerBundles] = useState<{ id: string; name: string }[]>([])
  const [typeFilter, setTypeFilter] = useState<'ALL' | RewardType>('ALL')
  const [editing, setEditing] = useState<RewardRow | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    // NOTE: every setState lives AFTER the first await — nothing is
    // synchronously reachable from the mount effect (react-hooks/
    // set-state-in-effect), and a failed refresh keeps the error banner
    // until a successful load clears it.
    try {
      const [res, giftsRes, bundlesRes] = await Promise.all([
        api.admin.rewards.list(),
        api.admin.gifts.list().catch(() => null),
        api.admin.stickers.bundles().catch(() => null),
      ])
      setRewards((res?.rewards ?? []) as RewardRow[])
      setGiftItems(((giftsRes?.gifts ?? []) as { id: string; name: string }[]).map((g) => ({ id: g.id, name: g.name })))
      setStickerBundles(((bundlesRes?.bundles ?? []) as { id: string; name: string }[]).map((b) => ({ id: b.id, name: b.name })))
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

  const filtered = useMemo(
    () => (typeFilter === 'ALL' ? rewards : rewards.filter((r) => r.rewardType === typeFilter)),
    [rewards, typeFilter]
  )

  const remove = async (row: RewardRow) => {
    if (!confirm(`Delete "${row.name}"?${row.ruleCount || row.grantCount ? `\n\nIt is referenced by ${row.ruleCount} realm rule(s) and ${row.grantCount} grant(s) — it will be DISABLED instead of deleted.` : ''}`)) return
    try {
      const res = await api.admin.rewards.remove(row.id)
      toast.success(res?.disabled ? 'Reward disabled (still referenced)' : 'Reward deleted')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const toggleStatus = async (row: RewardRow) => {
    try {
      await api.admin.rewards.update(row.id, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })
      toast.success(row.status === 'ACTIVE' ? 'Reward disabled' : 'Reward enabled')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (failed) return <ConsoleRetry onRetry={load} />
  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/40 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading reward catalog…
      </div>
    )
  }

  const counts = {
    total: rewards.length,
    active: rewards.filter((r) => r.status === 'ACTIVE').length,
    grants: rewards.reduce((sum, r) => sum + (r.grantCount ?? 0), 0),
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Catalog rewards', value: counts.total, sub: `${counts.active} active` },
          { label: 'Reward types', value: REWARD_TYPE_OPTIONS.length, sub: 'coins → cosmetics' },
          { label: 'Granted to players', value: counts.grants, sub: 'all-time' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-white/8 bg-[#101623] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-white/40">{card.label}</p>
            <p className="text-2xl font-black mt-1">{card.value}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      <ConsoleCard
        title="Reward Catalog"
        action={
          <div className="flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'ALL' | RewardType)}
              className="rounded-xl border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white focus:outline-none"
            >
              <option value="ALL">All types</option>
              {REWARD_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setCreating(true)
                setEditing(null)
              }}
              className="flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-3.5 py-1.5 text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> New Reward
            </button>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">
            No rewards yet — create catalog rewards first, then assign them to realm winner positions in the Realms screen.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                <div className="w-11 h-11 shrink-0 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center overflow-hidden">
                  <AssetPreview value={row.icon} className="w-9 h-9" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate">{row.name}</p>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-white/8 text-white/50">{row.rewardType.replace('_', ' ')}</span>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${row.rarity === 'LEGENDARY' ? 'bg-amber-500/15 text-amber-300' : row.rarity === 'EPIC' ? 'bg-purple-500/15 text-purple-300' : row.rarity === 'RARE' ? 'bg-sky-500/15 text-sky-300' : 'bg-white/8 text-white/40'}`}>{row.rarity}</span>
                  </div>
                  <p className="text-[11px] text-white/35 truncate">
                    {row.rewardType === 'COINS' && `🪙 ${row.metadata.coinAmount ?? 0} coins`}
                    {row.rewardType === 'STICKER_SET' && `✨ ${stickerBundles.find((b) => b.id === row.metadata.bundleId)?.name ?? 'unlinked bundle'}`}
                    {row.rewardType === 'GIFT' && `🎁 ${giftItems.find((g) => g.id === row.metadata.itemId)?.name ?? 'unlinked item'}`}
                    {COSMETIC_TYPES.includes(row.rewardType) && '3 levels · L3 animated'}
                    {row.ruleCount > 0 && ` · ${row.ruleCount} realm rule(s)`}
                    {row.grantCount > 0 && ` · ${row.grantCount} grant(s)`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toggleStatus(row)}
                    className={`text-[10px] font-black px-2.5 py-1 rounded-full ${row.status === 'ACTIVE' ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-white/8 text-white/40'}`}
                  >
                    {row.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(row)
                      setCreating(false)
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/8 hover:bg-white/15 text-white/70"
                  >
                    Edit
                  </button>
                  <button onClick={() => remove(row)} className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-300" title="Delete reward">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ConsoleCard>

      {(creating || editing) && (
        <RewardEditor
          initial={editing}
          giftItems={giftItems}
          stickerBundles={stickerBundles}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ─── Editor ─────────────────────────────────────────────────────────────────

function RewardEditor({
  initial,
  giftItems,
  stickerBundles,
  onClose,
  onSaved,
}: {
  initial: RewardRow | null
  giftItems: { id: string; name: string }[]
  stickerBundles: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [rewardType, setRewardType] = useState<RewardType>(initial?.rewardType ?? 'COINS')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rarity, setRarity] = useState(initial?.rarity ?? 'COMMON')
  const [coinAmount, setCoinAmount] = useState(initial?.metadata.coinAmount ?? 1000)
  const [itemId, setItemId] = useState(initial?.metadata.itemId ?? '')
  const [bundleId, setBundleId] = useState(initial?.metadata.bundleId ?? '')
  const [levels, setLevels] = useState<Partial<Record<1 | 2 | 3, LevelAsset | CosmeticAnimation>>>(initial?.metadata.levels ?? {})
  const [animMode, setAnimMode] = useState<'animated-image' | 'frames'>(
    (levels[3] as { type?: string } | undefined)?.type === 'frames' ? 'frames' : 'animated-image'
  )
  const [frameUrls, setFrameUrls] = useState(
    (levels[3] as Extract<CosmeticAnimation, { type: 'frames' }> | undefined)?.frameUrls.join('\n') ?? ''
  )
  const [fps, setFps] = useState((levels[3] as Extract<CosmeticAnimation, { type: 'frames' }> | undefined)?.fps ?? 10)
  const [decoratorLeft, setDecoratorLeft] = useState(initial?.metadata.decorator?.left ?? '')
  const [decoratorRight, setDecoratorRight] = useState(initial?.metadata.decorator?.right ?? '')
  const [bubbleColor, setBubbleColor] = useState(initial?.metadata.bubble?.color ?? '#f43f5e')
  const [bubbleBorder, setBubbleBorder] = useState(initial?.metadata.bubble?.border ?? '')
  const [bubbleTextLight, setBubbleTextLight] = useState(initial?.metadata.bubble?.textLight ?? true)

  const isCosmetic = COSMETIC_TYPES.includes(rewardType)

  const buildMetadata = (): Record<string, unknown> => {
    if (rewardType === 'COINS') return { coinAmount: Math.floor(coinAmount) }
    if (rewardType === 'GIFT') return { itemId }
    if (rewardType === 'STICKER_SET') return { bundleId }
    const meta: Record<string, unknown> = { levels }
    if (rewardType === 'NAME_DECORATOR') meta.decorator = { left: decoratorLeft || undefined, right: decoratorRight || undefined }
    if (rewardType === 'CHAT_BUBBLE') meta.bubble = { color: bubbleColor, border: bubbleBorder || undefined, textLight: bubbleTextLight }
    return meta
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('Reward name is required')
      return
    }
    if (rewardType === 'COINS' && (!Number.isInteger(coinAmount) || coinAmount < 1)) {
      toast.error('Coin amount must be a whole number ≥ 1')
      return
    }
    if (rewardType === 'GIFT' && !itemId) {
      toast.error('Pick a gift catalog item')
      return
    }
    if (rewardType === 'STICKER_SET' && !bundleId) {
      toast.error('Pick a sticker bundle')
      return
    }
    if (isCosmetic && !levels[1]) {
      toast.error('Level 1 needs a static asset (image or emoji)')
      return
    }
    if (isCosmetic && levels[3] && !('kind' in levels[3]) && levels[3].type === 'frames') {
      const urls = frameUrls.split('\n').map((u) => u.trim()).filter(isProbablyImageUrl)
      if (urls.length < 2) {
        toast.error('A frame sequence needs at least 2 image URLs')
        return
      }
      levels[3] = { type: 'frames', frameUrls: urls, fps: Math.max(1, Math.min(24, Math.floor(fps) || 10)), loop: true }
    }
    setSaving(true)
    try {
      const payload = { rewardType, name: name.trim(), description: description.trim() || null, rarity, status: initial?.status ?? 'ACTIVE', metadata: buildMetadata() }
      if (initial) await api.admin.rewards.update(initial.id, payload)
      else await api.admin.rewards.create(payload)
      toast.success(initial ? 'Reward updated' : 'Reward created')
      onSaved()
    } catch (e: unknown) {
      const err = e as { message?: string; body?: { message?: string } }
      toast.error(err?.body?.message ?? err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const setStaticLevel = (level: 1 | 2, value: string | null) => {
    setLevels((prev) => {
      const next = { ...prev }
      if (!value) delete next[level]
      else if (isProbablyImageUrl(value)) next[level] = { kind: 'image', url: value }
      else next[level] = { kind: 'emoji', glyph: value.slice(0, 4) }
      return next
    })
  }
  const setAnimatedLevel = (url: string | null) => {
    setLevels((prev) => {
      const next = { ...prev }
      if (!url) delete next[3]
      else next[3] = { type: 'animated-image', url }
      return next
    })
  }

  const levelPreview = levels[3]
  const staticValue = (level: 1 | 2): string | null => {
    const asset = levels[level]
    return asset && 'kind' in asset ? (asset.kind === 'image' ? asset.url : asset.glyph) : null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0E121A] p-5">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/8">
          <h3 className="text-sm font-black flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--qk-accent)]" aria-hidden />
            {initial ? 'Edit Reward' : 'New Reward'}
          </h3>
          <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/50"><X className="w-4 h-4" aria-hidden /></button>
        </div>

        {/* Two fields per row (PRD §6.1 layout convention) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Reward type</label>
            <select value={rewardType} onChange={(e) => setRewardType(e.target.value as RewardType)} className={`${inputCls} mt-1`} disabled={!!initial}>
              {REWARD_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Rarity</label>
            <select value={rarity} onChange={(e) => setRarity(e.target.value)} className={`${inputCls} mt-1`}>
              {RARITY_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Reward name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Golden Laurel Frame" className={`${inputCls} mt-1`} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown in the reward popup" className={`${inputCls} mt-1`} />
          </div>

          {rewardType === 'COINS' && (
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Coin amount</label>
              <input type="number" min={1} value={coinAmount} onChange={(e) => setCoinAmount(Number(e.target.value))} className={`${inputCls} mt-1`} />
            </div>
          )}
          {rewardType === 'GIFT' && (
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Gift catalog item</label>
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">— pick a gift —</option>
                {giftItems.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}
          {rewardType === 'STICKER_SET' && (
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Sticker bundle</label>
              <select value={bundleId} onChange={(e) => setBundleId(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">— pick a bundle —</option>
                {stickerBundles.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isCosmetic && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/20 p-4">
            <p className="text-[11px] font-black uppercase tracking-wider text-white/40">Cosmetic levels — L1/L2 static, L3 animated</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ImageUploader
                label="Level 1 · static (image or emoji)"
                value={staticValue(1)}
                onChange={(v) => setStaticLevel(1, v)}
                folder="cosmetics"
                compact
              />
              <ImageUploader
                label="Level 2 · static (image or emoji)"
                value={staticValue(2)}
                onChange={(v) => setStaticLevel(2, v)}
                folder="cosmetics"
                compact
              />
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-[var(--qk-accent)]/20 bg-[var(--qk-accent)]/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black uppercase tracking-wider text-[var(--qk-accent)]">Level 3 · ANIMATED</p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setAnimMode('animated-image')} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${animMode === 'animated-image' ? 'bg-[var(--qk-accent)]/20 text-[var(--qk-accent)]' : 'bg-white/5 text-white/40'}`}>Animated image</button>
                  <button type="button" onClick={() => setAnimMode('frames')} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${animMode === 'frames' ? 'bg-[var(--qk-accent)]/20 text-[var(--qk-accent)]' : 'bg-white/5 text-white/40'}`}>Frame sequence</button>
                </div>
              </div>
              {animMode === 'animated-image' ? (
                <ImageUploader
                  label="GIF / animated WebP / APNG"
                  value={levelPreview && !('kind' in levelPreview) && levelPreview.type === 'animated-image' ? levelPreview.url : null}
                  onChange={setAnimatedLevel}
                  folder="animations"
                  compact
                  hint="A real animated asset — animation lives in the file, not CSS."
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Frame URLs (one per line)</label>
                  <textarea
                    value={frameUrls}
                    onChange={(e) => setFrameUrls(e.target.value)}
                    rows={3}
                    placeholder={'https://…/frame1.png\nhttps://…/frame2.png'}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-white/50 font-bold">FPS</label>
                    <input type="number" min={1} max={24} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-20 rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white" />
                    {frameUrls.trim() && (
                      <div className="ml-auto w-12 h-12 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center overflow-hidden">
                        <CosmeticAssetRender
                          asset={{ type: 'frames', frameUrls: frameUrls.split('\n').map((u) => u.trim()).filter(isProbablyImageUrl), fps, loop: true }}
                          className="w-10 h-10"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {rewardType === 'NAME_DECORATOR' && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Left decoration (emoji or image URL)</label>
              <input value={decoratorLeft} onChange={(e) => setDecoratorLeft(e.target.value)} placeholder="👑" className={`${inputCls} mt-1`} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Right decoration</label>
              <input value={decoratorRight} onChange={(e) => setDecoratorRight(e.target.value)} placeholder="👑" className={`${inputCls} mt-1`} />
            </div>
          </div>
        )}

        {rewardType === 'CHAT_BUBBLE' && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Bubble color</label>
              <input type="color" value={bubbleColor} onChange={(e) => setBubbleColor(e.target.value)} className="w-full h-[42px] rounded-xl border border-white/10 bg-black/30 mt-1 p-1" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Border color (optional)</label>
              <input value={bubbleBorder} onChange={(e) => setBubbleBorder(e.target.value)} placeholder="#fbbf24" className={`${inputCls} mt-1`} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-white/60 pb-2.5">
                <input type="checkbox" checked={bubbleTextLight} onChange={(e) => setBubbleTextLight(e.target.checked)} className="accent-[var(--qk-accent)]" />
                Light text on this bubble
              </label>
            </div>
          </div>
        )}

        {rewardType === 'CHAT_BUBBLE' && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/8 bg-black/20 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Preview</p>
            <div className="flex">
              <div
                className="max-w-[70%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm"
                style={{
                  backgroundColor: bubbleColor,
                  border: bubbleBorder ? `1px solid ${bubbleBorder}` : undefined,
                  color: bubbleTextLight ? '#fff' : '#15141e',
                }}
              >
                Hey! Nice spin back there 🍾
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-white/8">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-xs font-bold text-white/50 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-5 py-2 text-xs font-bold disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" aria-hidden /> {saving ? 'Saving…' : initial ? 'Save changes' : 'Create reward'}
          </button>
        </div>
      </div>
    </div>
  )
}
