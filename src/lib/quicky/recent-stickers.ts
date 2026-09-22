// Quicky — recently-used stickers (client-side memory shared by every chat
// surface: game chat, room chat (spin bottle + ludo) and dating personal
// chat — web AND Capacitor, since both run the same React tree).
//
// Recency is a pure UI affordance: it lives in localStorage next to the
// device, needs no server round-trip and never gates what a user can send
// (ownership is always re-validated server-side at send time). Entries keep
// the {id, name, assetUrl} triple so the picker can render them without
// waiting for the catalog.

const KEY = 'qk-recent-stickers-v1'
export const RECENT_STICKERS_MAX = 20

export type RecentSticker = { id: string; name: string; assetUrl: string }

function safeParse(raw: string | null): RecentSticker[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (x): x is RecentSticker =>
          !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.assetUrl === 'string'
      )
      .slice(0, RECENT_STICKERS_MAX)
  } catch {
    return []
  }
}

/** Most-recent-first list of stickers the user has sent from this device. */
export function getRecentStickers(): RecentSticker[] {
  if (typeof window === 'undefined') return []
  return safeParse(window.localStorage.getItem(KEY))
}

/** Records a send: moves the sticker to the front, de-dupes, caps the list. */
export function pushRecentSticker(sticker: RecentSticker): RecentSticker[] {
  if (typeof window === 'undefined') return []
  const id = sticker.id?.trim()
  if (!id) return safeParse(window.localStorage.getItem(KEY))
  const next = [
    { id, name: sticker.name || 'Sticker', assetUrl: sticker.assetUrl || '' },
    ...getRecentStickers().filter((s) => s.id !== id),
  ].slice(0, RECENT_STICKERS_MAX)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // private mode / quota — recency is best-effort, never fatal
  }
  return next
}

/** Test hook. */
export function clearRecentStickers(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
