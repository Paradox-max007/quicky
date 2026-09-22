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

/**
 * Validate + serialize an admin-submitted rewards config. Returns an error
 * message on limit violations (shown directly in the admin screen).
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
  return { ok: true, json: JSON.stringify(out) }
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
