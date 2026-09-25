'use client'

// Quicky — ADMIN COSMETIC CATALOGS (Frames / Hats / Name Icons / Chat Bubbles)
//
// ONE parameterized screen mounted four times in the console side panel.
// Each page is the CRUD home for its cosmetic type with the necessary
// fields + REAL assets (uploads land in Supabase Storage / local uploads):
//   · Frames / Hats — L1/L2 static assets (image upload, URL or emoji) +
//     L3 ANIMATED (real animated image or a frame sequence with fps)
//   · Name Icons — left/right decorations beside the player name
//   · Chat Bubbles — color / border / light text + optional frame image
// Grants land in UserCosmetic through the reward-claim popup.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'
import { ImageUploader, AssetPreview, isProbablyImageUrl } from './ImageUploader'

export type CosmeticKind = 'PROFILE_FRAME' | 'HAT' | 'NAME_DECORATOR' | 'CHAT_BUBBLE'

export const COSMETIC_KINDS: { kind: CosmeticKind; navKey: string; title: string; icon: string; blurb: string }[] = [
  {
    kind: 'PROFILE_FRAME',
    navKey: 'frames',
    title: 'Frames',
    icon: '🖼️',
    blurb: 'Profile-picture frames — L1/L2 static, L3 animated. Awarded per realm place with a level.',
  },
  {
    kind: 'HAT',
    navKey: 'hats',
    title: 'Hats',
    icon: '🎩',
    blurb: 'Profile hats — L1/L2 static, L3 animated. Awarded per realm place with a level.',
  },
  {
    kind: 'NAME_DECORATOR',
    navKey: 'name-icons',
    title: 'Name Icons',
    icon: '👑',
    blurb: 'Decorations rendered beside the player name in chats and leaderboards.',
  },
  {
    kind: 'CHAT_BUBBLE',
    navKey: 'chat-bubbles',
    title: 'Chat Bubbles',
    icon: '💬',
    blurb: 'Chat message bubbles — custom color, border and optional frame image.',
  },
]

const RARITY_OPTIONS = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']

type LevelAsset = { kind: 'image'; url: string } | { kind: 'emoji'; glyph: string }
type CosmeticAnimation = { type: 'animated-image'; url: string } | { type: 'frames'; frameUrls: string[]; fps: number; loop: boolean }

type RewardRow = {
  id: string
  rewardType: string
  name: string
  description: string | null
  rarity: string
  status: string
  ruleCount: number
  grantCount: number
  metadata: {
    coinAmount?: number
    cratePoints?: number
    itemId?: string
    bundleId?: string
    levels?: Partial<Record<1 | 2 | 3, LevelAsset | CosmeticAnimation>>
    decorator?: { left?: string; right?: string }
    bubble?: { color?: string; border?: string; textLight?: boolean; frameUrl?: string }
  }
}

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
function CosmeticAssetRender({ asset, className }: { asset: LevelAsset | CosmeticAnimation | null | undefined; className?: string }) {
  if (!asset) return null
  if ('type' in asset && asset.type === 'frames') return <FramePlayer asset={asset} className={className} />
  const src = assetSrc(asset)
  if (!src) return null
  if (isProbablyImageUrl(src)) {
    return <img src={src} alt="cosmetic" className={`object-contain ${className ?? ''}`} />
  }
  return <span className={`flex items-center justify-center ${className ?? ''}`}>{src}</span>
}

/** Which cosmetic levels are configured (list summary). */
function levelsSummary(levels: Partial<Record<1 | 2 | 3, LevelAsset | CosmeticAnimation>> | undefined): string {
  if (!levels || Object.keys(levels).length === 0) return 'no assets'
  const parts: string[] = []
  for (const lv of [1, 2, 3] as const) {
    const asset = levels[lv]
    if (!asset) continue
    const animated = 'type' in asset
    parts.push(`L${lv}${animated ? ' ✨' : ''}`)
  }
  return parts.join(' · ')
}

