'use client'

// Quicky — COSMETIC RENDERERS (admin-console PRD §8.2/§9)
//
// Shared rendering for equipped profile cosmetics across the user app
// (web + Capacitor):
//   · CosmeticAvatar  — avatar + PROFILE_FRAME ring overlay + HAT overlay
//   · NameDecorators  — NAME_DECORATOR glyphs/images on both sides of a name
//   · chatBubbleStyle — CHAT_BUBBLE color/border/text/bubble-frame styling
//   · CosmeticAsset   — any level asset (level 3 animated: GIF/WebP plays
//     natively; frame sequences cycle at their configured fps) — real
//     animation assets, never CSS-only effects (§9.2).
//
// Level assets load asynchronously; a static fallback is shown while an
// animated asset is unavailable (§9 animation requirements).

import { useEffect, useState } from 'react'
import type { LevelAsset, CosmeticAnimation, CosmeticItem } from '@/store/rewards'

export type EquippedCosmetic = Pick<CosmeticItem, 'rewardType' | 'level' | 'levelAsset' | 'decorator' | 'bubble'> & { name?: string }

type AnyAsset = LevelAsset | CosmeticAnimation | null | undefined

export function isImageUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) || v.startsWith('/uploads/') || v.startsWith('data:image/')
}

/** Frame-sequence player — cycles frames at the configured fps (§9.2). */
function FrameSequence({ asset, className }: { asset: Extract<CosmeticAnimation, { type: 'frames' }>; className?: string }) {
  const [frame, setFrame] = useState(0)
  const fps = Math.max(1, Math.min(24, Math.floor(asset.fps) || 10))
  useEffect(() => {
    if (asset.frameUrls.length < 2) return
    const id = setInterval(() => setFrame((f) => (f + 1) % asset.frameUrls.length), 1000 / fps)
    return () => clearInterval(id)
  }, [asset.frameUrls.length, fps])
  const url = asset.frameUrls[Math.min(frame, asset.frameUrls.length - 1)]
  if (!url) return null
   
  return <img src={url} alt="" className={className} aria-hidden />
}

/** Renders ANY cosmetic level asset (static / animated image / frames). */
export function CosmeticAsset({ asset, className, fallback }: { asset: AnyAsset; className?: string; fallback?: string }) {
  if (!asset) return fallback ? <span className={className} aria-hidden>{fallback}</span> : null
  if ('type' in asset && asset.type === 'frames') return <FrameSequence asset={asset} className={className} />
  const src = 'kind' in asset ? (asset.kind === 'image' ? asset.url : asset.glyph) : asset.type === 'animated-image' ? asset.url : null
  if (!src) return fallback ? <span className={className} aria-hidden>{fallback}</span> : null
  if (isImageUrl(src)) {
     
    return <img src={src} alt="" className={className} aria-hidden />
  }
  return <span className={className} aria-hidden>{src}</span>
}

/** Find the equipped cosmetic of one type (one equipped per type, §8.2). */
export function cosmeticOf(cosmetics: EquippedCosmetic[] | null | undefined, type: string): EquippedCosmetic | null {
  if (!cosmetics) return null
  return cosmetics.find((c) => c.rewardType === type) ?? null
}

/**
 * Avatar + equipped frame + hat. Sizes map the common avatar sizes used
 * across the app; the frame ring scales around the avatar, the hat floats
 * above it.
 */
export function CosmeticAvatar({
  src,
  name,
  cosmetics,
  size = 'md',
  className,
}: {
  src: string | null | undefined
  name?: string
  cosmetics: EquippedCosmetic[] | null | undefined
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dims = { xs: 'w-7 h-7', sm: 'w-10 h-10', md: 'w-14 h-14', lg: 'w-20 h-20' }[size]
  const frame = cosmeticOf(cosmetics, 'PROFILE_FRAME')
  const hat = cosmeticOf(cosmetics, 'HAT')

  return (
    <span className={`relative inline-flex items-center justify-center ${className ?? ''}`}>
      {/* Frame ring (level asset image spans the full box; the avatar sits
          inset so the frame art surrounds it). */}
      {frame?.levelAsset && (
        <CosmeticAsset asset={frame.levelAsset} className="pointer-events-none absolute inset-0 w-full h-full object-contain z-[1]" />
      )}
      {src ? (
         
        <img src={src} alt={name ?? 'avatar'} className={`${dims} ${frame?.levelAsset ? 'scale-[0.82]' : ''} rounded-full object-cover`} />
      ) : (
        <span className={`${dims} rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-base`} aria-hidden>👤</span>
      )}
      {/* Hat overlay — floats above the avatar's top edge. */}
      {hat?.levelAsset && (
        <CosmeticAsset asset={hat.levelAsset} className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-1/2 h-auto z-[2] -top-[30%]" />
      )}
    </span>
  )
}

/** Decoration glyph/image for one side of a name. */
function SideDecoration({ value, className }: { value: string | undefined; className?: string }) {
  if (!value) return null
  if (isImageUrl(value)) {
     
    return <img src={value} alt="" className={`h-[1em] w-auto object-contain align-[-0.1em] ${className ?? ''}`} aria-hidden />
  }
  return <span className={className} aria-hidden>{value}</span>
}

/**
 * A display name with the equipped NAME_DECORATOR on both sides
 * (admin-console PRD §20: "Name decorators appear on both sides of the
 * supported display name").
 */
export function NameDecorators({
  name,
  cosmetics,
  className,
}: {
  name: string
  cosmetics: EquippedCosmetic[] | null | undefined
  className?: string
}) {
  const decorator = cosmeticOf(cosmetics, 'NAME_DECORATOR')
  const left = decorator?.decorator?.left
  const right = decorator?.decorator?.right
  if (!left && !right) return <span className={className}>{name}</span>
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${className ?? ''}`}>
      <SideDecoration value={left} />
      <span className="truncate">{name}</span>
      <SideDecoration value={right ?? left} />
    </span>
  )
}

/**
 * Inline style for a chat bubble with the equipped CHAT_BUBBLE cosmetics
 * (color + border + light/dark text + optional bubble frame image handled by
 * the caller).
 */
export function chatBubbleStyle(cosmetics: EquippedCosmetic[] | null | undefined): React.CSSProperties | undefined {
  const bubble = cosmeticOf(cosmetics, 'CHAT_BUBBLE')?.bubble
  if (!bubble?.color) return undefined
  const style: React.CSSProperties = { backgroundColor: bubble.color }
  if (bubble.border) {
    style.border = `1px solid ${bubble.border}`
  }
  if (bubble.textLight !== undefined) {
    style.color = bubble.textLight ? '#ffffff' : '#15141e'
  }
  return style
}

/** Optional bubble frame image (rendered around a styled bubble). */
export function ChatBubbleFrame({ cosmetics, children }: { cosmetics: EquippedCosmetic[] | null | undefined; children: React.ReactNode }) {
  const frameUrl = cosmeticOf(cosmetics, 'CHAT_BUBBLE')?.bubble?.frameUrl
  if (!frameUrl) return <>{children}</>
  return (
    <span className="relative inline-flex">
      {children}
      { }
      <img src={frameUrl} alt="" className="pointer-events-none absolute -inset-1.5 w-[calc(100%+12px)] h-[calc(100%+12px)] object-fill z-[1]" aria-hidden />
    </span>
  )
}
