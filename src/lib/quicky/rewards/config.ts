// Quicky — REWARDED-AD CONFIGURATION (Monetization PRD §3.3 / §9.1)
//
// Reward settings live in the AdminSetting KV store (admin-console editable)
// with safe, validated defaults. The approved reward range is 10–100 — the
// admin can narrow it but never widen it (PRD §9.1: "within the approved
// 10–100 range"). Timezones: everything is stored in UTC; `timezone` only
// defines when the "daily" window rolls over (PRD §3.3).

import { db } from '@/lib/db'

export const REWARD_MIN_FLOOR = 10
export const REWARD_MAX_CEILING = 100

export type RewardAdConfig = {
  enabled: boolean
  coinsEnabled: boolean
  pointsEnabled: boolean
  minReward: number // >= 10
  maxReward: number // <= 100, >= minReward
  dailyLimit: number // rewarded ads per user per day
  cooldownSeconds: number // minimum interval between ad STARTS
  timezone: string // IANA zone for the daily window (default UTC)
}

export const DEFAULT_REWARD_CONFIG: RewardAdConfig = {
  enabled: true,
  coinsEnabled: true,
  pointsEnabled: true,
  minReward: REWARD_MIN_FLOOR,
  maxReward: REWARD_MAX_CEILING,
  dailyLimit: 10,
  cooldownSeconds: 30,
  timezone: 'UTC',
}

const KEYS = {
  enabled: 'rewards.ads.enabled',
  coinsEnabled: 'rewards.ads.coinsEnabled',
  pointsEnabled: 'rewards.ads.pointsEnabled',
  minReward: 'rewards.ads.minReward',
  maxReward: 'rewards.ads.maxReward',
  dailyLimit: 'rewards.ads.dailyLimit',
  cooldownSeconds: 'rewards.ads.cooldownSeconds',
  timezone: 'rewards.ads.timezone',
} as const

export const REWARD_SETTING_KEYS = Object.values(KEYS)

/** Validated + clamped view of whatever is (or isn't) in AdminSetting. */
export async function getRewardAdConfig(): Promise<RewardAdConfig> {
  const rows = await db.adminSetting
    .findMany({ where: { key: { in: REWARD_SETTING_KEYS } } })
    .catch(() => [] as { key: string; value: string }[])
  const byKey = new Map<string, string>(rows.map((r) => [r.key, r.value] as [string, string]))

  const bool = (k: string, dflt: boolean) => {
    const v = byKey.get(k)
    return v === undefined || v === '' ? dflt : v === 'true'
  }
  const num = (k: string, dflt: number) => {
    const v = Number(byKey.get(k))
    return Number.isFinite(v) && v > 0 ? v : dflt
  }

  let min = Math.max(REWARD_MIN_FLOOR, Math.min(REWARD_MAX_CEILING, Math.trunc(num(KEYS.minReward, REWARD_MIN_FLOOR))))
  let max = Math.max(REWARD_MIN_FLOOR, Math.min(REWARD_MAX_CEILING, Math.trunc(num(KEYS.maxReward, REWARD_MAX_CEILING))))
  if (min > max) [min, max] = [max, min]

  let tz = String(byKey.get(KEYS.timezone) ?? 'UTC').trim() || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    tz = 'UTC'
  }

  return {
    enabled: bool(KEYS.enabled, DEFAULT_REWARD_CONFIG.enabled),
    coinsEnabled: bool(KEYS.coinsEnabled, DEFAULT_REWARD_CONFIG.coinsEnabled),
    pointsEnabled: bool(KEYS.pointsEnabled, DEFAULT_REWARD_CONFIG.pointsEnabled),
    minReward: min,
    maxReward: max,
    dailyLimit: Math.min(100, Math.max(1, Math.trunc(num(KEYS.dailyLimit, DEFAULT_REWARD_CONFIG.dailyLimit)))),
    cooldownSeconds: Math.min(3600, Math.max(5, Math.trunc(num(KEYS.cooldownSeconds, DEFAULT_REWARD_CONFIG.cooldownSeconds)))),
    timezone: tz,
  }
}

/** Clamp an admin-proposed value to the schema-legal range (used by the admin route). */
export function clampRewardSetting(key: string, value: number): number | null {
  switch (key) {
    case KEYS.minReward:
      return Math.max(REWARD_MIN_FLOOR, Math.min(REWARD_MAX_CEILING, Math.trunc(value)))
    case KEYS.maxReward:
      return Math.max(REWARD_MIN_FLOOR, Math.min(REWARD_MAX_CEILING, Math.trunc(value)))
    case KEYS.dailyLimit:
      return Math.max(1, Math.min(100, Math.trunc(value)))
    case KEYS.cooldownSeconds:
      return Math.max(5, Math.min(3600, Math.trunc(value)))
    default:
      return null
  }
}

export { KEYS as REWARD_SETTING_KEY_NAMES }

// ─── Providers (PRD §4) ─────────────────────────────────────────────────────

export type RewardProviderKind = 'admob' | 'web_ad' | 'mock'

/**
 * Is the DEV demo provider allowed? The PRD forbids fake ads in production
 * ("Do not show a fake countdown, fake video, or simulated ad as a
 * production reward mechanism") — this env gate exists so local development
 * and staging demos keep working while production stays honest.
 */
export function mockRewardedAdsAllowed(): boolean {
  if (process.env.ALLOW_MOCK_REWARDED_ADS === 'true') return true
  if (process.env.ALLOW_MOCK_REWARDED_ADS === 'false') return false
  return process.env.NODE_ENV === 'development'
}

/** Which rewarded-ad provider serves a given platform, if any (PRD §4.1/§4.2). */
export function resolveRewardProvider(platform: 'web' | 'android' | 'ios'): RewardProviderKind | null {
  if (platform === 'android' || platform === 'ios') {
    const androidUnit = process.env.ADMOB_REWARDED_AD_UNIT_ID_ANDROID
    const iosUnit = process.env.ADMOB_REWARDED_AD_UNIT_ID_IOS ?? process.env.ADMOB_REWARDED_AD_UNIT_ID_ANDROID
    const unit = platform === 'android' ? androidUnit : iosUnit
    if (unit) return 'admob'
  } else if (platform === 'web') {
    if (process.env.WEB_REWARDED_AD_PROVIDER && process.env.WEB_REWARDED_AD_UNIT_ID) return 'web_ad'
  }
  // Nothing configured → the only fallback is the (env-gated) dev demo.
  return mockRewardedAdsAllowed() ? 'mock' : null
}
