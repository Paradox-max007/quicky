// Quicky — MONETIZATION PROMPT MANAGER (Game Economy PRD §47-§49)
//
// The store must be PROMINENT and FRICTIONLESS, but never spammy (§48):
//   · max prompts per session (contextual BUY COINS nudges only)
//   · cooldown between prompts
//   · lastShownAt + dismissed state respected
// Smart triggers (§49): only a genuine contextual reason surfaces a prompt —
// insufficient coins, boost active, or an affordable-after-topup cosmetic.
// The plain "Buy Coins" BUTTONS (chip +, gift sheet CTA) are always allowed:
// those are user-initiated, not prompts — the manager only gates the
// proactive popups.

import { api } from '@/lib/quicky/api-client'

const MAX_PROMPTS_PER_SESSION = 3
const PROMPT_COOLDOWN_MS = 90_000

type PromptState = {
  shown: number
  lastShownAt: number
  dismissedTypes: Set<string>
}

const state: PromptState = {
  shown: 0,
  lastShownAt: 0,
  dismissedTypes: new Set(),
}

/** Reset per session (AppRoot mount). */
export function resetMonetizationPrompts(): void {
  state.shown = 0
  state.lastShownAt = 0
  state.dismissedTypes.clear()
}

/** A user-initiated store open (chip +, CTA button) — never counted. */
export function noteBuyCoinsPromptShown(context: string): void {
  void api.gameStore.track('store_opened', { context }).catch(() => {})
  state.lastShownAt = Date.now()
}

/**
 * May we PROACTIVELY nudge "Buy Coins" for this context right now?
 * (§48 — frequency + cooldown + dismissal, session-scoped.)
 */
export function canShowBuyCoinsPrompt(context: string): boolean {
  if (state.dismissedTypes.has(context)) return false
  if (state.shown >= MAX_PROMPTS_PER_SESSION) return false
  if (Date.now() - state.lastShownAt < PROMPT_COOLDOWN_MS) return false
  return true
}

/** Mark a proactive prompt as shown (call when the UI surfaces it). */
export function markBuyCoinsPromptShown(context: string): void {
  state.shown += 1
  state.lastShownAt = Date.now()
  void api.gameStore.track('buy_coins_prompt', { context }).catch(() => {})
}

/** The user dismissed the prompt for this context — stop nudging (§48). */
export function dismissBuyCoinsPrompt(context: string): void {
  state.dismissedTypes.add(context)
  void api.gameStore.track('buy_coins_prompt_dismissed', { context }).catch(() => {})
}

/** Fire-and-forget funnel signal from any surface (§60-§62). */
export function trackFunnel(type: string, metadata?: Record<string, unknown>): void {
  void api.gameStore.track(type, metadata).catch(() => {})
}
