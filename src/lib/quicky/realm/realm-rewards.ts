// Quicky — REALM REWARDS (realm PRD §37-§39, §53, §59, §82)
//
// Per-place reward configuration for each realm, SNAPSHOTTED into the cycle
// at creation (§39). Rewards reference items from the EXISTING GameItem
// catalog and are granted through the EXISTING UserItem inventory — never a
// second inventory system (§82).
//
// Place limits (§53): 1st ≤ 5 items, 2nd ≤ 3 items, 3rd ≤ 1 item.

import { db } from '@/lib/db'

export type RewardItem = { itemId: string; quantity: number }
export type RewardsConfig = { first: RewardItem[]; second: RewardItem[]; third: RewardItem[] }

/** Consolation coin gifts for cohort places 4-8 (config per realm, admin-editable).
 *  Keys are the PLACE numbers — { "4": 50, "5": 30, "6": 20, "7": 10, "8": 5 }. */
export type ConsolationCoinsConfig = { '4': number; '5': number; '6': number; '7': number; '8': number }

export const CONSOLATION_PLACES = [4, 5, 6, 7, 8] as const
export const CONSOLATION_PLACE_LIMIT = 100_000
export const DEFAULT_CONSOLATION_COINS: ConsolationCoinsConfig = { 4: 50, 5: 30, 6: 20, 7: 10, 8: 5 }

export const REWARD_LIMITS = { first: 5, second: 3, third: 1 } as const
const MAX_ITEM_QTY = 1000

export function parseRewardsConfig(json: string | null | undefined): RewardsConfig {
  const empty: RewardsConfig = { first: [], second: [], third: [] }
  if (!json) return empty
  try {
    const raw = JSON.parse(json) as Partial<Record<'first' | 'second' | 'third', RewardItem[]>>
    const clean = (list: RewardItem[] | undefined, limit: number): RewardItem[] =>
      Array.isArray(list)
        ? list
            .filter((it) => it && typeof it.itemId === 'string' && Number.isInteger(Number(it.quantity)) && Number(it.quantity) > 0 && Number(it.quantity) <= MAX_ITEM_QTY)
            .slice(0, limit)
            .map((it) => ({ itemId: String(it.itemId), quantity: Math.floor(Number(it.quantity)) }))
        : []
    return {
      first: clean(raw.first, REWARD_LIMITS.first),
      second: clean(raw.second, REWARD_LIMITS.second),
      third: clean(raw.third, REWARD_LIMITS.third),
    }
  } catch {
    return empty
  }
}

/** Parse the consolation-coins block from a rewards JSON (positions 4-8,
 *  clamped 0..100000; missing places → 0). Returns null when absent. */
export function parseConsolationCoins(json: string | null | undefined): ConsolationCoinsConfig | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as { consolationCoins?: Record<string, unknown> }
    if (!raw?.consolationCoins || typeof raw.consolationCoins !== 'object') return null
    const out = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 } as ConsolationCoinsConfig
    let any = false
    for (const place of CONSOLATION_PLACES) {
      const v = Number(raw.consolationCoins[String(place)])
      if (Number.isFinite(v) && v > 0) {
        out[place] = Math.min(CONSOLATION_PLACE_LIMIT, Math.floor(v))
        any = true
      }
    }
    return any ? out : null
  } catch {
    return null
  }
}

/** Extract ONLY the consolation block (for merging into a snapshot without
 *  trusting the rest of an admin payload). */
function sanitizeConsolation(input: unknown): ConsolationCoinsConfig {
  const out = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 } as ConsolationCoinsConfig
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>
  for (const place of CONSOLATION_PLACES) {
    const v = Number(raw[String(place)])
    if (Number.isInteger(v) && v >= 0 && v <= CONSOLATION_PLACE_LIMIT) out[place] = v
  }
  return out
}

/**
 * Validate + serialize an admin-submitted rewards config. Returns an error
 * message on limit violations (shown directly in the admin screen). Accepts
 * the legacy per-place items AND the consolationCoins block (4th-8th places).
 */
export function validateRewardsConfig(input: unknown): { ok: true; json: string } | { ok: false; message: string } {
  if (input == null) return { ok: true, json: JSON.stringify({ first: [], second: [], third: [] }) }
  if (typeof input !== 'object') return { ok: false, message: 'Rewards must be an object.' }
  const raw = input as Record<string, unknown>

  const places: ['first' | 'second' | 'third', number][] = [
    ['first', REWARD_LIMITS.first],
    ['second', REWARD_LIMITS.second],
    ['third', REWARD_LIMITS.third],
  ]
  const out: RewardsConfig = { first: [], second: [], third: [] }
  for (const [place, limit] of places) {
    const list = raw[place]
    if (list == null) continue
    if (!Array.isArray(list)) return { ok: false, message: `Rewards "${place}" must be a list.` }
    if (list.length > limit) return { ok: false, message: `${place === 'first' ? '1st' : place === 'second' ? '2nd' : '3rd'} place allows at most ${limit} reward item${limit > 1 ? 's' : ''}.` }
    const items: RewardItem[] = []
    for (const it of list) {
      const itemId = typeof it === 'object' && it ? (it as RewardItem).itemId : null
      const quantity = Number(typeof it === 'object' && it ? (it as RewardItem).quantity : NaN)
      if (typeof itemId !== 'string' || !itemId) return { ok: false, message: 'Every reward needs a valid item.' }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QTY) {
        return { ok: false, message: 'Reward quantities must be whole numbers between 1 and 1000.' }
      }
      items.push({ itemId, quantity })
    }
    out[place] = items
  }
  return { ok: true, json: JSON.stringify({ ...out, consolationCoins: sanitizeConsolation(raw.consolationCoins) }) }
}

/**
 * Grant reward items through the EXISTING inventory (§82): UserItem rows
 * are upserted with an atomic quantity increment. Settlement idempotency is
 * guaranteed upstream (RealmRewardClaim unique key gates the call).
 */
export async function grantRewardItems(userId: string, items: RewardItem[]): Promise<void> {
  for (const it of items) {
    // Ignore rows that vanished from the catalog — settlement must never
    // crash because an admin deleted a reward item mid-cycle.
    const exists = await db.gameItem.findUnique({ where: { id: it.itemId }, select: { id: true } }).catch(() => null)
    if (!exists) continue
    await db.userItem
      .upsert({
        where: { userId_itemId: { userId, itemId: it.itemId } },
        create: { userId, itemId: it.itemId, quantity: it.quantity },
        update: { quantity: { increment: it.quantity } },
      })
      .catch(() => {})
  }
}
