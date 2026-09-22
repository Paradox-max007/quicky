'use client'

// Quicky — GIFT ICON (gifting-revision: PNG icons)
//
// ONE renderer for every gift glyph in the app — the DB catalog rows carry
// either an EMOJI (iconType "emoji") or an IMAGE payload (iconType "image"
// / "png" — admin-set PNG/webp URL in iconValue, resolved by the catalog
// GET into `icon`). Emoji and PNG gifts are indistinguishable to callers:
// same size contract, same class hooks.
//
// Used by: PlayerInteractionSheet catalog, GiftSheet grid, GiftBackSheet,
// the room-chat gift cards, GameGiftAlert / chat-panel drawers and the
// GiftFlyLayer fly animation.

import { cn } from '@/lib/utils'

export function GiftIcon({
  icon,
  iconType,
  className,
  imgClassName,
  alt,
}: {
  /** Resolved display payload — the image URL for image icons, the emoji glyph otherwise. */
  icon: string | null | undefined
  /** Catalog/broadcast iconType — 'image' | 'png' | 'emoji' (optional: emoji fallback). */
  iconType?: string | null
  /** Wrapper sizing classes (both variants). */
  className?: string
  /** Extra classes applied to the <img> only (object-fit etc.). */
  imgClassName?: string
  alt?: string
}) {
  const isImage =
    !!icon && (iconType === 'image' || iconType === 'png' || /^(https?:\/\/|data:image\/|\/)/i.test(icon))
  if (!icon) return null
  if (isImage) {
    return (
      <span className={cn('inline-flex items-center justify-center', className)} aria-hidden>
        <img
          src={icon}
          alt={alt ?? ''}
          draggable={false}
          loading="eager"
          className={cn('w-full h-full object-contain pointer-events-none select-none', imgClassName)}
        />
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center justify-center leading-none', className)} aria-hidden>
      {icon}
    </span>
  )
}