export function AdminCosmeticCatalogScreen({ kind }: { kind: CosmeticKind }) {
  const meta = COSMETIC_KINDS.find((k) => k.kind === kind)!
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rewards, setRewards] = useState<RewardRow[]>([])
  const [editing, setEditing] = useState<RewardRow | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    // NOTE: every setState lives AFTER the first await — nothing is
    // synchronously reachable from the mount effect.
    try {
      const res = await api.admin.rewards.list()
      setRewards(((res?.rewards ?? []) as RewardRow[]).filter((r) => r.rewardType === kind))
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [kind])

  useEffect(() => {
    setLoaded(false)
    setEditing(null)
    setCreating(false)
    void load()
  }, [load])

  const remove = async (row: RewardRow) => {
    if (!confirm(`Delete "${row.name}"?${row.ruleCount || row.grantCount ? `\n\nIt is referenced by ${row.ruleCount} realm rule(s) and ${row.grantCount} grant(s) — it will be DISABLED instead of deleted.` : ''}`)) return
    try {
      const res = await api.admin.rewards.remove(row.id)
      toast.success(res?.disabled ? `${meta.title.slice(0, -1)} disabled (still referenced)` : `${meta.title.slice(0, -1)} deleted`)
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const toggleStatus = async (row: RewardRow) => {
    try {
      await api.admin.rewards.update(row.id, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })
      toast.success(row.status === 'ACTIVE' ? 'Disabled' : 'Enabled')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (failed) return <ConsoleRetry onRetry={load} />
  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/40 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading {meta.title.toLowerCase()}…
      </div>
    )
  }

  const counts = {
    total: rewards.length,
    active: rewards.filter((r) => r.status === 'ACTIVE').length,
    grants: rewards.reduce((sum, r) => sum + (r.grantCount ?? 0), 0),
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: meta.title, value: counts.total, sub: `${counts.active} active` },
          { label: 'Granted to players', value: counts.grants, sub: 'all-time' },
          { label: 'Realm rules', value: rewards.reduce((sum, r) => sum + (r.ruleCount ?? 0), 0), sub: 'assignments' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-white/8 bg-[#101623] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-white/40">{card.label}</p>
            <p className="text-2xl font-black mt-1">{card.value}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      <ConsoleCard
        title={`${meta.title} catalog`}
        action={
          <button
            onClick={() => {
              setCreating(true)
              setEditing(null)
            }}
            className="flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-3.5 py-1.5 text-xs font-bold"
            data-testid={`cosmetic-new-${meta.navKey}`}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> New {meta.title.slice(0, -1)}
          </button>
        }
      >
        <p className="pb-3 -mt-1 text-[11px] text-white/35 leading-relaxed">{meta.blurb}</p>
        {rewards.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">
            No {meta.title.toLowerCase()} yet — create one, then assign it per realm place in the Realms screen.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rewards.map((row) => {
              const l1 = row.metadata.levels?.[1]
              const icon = assetSrc(l1) ?? (kind === 'NAME_DECORATOR' ? row.metadata.decorator?.left ?? meta.icon : kind === 'CHAT_BUBBLE' ? meta.icon : meta.icon)
              return (
                <div key={row.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <div className="w-11 h-11 shrink-0 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center overflow-hidden">
                    <AssetPreview value={icon} className="w-9 h-9" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold truncate">{row.name}</p>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${row.rarity === 'LEGENDARY' ? 'bg-amber-500/15 text-amber-300' : row.rarity === 'EPIC' ? 'bg-purple-500/15 text-purple-300' : row.rarity === 'RARE' ? 'bg-sky-500/15 text-sky-300' : 'bg-white/8 text-white/40'}`}>{row.rarity}</span>
                    </div>
                    <p className="text-[11px] text-white/35 truncate">
                      {kind === 'NAME_DECORATOR' && `${row.metadata.decorator?.left ?? '—'} · ${row.metadata.decorator?.right ?? '—'}`}
                      {kind === 'CHAT_BUBBLE' && (row.metadata.bubble?.color ?? '—')}
                      {(kind === 'PROFILE_FRAME' || kind === 'HAT') && levelsSummary(row.metadata.levels)}
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
                    <button onClick={() => remove(row)} className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-300" title={`Delete ${meta.title.slice(0, -1).toLowerCase()}`}>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ConsoleCard>

      {(creating || editing) && (
        <CosmeticEditor
          kind={kind}
          initial={editing}
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

function CosmeticEditor({
  kind,
  initial,
  onClose,
  onSaved,
}: {
  kind: CosmeticKind
  initial: RewardRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const meta = COSMETIC_KINDS.find((k) => k.kind === kind)!
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rarity, setRarity] = useState(initial?.rarity ?? 'COMMON')
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

  const usesLevels = kind === 'PROFILE_FRAME' || kind === 'HAT'

  const buildMetadata = (): Record<string, unknown> => {
    const base: Record<string, unknown> = {}
    if (usesLevels) base.levels = levels
    else if (initial?.metadata.levels) base.levels = initial.metadata.levels
    if (kind === 'NAME_DECORATOR') base.decorator = { left: decoratorLeft || undefined, right: decoratorRight || undefined }
    if (kind === 'CHAT_BUBBLE') base.bubble = { color: bubbleColor, border: bubbleBorder || undefined, textLight: bubbleTextLight }
    return base
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (usesLevels && !levels[1]) {
      toast.error('Level 1 needs a static asset (image or emoji)')
      return
    }
    if (kind === 'NAME_DECORATOR' && !decoratorLeft && !decoratorRight) {
      toast.error('Give at least one side decoration (emoji or image URL)')
      return
    }
    if (usesLevels && levels[3] && !('kind' in levels[3]) && levels[3].type === 'frames') {
      const urls = frameUrls.split('\n').map((u) => u.trim()).filter(isProbablyImageUrl)
      if (urls.length < 2) {
        toast.error('A frame sequence needs at least 2 image URLs')
        return
      }
      levels[3] = { type: 'frames', frameUrls: urls, fps: Math.max(1, Math.min(24, Math.floor(fps) || 10)), loop: true }
    }
    setSaving(true)
    try {
      const payload = { rewardType: kind, name: name.trim(), description: description.trim() || null, rarity, status: initial?.status ?? 'ACTIVE', metadata: buildMetadata() }
      if (initial) await api.admin.rewards.update(initial.id, payload)
      else await api.admin.rewards.create(payload)
      toast.success(initial ? 'Saved' : 'Created')
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

  const staticValue = (level: 1 | 2): string | null => {
    const asset = levels[level]
    return asset && 'kind' in asset ? (asset.kind === 'image' ? asset.url : asset.glyph) : null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0E121A] p-5">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/8">
          <h3 className="text-sm font-black flex items-center gap-2">
            <span aria-hidden>{meta.icon}</span>
            {initial ? `Edit ${meta.title.slice(0, -1)}` : `New ${meta.title.slice(0, -1)}`}
          </h3>
          <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/50"><X className="w-4 h-4" aria-hidden /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'PROFILE_FRAME' ? 'Golden Laurel Frame' : kind === 'HAT' ? 'Crown of Embers' : kind === 'NAME_DECORATOR' ? 'Royal Crown Icon' : 'Rose Chat Bubble'} className={`${inputCls} mt-1`} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Rarity</label>
            <select value={rarity} onChange={(e) => setRarity(e.target.value)} className={`${inputCls} mt-1`}>
              {RARITY_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown in the reward popup" className={`${inputCls} mt-1`} />
          </div>
        </div>

        {usesLevels && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/20 p-4">
            <p className="text-[11px] font-black uppercase tracking-wider text-white/40">Levels — L1/L2 static, L3 animated</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([1, 2] as const).map((lv) => (
                <div key={lv} className="flex flex-col gap-1.5">
                  <ImageUploader
                    label={`Level ${lv} · static (image or emoji)`}
                    value={staticValue(lv)}
                    onChange={(v) => setStaticLevel(lv, v)}
                    folder="cosmetics"
                    compact
                  />
                  <input
                    value={staticValue(lv) && !isProbablyImageUrl(staticValue(lv) ?? '') ? staticValue(lv) ?? '' : ''}
                    onChange={(e) => setStaticLevel(lv, e.target.value || null)}
                    placeholder="…or type an emoji, e.g. 👑"
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50"
                    aria-label={`Level ${lv} emoji`}
                  />
                </div>
              ))}
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
                  value={levels[3] && !('kind' in levels[3]) && levels[3].type === 'animated-image' ? levels[3].url : null}
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
                    <input type="number" min={1} max={24} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white" />
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

            <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/30 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Live preview</p>
              <div className="w-16 h-16 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
                <CosmeticAssetRender asset={levels[3] ?? levels[2] ?? levels[1]} className="w-14 h-14" />
              </div>
            </div>
          </div>
        )}

        {kind === 'NAME_DECORATOR' && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Left decoration (emoji or image URL)</label>
                <input value={decoratorLeft} onChange={(e) => setDecoratorLeft(e.target.value)} placeholder="👑" className={`${inputCls} mt-1`} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Right decoration</label>
                <input value={decoratorRight} onChange={(e) => setDecoratorRight(e.target.value)} placeholder="👑" className={`${inputCls} mt-1`} />
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-black/30 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-white/40 pb-2">Live preview</p>
              <div className="flex items-center gap-2">
                <AssetPreview value={decoratorLeft || null} className="w-6 h-6 text-lg" />
                <span className="text-sm font-black text-white">PlayerName</span>
                <AssetPreview value={decoratorRight || null} className="w-6 h-6 text-lg" />
              </div>
            </div>
          </div>
        )}

        {kind === 'CHAT_BUBBLE' && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
            <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-black/20 p-3">
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
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-white/8">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-xs font-bold text-white/50 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-5 py-2 text-xs font-bold disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" aria-hidden /> {saving ? 'Saving…' : initial ? 'Save changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
