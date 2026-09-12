'use client'

// Quicky — PlayerInteractionSheet (v3 PRD §40-§46, §55-§59, §81-§85)
// A lightweight, contextual interaction panel for a table player — NOT a
// full profile page:
//   • MOBILE (<1024px): bottom sheet, safe-area aware (§81); the gift section
//     scrolls independently so the room never scrolls by accident (§82).
//   • DESKTOP (≥1024px): anchored popover positioned from the clicked card's
//     real bounding rect (§84 — no hardcoded top/left), flipping above the
//     card when there is no room below (§83).
// Content: photo + name → Tag / Message / Profile actions (§42-§45) →
// SEND A GIFT catalog, DB-DRIVEN (§47: categories + gifts from the backend,
// nothing hardcoded), select → confirm Send (§57/§58), insufficient balance
// → "Not enough coins" + Buy Coins (§55).

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Tag, MessageCircle, User, Send, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'

export type CatalogGift = {
  id: string
  categoryId: string | null
  name: string
  icon: string
  priceCoins: number
  tier?: string
}

export type CatalogCategory = { id: string; name: string; slug: string; icon: string; sortOrder: number }

// v3 §71 — gift definitions change rarely: cache the catalog client-side for
// the session. The SERVER still validates price/active state on every send.
let catalogCache: { categories: CatalogCategory[]; gifts: CatalogGift[] } | null = null

export type InteractionPlayer = {
  userId: string
  displayName: string
  avatar: string | null
  isMe?: boolean
}

type Props = {
  player: InteractionPlayer | null
  /** 'sheet' (mobile) | 'popover' (desktop, anchored to the card). */
  mode: 'sheet' | 'popover'
  /** The clicked card's rect (viewport coords) + the stage rect, for §84. */
  anchor?: { card: DOMRect; stage: DOMRect } | null
  coinBalance: number
  onClose: () => void
  onTag?: (p: InteractionPlayer) => void
  onMessage?: (p: InteractionPlayer) => void
  onProfile?: (p: InteractionPlayer) => void
  onBuyCoins: () => void
  /** Parent performs the optimistic coin move + API call; resolves false on failure. */
  onSendGift: (recipientId: string, gift: CatalogGift) => Promise<boolean>
}

const POPOVER_W = 300
const POPOVER_EST_H = 430

