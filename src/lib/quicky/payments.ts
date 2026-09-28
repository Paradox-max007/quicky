// Quicky — PAYMENT SERVICE (Game Economy PRD §9-§13, §67-§70)
//
// A provider-agnostic payment seam so the whole game economy never becomes
// dependent on one payment provider:
//
//   Game Store → PaymentService → PaymentAdapter
//                                  ├── WebPaymentAdapter     (Stripe: card / Google Pay / Apple Pay)
//                                  ├── AndroidPaymentAdapter (Google Play billing, Capacitor)
//                                  └── IOSPaymentAdapter     (StoreKit, Capacitor)
//
// V1 ships the SANDBOX adapter behind every platform route (clearly labelled
// "mock" in the ledger). The PLATFORM ROUTING is already real: the client
// declares its platform, the server picks the adapter, and crediting is
// ALWAYS server-authoritative (PRD §9: "the server/payment provider webhook
// must be authoritative — never credit because the client reports success").
//
// Purchase lifecycle (PRD §13/§46/§70):
//   PENDING → (adapter verify) → COMPLETED + credit inside ONE transaction
//   A real provider: PENDING → PROCESSING → webhook verify → COMPLETED/FAILED
//   (recovery: GET /api/quicky/game-store/purchases re-syncs entitlements).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export type PaymentPlatform = 'web' | 'android' | 'ios'
export type PaymentProviderId = 'mock' | 'stripe' | 'google_pay' | 'apple_pay'
export type PurchaseProductType = 'COIN_PACK' | 'CRATE'

export type PurchaseDraft = {
  userId: string
  productId: string
  productType: PurchaseProductType
  currency: string
  amount: number
  coins?: number
  bonusCoins?: number
  metadata?: Record<string, unknown>
}

export type ProviderVerification = {
  ok: boolean
  status: 'COMPLETED' | 'FAILED' | 'PENDING'
  providerTransactionId: string
  provider: PaymentProviderId
  /** Debug/audit note (mock provider labels itself clearly). */
  note?: string
}

export interface PaymentAdapter {
  readonly provider: PaymentProviderId
  readonly platform: PaymentPlatform
  /**
   * Verify/execute a payment. The ADAPTER is the only place a provider is
   * ever trusted — and it must verify through the provider's own API /
   * webhook, never the client. The sandbox adapter simply issues a
   * server-generated transaction id (dev-only, labelled).
   */
  verify(draft: PurchaseDraft): Promise<ProviderVerification>
}

// ── SANDBOX adapter (dev/staging only) ────────────────────────────────────

class SandboxPaymentAdapter implements PaymentAdapter {
  readonly provider: PaymentProviderId = 'mock'
  constructor(readonly platform: PaymentPlatform) {}

  async verify(_draft: PurchaseDraft): Promise<ProviderVerification> {
    return {
      ok: true,
      status: 'COMPLETED',
      provider: 'mock',
      providerTransactionId: `mock_${this.platform}_${crypto.randomUUID()}`,
      note: 'Sandbox purchase — no real money moved. Swap this adapter for Stripe/Play/StoreKit in production.',
    }
  }
}

// ── Platform routing (PRD §12: web, android, ios adapters) ────────────────
// TODO(production): real implementations —
//   web:     Stripe PaymentIntents (card/Google Pay/Apple Pay by availability)
//   android: Google Play Billing (Capacitor) + server-side purchase token verification
//   ios:     StoreKit 2 (Capacitor) + App Store server notifications
const ADAPTERS: Record<PaymentPlatform, PaymentAdapter> = {
  web: new SandboxPaymentAdapter('web'),
  android: new SandboxPaymentAdapter('android'),
  ios: new SandboxPaymentAdapter('ios'),
}

export function getPaymentAdapter(platform: string | null | undefined): PaymentAdapter {
  const p = platform === 'android' || platform === 'ios' ? (platform as PaymentPlatform) : 'web'
  return ADAPTERS[p]
}

// ── PaymentService (PRD §10) ──────────────────────────────────────────────

export type CompletedPurchase = {
  ok: true
  purchaseId: string
  provider: PaymentProviderId
  providerTransactionId: string
  coins: number
  bonusCoins: number
  status: string
}

export type FailedPurchase = { ok: false; error: string; purchaseId: string | null }

/**
 * Run the full purchase lifecycle for a payment that completes immediately
 * (sandbox today; a real synchronous provider like a verified Stripe
 * PaymentIntent could land here too). Crediting and the status flip to
 * COMPLETED happen inside ONE transaction — a crash can never credit
 * without the ledger row or vice versa (PRD §67).
 *
 * `credit` runs INSIDE the transaction and must throw on failure.
 */
