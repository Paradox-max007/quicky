// Quicky — REWARD SESSION SERVICE (Monetization PRD §3 / §6.2 / §7.1)
//
// Server-authoritative rewarded-ad lifecycle:
//   createSession()   — eligibility (daily limit, cooldown, one concurrent
//                       pending session) → unpredictable session id
//   finalizeReward()  — the ONLY place a reward is rolled and credited.
//                       Amount: crypto-secure random int in [min,max],
//                       generated ONCE, stored on the session — a retried
//                       callback returns the existing result (PRD §3.2).
//
// The client never sends an amount. Provider completion is only accepted
// through verifyAdMobSsv() / the signed web callback / the env-gated dev
// provider.

import crypto from 'crypto'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { getRewardAdConfig, resolveRewardProvider, type RewardAdConfig, type RewardProviderKind } from './config'
import { creditCoins, creditRealmPoints } from '@/lib/quicky/wallet'

export const SESSION_TTL_MS = 10 * 60 * 1000 // a pending ad session is valid for 10 minutes

export type RewardType = 'COINS' | 'REALM_POINTS'

export type SessionStatusDTO = {
  sessionId: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
  rewardType: RewardType
  provider: RewardProviderKind
  rewardAmount: number | null // null until COMPLETED
  coinBalance: number | null
  cyclePoints: number | null
  createdAt: string
  expiresAt: string
  completedAt: string | null
}

export type AdEligibility = {
  canWatch: boolean
  reason?: 'disabled' | 'no_provider' | 'daily_limit' | 'cooldown' | 'session_in_progress' | 'reward_type_disabled' | 'expired'
  nextAdAtMs?: number
  adsToday?: number
  dailyLimit?: number
  cooldownRemainingMs?: number
}

/** UTC (or configured-tz) day boundary for the daily limit window (PRD §3.3). */
function dayWindowStart(cfg: RewardAdConfig, now = new Date()): Date {
  try {
    // Offset of the configured zone right now → shift "today 00:00" back to UTC.
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    const parts = dtf.formatToParts(now)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    const offsetMs = asUTC - Math.floor(now.getTime() / 1000) * 1000
    return new Date(Math.floor((now.getTime() - offsetMs) / 86400000) * 86400000)
  } catch {
    const d = new Date(now)
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }
}

export function rollRewardAmount(cfg: RewardAdConfig): number {
  // crypto.randomInt is the CSPRNG inclusive on both ends (PRD §3.2).
  return crypto.randomInt(cfg.minReward, cfg.maxReward + 1)
}

// ─── Eligibility + status (PRD §7 — GET /api/quicky/rewards/status) ─────────