export function PlayerInteractionSheet({
  player,
  mode,
  anchor,
  coinBalance,
  onClose,
  onTag,
  onMessage,
  onProfile,
  onBuyCoins,
  onSendGift,
}: Props) {
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [gifts, setGifts] = useState<CatalogGift[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogGift | null>(null)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(null)
    if (!player) return
    void (async () => {
      if (catalogCache) {
        setCategories(catalogCache.categories)
        setGifts(catalogCache.gifts)
        return
      }
      setLoading(true)
      try {
        const res = await api.spinBottle.gifts.catalog()
        const next = { categories: res.categories ?? [], gifts: (res.catalog ?? []) as CatalogGift[] }
        catalogCache = next
        setCategories(next.categories)
        setGifts(next.gifts)
      } catch {
        toast.error('Could not load gifts')
      } finally {
        setLoading(false)
      }
    })()
  }, [player?.userId])

  // Group by category in the DB's sort order (§46: [ Popular ] … [ Cute ] …)
  const grouped = useMemo(() => {
    const byCat = new Map<string, CatalogGift[]>()
    for (const g of gifts) {
      const key = g.categoryId ?? '_other'
      if (!byCat.has(key)) byCat.set(key, [])
      byCat.get(key)!.push(g)
    }
    const orderedCats = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
    const groups: { key: string; name: string; icon: string; gifts: CatalogGift[] }[] = []
    for (const c of orderedCats) {
      const list = byCat.get(c.id)
      if (list?.length) groups.push({ key: c.id, name: c.name, icon: c.icon, gifts: list })
    }
    const orphan = byCat.get('_other')
    if (orphan?.length) groups.push({ key: '_other', name: 'More', icon: '🎁', gifts: orphan })
    return groups
  }, [categories, gifts])

  const send = async () => {
    if (!player || !selected || sending) return
    setSending(true)
    try {
      const ok = await onSendGift(player.userId, selected)
      if (ok) {
        toast.success(`${selected.icon} ${selected.name} sent to ${player.displayName}`)
        setSelected(null)
        onClose()
      }
    } finally {
      setSending(false)
    }
  }

  const popoverStyle = useMemo<React.CSSProperties | null>(() => {
    if (mode !== 'popover' || !anchor || !player) return null
    const { card, stage } = anchor
    // Horizontal: clamp so the popover never leaves the stage (§84)
    const leftRaw = card.left + card.width / 2 - stage.left - POPOVER_W / 2
    const left = Math.max(8, Math.min(leftRaw, stage.width - POPOVER_W - 8))
    // Vertical: prefer below the card, flip above when insufficient space (§83)
    const belowSpace = stage.bottom - card.bottom
    if (belowSpace >= Math.min(POPOVER_EST_H, 240)) {
      return { left, top: card.bottom - stage.top + 10, width: POPOVER_W }
    }
    return { left, bottom: stage.bottom - card.top + 10, width: POPOVER_W }
  }, [mode, anchor, player])

  const insufficient = !!selected && selected.priceCoins > coinBalance

  const body = player ? (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden bg-white/10 border border-white/15 shrink-0">
          {player.avatar ? (
            <img src={player.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-lg font-black">
              {(player.displayName ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{player.displayName}</p>
          <p className="text-[11px] text-white/45">At your table</p>
        </div>
        <button className="ml-auto p-2 rounded-full hover:bg-white/10" onClick={onClose} aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Top actions (§42) — icon + label rows */}
      <div className="grid grid-cols-3 gap-2">
        <button className="sbr-ix-action" onClick={() => onTag?.(player)}>
          <Tag className="w-4 h-4" />
          <span>Tag</span>
        </button>
        <button className="sbr-ix-action" onClick={() => onMessage?.(player)}>
          <MessageCircle className="w-4 h-4" />
          <span>Message</span>
        </button>
        <button className="sbr-ix-action" onClick={() => onProfile?.(player)}>
          <User className="w-4 h-4" />
          <span>Profile</span>
        </button>
      </div>

      {/* Gift catalog (§46) — independently scrollable (§82) */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Send a gift</p>
        <p className="text-[11px] text-white/60 font-semibold tabular-nums">🪙 {coinBalance.toLocaleString('en-US')}</p>
      </div>
      <div ref={listRef} className="sbr-ix-gifts">
        {loading ? (
          <p className="text-xs text-white/40 text-center py-6">Loading gifts…</p>
        ) : grouped.length === 0 ? (
          <p className="text-xs text-white/40 text-center py-6">No gifts available yet</p>
        ) : (
          grouped.map((group) => (
            <div key={group.key} className="mb-2">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-wide mb-1.5">
                {group.icon} {group.name}
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {group.gifts.map((g) => {
                  const affordable = g.priceCoins <= coinBalance
                  const isSel = selected?.id === g.id
                  return (
                    <button
                      key={g.id}
                      onClick={() => setSelected(isSel ? null : g)}
                      className={`sbr-ix-gift ${isSel ? 'sbr-ix-gift-sel' : ''}${affordable ? '' : ' sbr-ix-gift-poor'}`}
                      title={`${g.name} — ${g.priceCoins} coins`}
                    >
                      <span className="text-lg leading-none" aria-hidden>{g.icon}</span>
                      <span className="text-[9px] font-bold truncate w-full">{g.name}</span>
                      <span className="text-[9px] text-amber-300/90 font-semibold tabular-nums">🪙 {g.priceCoins}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Selection → confirm (§57/§58) or Not enough coins → Buy Coins (§55) */}
      {selected ? (
        insufficient ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-rose-300 text-center">
              Not enough coins for {selected.icon} {selected.name} (🪙 {selected.priceCoins})
            </p>
            <button className="sbr-sheet-btn-stay w-full justify-center" onClick={onBuyCoins}>
              <ShoppingBag className="w-4 h-4" /> Buy Coins
            </button>
          </div>
        ) : (
          <button className="sbr-ix-send w-full justify-center" onClick={send} disabled={sending}>
            <Send className="w-4 h-4" />
            {sending ? 'Sending…' : `Send ${selected.icon} ${selected.name} — 🪙 ${selected.priceCoins}`}
          </button>
        )
      ) : (
        <p className="text-[11px] text-white/40 text-center">Pick a gift, then confirm — no accidental spends.</p>
      )}
    </div>
  ) : null

  return (
    <AnimatePresence>
      {player && mode === 'sheet' && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[190] bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="sbr-sheet fixed inset-x-0 bottom-0 z-[191] mx-auto max-w-md p-4 sbr-sheet-safe"
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-white/20 mb-3" />
            {body}
          </motion.div>
        </>
      )}
      {player && mode === 'popover' && popoverStyle && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 340, damping: 26 }}
          className="sbr-sheet sbr-ix-popover absolute z-[191] p-3.5 rounded-2xl"
          style={popoverStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