export async function startAndCompletePurchase(
  draft: PurchaseDraft,
  platform: string | null | undefined,
  credit: (tx: Prisma.TransactionClient, purchaseId: string) => Promise<Record<string, unknown> | void>
): Promise<CompletedPurchase | FailedPurchase> {
  const adapter = getPaymentAdapter(platform)

  // 1. Create the ledger row (PENDING) first — every purchase is traceable
  //    from the moment it starts, whatever happens next (PRD §13).
  const purchase = await db.gamePurchase.create({
    data: {
      userId: draft.userId,
      productId: draft.productId,
      productType: draft.productType,
      provider: adapter.provider,
      currency: draft.currency,
      amount: draft.amount,
      coins: draft.coins ?? null,
      bonusCoins: draft.bonusCoins ?? null,
      status: 'PENDING',
      metadata: JSON.stringify({ ...(draft.metadata ?? {}), platform: adapter.platform }),
    },
    select: { id: true },
  })

  // 2. Provider verification (sandbox: instant; production: provider API).
  const verification = await adapter.verify(draft)
  if (!verification.ok || verification.status !== 'COMPLETED') {
    await db.gamePurchase.update({
      where: { id: purchase.id },
      data: { status: verification.status === 'FAILED' ? 'FAILED' : 'PROCESSING', metadata: JSON.stringify({ platform: adapter.platform, note: verification.note }) },
    }).catch(() => {})
    return { ok: false, error: 'payment_failed', purchaseId: purchase.id }
  }

  // 3. Credit + COMPLETED atomically (PRD §67 — server-authoritative only).
  try {
    const extra = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const creditMeta = (await credit(tx, purchase.id)) ?? {}
      await tx.gamePurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'COMPLETED',
          providerTransactionId: verification.providerTransactionId,
          completedAt: new Date(),
          metadata: JSON.stringify({ platform: adapter.platform, note: verification.note, ...creditMeta }),
        },
      })
      return creditMeta
    })
    return {
      ok: true,
      purchaseId: purchase.id,
      provider: verification.provider,
      providerTransactionId: verification.providerTransactionId,
      coins: draft.coins ?? 0,
      bonusCoins: draft.bonusCoins ?? 0,
      status: 'COMPLETED',
      ...(extra as Record<string, unknown>),
    } as CompletedPurchase
  } catch {
    await db.gamePurchase
      .update({ where: { id: purchase.id }, data: { status: 'FAILED' } })
      .catch(() => {})
    return { ok: false, error: 'credit_failed', purchaseId: purchase.id }
  }
}

/**
 * Webhook-style completion for real providers (PRD §9): flip a PENDING/
 * PROCESSING purchase to COMPLETED and credit inside one transaction. The
 * provider's signed payload is verified by the route BEFORE calling this.
 */
export async function completePurchaseFromProvider(
  provider: PaymentProviderId,
  providerTransactionId: string,
  credit: (tx: Prisma.TransactionClient, purchaseId: string) => Promise<Record<string, unknown> | void>
): Promise<CompletedPurchase | FailedPurchase> {
  const purchase = await db.gamePurchase.findUnique({ where: { provider_providerTransactionId: { provider, providerTransactionId } } })
  if (!purchase) return { ok: false, error: 'purchase_not_found', purchaseId: null }
  if (purchase.status === 'COMPLETED') {
    return {
      ok: true,
      purchaseId: purchase.id,
      provider,
      providerTransactionId,
      coins: purchase.coins ?? 0,
      bonusCoins: purchase.bonusCoins ?? 0,
      status: 'COMPLETED',
    }
  }
  if (purchase.status === 'REFUNDED' || purchase.status === 'CANCELLED') {
    return { ok: false, error: `purchase_${purchase.status.toLowerCase()}`, purchaseId: purchase.id }
  }
  try {
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const creditMeta = (await credit(tx, purchase.id)) ?? {}
      await tx.gamePurchase.update({
        where: { id: purchase.id },
        data: { status: 'COMPLETED', completedAt: new Date(), metadata: JSON.stringify({ completedVia: 'provider_webhook', ...creditMeta }) },
      })
    })
    return {
      ok: true,
      purchaseId: purchase.id,
      provider,
      providerTransactionId,
      coins: purchase.coins ?? 0,
      bonusCoins: purchase.bonusCoins ?? 0,
      status: 'COMPLETED',
    }
  } catch {
    return { ok: false, error: 'credit_failed', purchaseId: purchase.id }
  }
}