export async function getAdEligibility(
  userId: string,
  platform: 'web' | 'android' | 'ios'
): Promise<AdEligibility & { provider: RewardProviderKind | null; config: RewardAdConfig }> {
  const cfg = await getRewardAdConfig()
  const provider = resolveRewardProvider(platform)

  if (!cfg.enabled) return { canWatch: false, reason: 'disabled', provider, config: cfg }
  if (!provider) return { canWatch: false, reason: 'no_provider', provider, config: cfg }

  const dayStart = dayWindowStart(cfg)

  const [todayCount, lastStart, pending] = await Promise.all([
    db.rewardAdSession.count({
      where: { userId, createdAt: { gte: dayStart }, status: { not: 'CANCELLED' } },
    }),
    db.rewardAdSession.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    db.rewardAdSession.findFirst({
      where: { userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      select: { id: true },
    }),
  ])

  if (pending) return { canWatch: false, reason: 'session_in_progress', provider, config: cfg }
  if (todayCount >= cfg.dailyLimit) {
    return { canWatch: false, reason: 'daily_limit', adsToday: todayCount, dailyLimit: cfg.dailyLimit, provider, config: cfg }
  }
  const sinceLast = lastStart ? Date.now() - lastStart.createdAt.getTime() : Infinity
  const cooldownMs = cfg.cooldownSeconds * 1000
  if (sinceLast < cooldownMs) {
    return {
      canWatch: false,
      reason: 'cooldown',
      nextAdAtMs: lastStart!.createdAt.getTime() + cooldownMs,
      cooldownRemainingMs: cooldownMs - sinceLast,
      provider,
      config: cfg,
    }
  }
  return { canWatch: true, adsToday: todayCount, dailyLimit: cfg.dailyLimit, provider, config: cfg }
}

// ─── Session lifecycle (PRD §7.1) ───────────────────────────────────────────

export type CreateSessionResult =
  | { ok: true; session: SessionStatusDTO }
  | { ok: false; error: AdEligibility['reason']; retryAfterMs?: number; adsToday?: number; dailyLimit?: number }

export async function createRewardSession(
  userId: string,
  rewardType: RewardType,
  platform: 'web' | 'android' | 'ios'
): Promise<CreateSessionResult> {
  const eligibility = await getAdEligibility(userId, platform)
  if (!eligibility.canWatch) {
    return {
      ok: false,
      error: eligibility.reason ?? 'no_provider',
      retryAfterMs: eligibility.cooldownRemainingMs,
      adsToday: eligibility.adsToday,
      dailyLimit: eligibility.dailyLimit,
    }
  }
  const { config: cfg, provider } = eligibility
  if (rewardType === 'COINS' && !cfg.coinsEnabled) return { ok: false, error: 'reward_type_disabled' }
  if (rewardType === 'REALM_POINTS' && !cfg.pointsEnabled) return { ok: false, error: 'reward_type_disabled' }

  const session = await db.rewardAdSession.create({
    data: {
      userId,
      rewardType,
      provider: provider!,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      metadata: JSON.stringify({ platform }),
    },
  })
  return { ok: true, session: toDTO(session, null, null) }
}

export async function getRewardSession(sessionId: string, userId: string): Promise<SessionStatusDTO | null> {
  const s = await db.rewardAdSession.findUnique({ where: { id: sessionId } })
  if (!s || s.userId !== userId) return null
  const wallet = s.status === 'COMPLETED'
    ? await db.user.findUnique({ where: { id: userId }, select: { coinBalance: true } })
    : null
  const cycle = s.status === 'COMPLETED' && s.rewardType === 'REALM_POINTS'
    ? await db.userRealm.findUnique({ where: { userId }, select: { cyclePoints: true } }).catch(() => null)
    : null
  return toDTO(s, wallet?.coinBalance ?? null, cycle?.cyclePoints ?? null)
}

export async function cancelRewardSession(sessionId: string, userId: string): Promise<boolean> {
  const res = await db.rewardAdSession.updateMany({
    where: { id: sessionId, userId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  })
  return res.count > 0
}

/** Expire stale PENDING sessions whose TTL passed (housekeeping, safe to retry). */
export async function expireStaleSessions(): Promise<number> {
  const res = await db.rewardAdSession.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
  return res.count
}

// ─── Finalization — the single reward-granting path (PRD §3.2 / §6.1) ───────

export type FinalizeResult =
  | { ok: true; rewardAmount: number; rewardType: RewardType; coinBalance: number | null; cyclePoints: number | null; alreadyApplied: boolean }
  | { ok: false; error: 'session_not_found' | 'session_expired' | 'already_finalized' | 'provider_mismatch' | 'credit_failed' }

/**
 * Complete a pending session: verify the provider + transaction, roll the
 * amount exactly once, credit the wallet with the session-scoped idempotency
 * key, and persist the result. Duplicate callbacks / replays return the SAME
 * outcome with alreadyApplied: true — never a second credit (PRD §6.1).
 *
 * Called ONLY from signature-verified provider callbacks (AdMob SSV route,
 * signed web callback route) or the env-gated dev provider.
 */
export async function finalizeRewardSession(input: {
  sessionId: string
  provider: RewardProviderKind
  providerTransactionId: string
  /** Dev/mock provider only — no external verifier exists (config gate enforces). */
  allowMock?: boolean
}): Promise<FinalizeResult> {
  const { sessionId, provider, providerTransactionId } = input

  const session = await db.rewardAdSession.findUnique({ where: { id: sessionId } })
  if (!session) return { ok: false, error: 'session_not_found' }
  if (session.provider !== provider) return { ok: false, error: 'provider_mismatch' }

  // Replay of the SAME provider transaction → return the stored outcome.
  if (session.status === 'COMPLETED') {
    const wallet =
      session.rewardType === 'COINS'
        ? await db.user.findUnique({ where: { id: session.userId }, select: { coinBalance: true } })
        : null
    const cycle =
      session.rewardType === 'REALM_POINTS'
        ? await db.userRealm.findUnique({ where: { userId: session.userId }, select: { cyclePoints: true } }).catch(() => null)
        : null
    return {
      ok: true,
      rewardAmount: session.rewardAmount ?? 0,
      rewardType: session.rewardType as RewardType,
      coinBalance: wallet?.coinBalance ?? null,
      cyclePoints: cycle?.cyclePoints ?? null,
      alreadyApplied: true,
    }
  }
  if (session.status !== 'PENDING') return { ok: false, error: 'already_finalized' }
  if (session.expiresAt.getTime() < Date.now()) {
    await db.rewardAdSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } }).catch(() => {})
    return { ok: false, error: 'session_expired' }
  }
  if (provider === 'mock' && !input.allowMock) return { ok: false, error: 'provider_mismatch' }

  const cfg = await getRewardAdConfig()
  const amount = rollRewardAmount(cfg)

  try {
    if (session.rewardType === 'COINS') {
      // One transaction: status flip + credit + ledger row (crash-safe, PRD §6.3).
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const res = await creditCoins(tx, session.userId, amount, `reward:${session.id}`, {
          transactionType: 'AD_REWARD',
          source: provider,
          sourceId: session.id,
          metadata: { providerTransactionId },
        })
        if (!res.applied && res.coinBalance === null) throw new Error('credit_failed')
        await tx.rewardAdSession.update({
          where: { id: session.id },
          data: { status: 'COMPLETED', rewardAmount: amount, providerTransactionId, completedAt: new Date() },
        })
      })
      const wallet = await db.user.findUnique({ where: { id: session.userId }, select: { coinBalance: true } })
      return { ok: true, rewardAmount: amount, rewardType: 'COINS', coinBalance: wallet?.coinBalance ?? null, cyclePoints: null, alreadyApplied: false }
    } else {
      // Realm points: awardRealmPoints has its own idempotent transaction.
      const res = await creditRealmPoints(session.userId, amount, `reward:${session.id}`, {
        transactionType: 'AD_REWARD',
        source: provider,
        sourceId: session.id,
        metadata: { providerTransactionId },
      })
      await db.rewardAdSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', rewardAmount: amount, providerTransactionId, completedAt: new Date() },
      })
      return { ok: true, rewardAmount: amount, rewardType: 'REALM_POINTS', coinBalance: null, cyclePoints: res.cyclePoints, alreadyApplied: false }
    }
  } catch {
    return { ok: false, error: 'credit_failed' }
  }
}

// ─── DTO shaping ─────────────────────────────────────────────────────────────

type SessionRow = {
  id: string
  userId: string
  rewardType: string
  status: string
  provider: string
  providerTransactionId: string | null
  rewardAmount: number | null
  expiresAt: Date
  createdAt: Date
  completedAt: Date | null
}

function toDTO(s: SessionRow, coinBalance: number | null, cyclePoints: number | null): SessionStatusDTO {
  return {
    sessionId: s.id,
    status: s.status as SessionStatusDTO['status'],
    rewardType: s.rewardType as RewardType,
    provider: s.provider as RewardProviderKind,
    rewardAmount: s.rewardAmount,
    coinBalance,
    cyclePoints,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
  }
}
