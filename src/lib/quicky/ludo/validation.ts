// Quicky — LUDO VALIDATION (Ludo PRD §47/§105/§106)
//
// Server-side request-shape validation for the move route (the ONLY client
// action — ROUND-4: the dice are a server action, there is no roll request
// at all). SECURITY (§105/§106): the client sends ONLY { tokenId, actionId }
// — never a dice value, never a position, never a winner. Every gameplay
// fact is recomputed from the authoritative DB state here.

import type { LudoEngineError } from './types'

export type MoveRequestInput = { tokenId: string; actionId: string }

export function parseUuidLike(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  // actionId is client-generated; accept any reasonable id token (uuid,
  // cuid, nanoid…) but never an empty/garbage string.
  return v.length >= 8 && v.length <= 64 && /^[\w:-]+$/.test(v) ? v : null
}

export function parseMoveRequest(body: unknown): (MoveRequestInput & { tokenId: string }) | null {
  if (typeof body !== 'object' || body == null) return null
  const rec = body as Record<string, unknown>
  const actionId = parseUuidLike(rec.actionId)
  const tokenId = typeof rec.tokenId === 'string' && /^[a-z]+-[1-4]$/.test(rec.tokenId) ? rec.tokenId : null
  return actionId && tokenId ? { tokenId, actionId } : null
}

/** HTTP status per engine error — 401/403/409/410 keep clients honest. */
export function statusForEngineError(error: LudoEngineError): number {
  switch (error) {
    case 'game_not_playing':
      return 409
    case 'not_your_turn':
      return 403
    case 'dice_pending':
    case 'no_dice':
    case 'illegal_move':
      return 409
    case 'unknown_token':
    case 'not_your_token':
      return 403
    case 'unknown_player':
      return 403
    default:
      return 400
  }
}
