// Quicky — REALM REWARDS CONFIG (realm PRD §37-§39, §53, §59, §82)
//
// Per-realm reward configuration blocks. The WIN-reward set itself is the
// unified catalog system (RealmRewardRule → UserRewardGrant popup — see
// lib/quicky/rewards/catalog.ts); this module owns the CONSOLE-side config
// that still lives on the realm definition: the consolation-coins block for
// places 4-8, snapshotted into the cycle at creation (§39).
//
// Place limits (§53): 1st ≤ 5 items, 2nd ≤ 3 items, 3rd ≤ 1 item.

/** Consolation coin gifts for cohort places 4-8 (config per realm, admin-editable).
 *  Keys are the PLACE numbers — { "4": 50, "5": 30, "6": 20, "7": 10, "8": 5 }. */
export type ConsolationCoinsConfig = { '4': number; '5': number; '6': number; '7': number; '8': number }

export const CONSOLATION_PLACES = [4, 5, 6, 7, 8] as const
export const CONSOLATION_PLACE_LIMIT = 100_000
export const DEFAULT_CONSOLATION_COINS: ConsolationCoinsConfig = { 4: 50, 5: 30, 6: 20, 7: 10, 8: 5 }

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
 * Validate + serialize the admin-submitted realm rewards JSON. Only the
 * consolation block (places 4-8) is editable on the realm definition now —
 * the WIN-reward set lives in RealmRewardRule (ONE system). Legacy
 * first/second/third gift-item lists are dropped on save, clearing them.
 */
export function validateRewardsConfig(input: unknown): { ok: true; json: string } | { ok: false; message: string } {
  if (input != null && typeof input !== 'object') return { ok: false, message: 'Rewards must be an object.' }
  const raw = (input ?? {}) as Record<string, unknown>
  return { ok: true, json: JSON.stringify({ first: [], second: [], third: [], consolationCoins: sanitizeConsolation(raw.consolationCoins) }) }
}
