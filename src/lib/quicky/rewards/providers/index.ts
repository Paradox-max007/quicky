// Quicky — REWARDED-AD PROVIDER ABSTRACTION (Monetization PRD §4.1 / §4.2)
//
// One interface, three implementations:
//   NativeAdMobProvider  — Google AdMob rewarded ads inside the Capacitor
//                           shell. The plugin is detected at RUNTIME via
//                           window.Capacitor.Plugins.AdMob, so the web bundle
//                           never hard-depends on the native package.
//   WebRewardedAdProvider — Google Ad Manager (GPT) rewarded ad for the web
//                           app, behind WEB_REWARDED_AD_PROVIDER=gam. The
//                           CREDIT is issued only after the provider's signed
//                           server callback (see /rewards/web/callback).
//   MockAdProvider        — the dev/demo house ad (5s), server-gated by
//                           ALLOW_MOCK_REWARDED_ADS. Never in production.
//
// The provider decides ONLY whether an ad was SHOWN. The server decides
// whether currency moves (session + SSV/web callback verification).
//
// Native wiring is PREINSTALLED in this repo (Monetization PRD §4.1):
//   · @capacitor-community/admob@8 (npm) — synced into android/ + ios/ via
//     `bunx cap sync` (see android/capacitor.settings.gradle, CapApp-SPM)
//   · AndroidManifest carries the AdMob APPLICATION_ID meta-data (Google's
//     official TEST app id — swap for the real one before launch)
//   env: ADMOB_APP_ID_ANDROID, ADMOB_REWARDED_AD_UNIT_ID_ANDROID (test ids while developing)
//
// Plugin API (@capacitor-community/admob v8.1.0):
//   initialize({}) → resolves when MobileAds is ready
//   prepareRewardVideoAd({ adId, ssv: { customData, userId } }) → resolves
//     when the ad LOADS; rejects on load failure; sets SSV custom data
//   showRewardVideoAd() → resolves ONLY when the user EARNS the reward
//     (OnUserEarnedRewardListener); early dismissal never resolves it — the
//     onRewardedVideoAdDismissed listener settles that case.
//   events: onRewardedVideoAdReward / onRewardedVideoAdDismissed /
//     onRewardedVideoAdFailedToShow / onRewardedVideoAdFailedToLoad

import { isNative, getPlatform } from '@/lib/capacitor'
import type { RewardType } from '@/lib/quicky/rewards/sessions'

export type RewardAdEvent =
  | { type: 'completed' } // full watch reported by the provider
  | { type: 'dismissed' } // user closed early — no reward
  | { type: 'failed'; reason?: string } // load/show failure

export type RewardedAdProvider = {
  readonly kind: 'admob' | 'web_ad' | 'mock'
  /** True when the SDK/plugin is present AND configured for this platform. */
  isAvailable(): Promise<boolean>
  /**
   * Show a rewarded ad. `rewardSessionId` rides along in the ad SDK's
   * server-side-verification data so Google's SSV callback can find the
   * session. Resolves with the terminal provider event.
   */
  show(input: { rewardSessionId: string; rewardType: RewardType }): Promise<RewardAdEvent>
}

// ─── Native AdMob (runtime plugin detection — no build-time dependency) ─────

type AdMobPluginProxy = {
  initialize(opts?: Record<string, unknown>): Promise<unknown>
  prepareRewardVideoAd(opts?: Record<string, unknown>): Promise<unknown>
  showRewardVideoAd(opts?: Record<string, unknown>): Promise<unknown>
  addListener?(event: string, cb: (payload: unknown) => void): { remove: () => void }
}

function getAdMobPlugin(): AdMobPluginProxy | null {
  if (typeof window === 'undefined') return null
  try {
    const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    const admob = cap?.Plugins?.AdMob as AdMobPluginProxy | undefined
    if (!admob || typeof admob.prepareRewardVideoAd !== 'function') return null
    return admob
  } catch {
    return null
  }
}

/** Google's ALWAYS-ON test ad unit ids (safe for development, PRD §11). */
const ADMOB_TEST_REWARDED_ANDROID = 'ca-app-pub-3940256099942544/5224354917'
const ADMOB_TEST_REWARDED_IOS = 'ca-app-pub-3940256099942544/1712485313'

export class NativeAdMobProvider implements RewardedAdProvider {
  readonly kind = 'admob' as const
  private initialized = false

  private adUnitId(): string | null {
    const platform = getPlatform()
    const useTest = process.env.NEXT_PUBLIC_ADMOB_USE_TEST_ADS === 'true'
    if (useTest) return platform === 'ios' ? ADMOB_TEST_REWARDED_IOS : ADMOB_TEST_REWARDED_ANDROID
    return (
      process.env.NEXT_PUBLIC_ADMOB_REWARDED_AD_UNIT_ID ??
      (platform === 'ios' ? process.env.NEXT_PUBLIC_ADMOB_REWARDED_AD_UNIT_ID_IOS : null) ??
      null
    )
  }

  async isAvailable(): Promise<boolean> {
    if (!isNative()) return false
    const plugin = getAdMobPlugin()
    if (!plugin) return false
    return !!this.adUnitId()
  }

  private async ensureInitialized(): Promise<void> {
    const plugin = getAdMobPlugin()
    if (!plugin || this.initialized) return
    await plugin.initialize({}).catch(() => {})
    this.initialized = true
  }

  async show(input: { rewardSessionId: string; rewardType: RewardType }): Promise<RewardAdEvent> {
    const plugin = getAdMobPlugin()
    const adUnit = this.adUnitId()
    if (!plugin || !adUnit) return { type: 'failed', reason: 'admob_unavailable' }

    await this.ensureInitialized()

    let settled: RewardAdEvent | null = null
    const settle = (e: RewardAdEvent) => {
      if (!settled) settled = e
    }
    const listeners: Array<{ remove: () => void }> = []
    const on = (event: string, fn: (payload: unknown) => void) => {
      try {
        const l = plugin.addListener?.(event, fn)
        if (l) listeners.push(l)
      } catch {
        /* listener registration is best-effort */
      }
    }
    const cleanup = () => listeners.forEach((l) => l.remove?.())

    // v8.1.0 event names (RewardAdPluginEvents.kt). The Reward event fires
    // when the user earns the reward — BEFORE Dismissed on a full watch — so
    // a completed watch settles on Reward and the trailing Dismissed is a
    // no-op (settled already). An early close fires Dismissed alone.
    on('onRewardedVideoAdReward', () => settle({ type: 'completed' }))
    on('onRewardedVideoAdDismissed', () => settle({ type: 'dismissed' }))
    on('onRewardedVideoAdFailedToShow', (payload) => {
      const p = payload as { message?: string; code?: number }
      settle({ type: 'failed', reason: p?.message ?? `admob_show_failed_${p?.code ?? 'unknown'}` })
    })
    on('onRewardedVideoAdFailedToLoad', (payload) => {
      const p = payload as { message?: string; code?: number }
      settle({ type: 'failed', reason: p?.message ?? `admob_load_failed_${p?.code ?? 'unknown'}` })
    })

    try {
      // LOAD (resolves when loaded, rejects on failure). SSV association:
      // Google's callback echoes custom_data — our session id.
      await plugin.prepareRewardVideoAd({
        adId: adUnit,
        ssv: { customData: input.rewardSessionId, userId: input.rewardSessionId },
      })
    } catch (e) {
      cleanup()
      return settled ?? { type: 'failed', reason: e instanceof Error ? e.message : 'admob_load_failed' }
    }

    try {
      // SHOW — resolves ONLY on reward earned (the plugin's own resolve
      // path is OnUserEarnedRewardListener). Early dismissal never resolves
      // it; the Dismissed listener above settles that case instead.
      await plugin.showRewardVideoAd()
      settle({ type: 'completed' })
    } catch (e) {
      settle({ type: 'failed', reason: e instanceof Error ? e.message : 'admob_error' })
    }
    if (settled) {
      cleanup()
      return settled
    }

    // Waiting for a terminal event (dismissed / failed). Safety deadline so
    // a wedged SDK can never hang the flow forever.
    const deadline = Date.now() + 10 * 60 * 1000
    while (!settled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
    }
    cleanup()
    return settled ?? { type: 'dismissed' }
  }
}

// ─── Web rewarded ads (Google Ad Manager / GPT) ──────────────────────────────

type GPTNamespace = {
  cmd: Array<() => void>
  defineOutOfPageSlot?(adUnit: string, optOut?: string): { addService: (s: unknown) => void }
  pubads(): {
    addEventListener(event: string, cb: (e: unknown) => void): void
    refresh?(): void
  }
  destroySlots?(): void
  [k: string]: unknown
}

declare global {
  interface Window {
    googletag?: GPTNamespace
  }
}

function loadGpt(): Promise<GPTNamespace> {
  return new Promise((resolve, reject) => {
    if (window.googletag?.cmd) return resolve(window.googletag)
    const s = document.createElement('script')
    s.src = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
    s.async = true
    s.onload = () => window.googletag ? resolve(window.googletag) : reject(new Error('gpt_unavailable'))
    s.onerror = () => reject(new Error('gpt_load_failed'))
    document.head.appendChild(s)
    setTimeout(() => reject(new Error('gpt_timeout')), 15_000)
  })
}

export class WebRewardedAdProvider implements RewardedAdProvider {
  readonly kind = 'web_ad' as const

  private enabled(): boolean {
    return process.env.NEXT_PUBLIC_WEB_REWARDED_AD_PROVIDER === 'gam' && !!process.env.NEXT_PUBLIC_WEB_REWARDED_AD_UNIT_ID
  }

  async isAvailable(): Promise<boolean> {
    if (this.enabled()) return true // GPT loads lazily; availability = configured
    return false
  }

  async show(): Promise<RewardAdEvent> {
    if (!this.enabled()) return { type: 'failed', reason: 'web_ads_not_configured' }
    try {
      const gpt = await loadGpt()
      return await new Promise<RewardAdEvent>((resolve) => {
        let slot: { addService: (s: unknown) => void } | null = null
        let done = false
        const finish = (e: RewardAdEvent) => {
          if (done) return
          done = true
          gpt.destroySlots?.()
          resolve(e)
        }
        gpt.cmd.push(() => {
          try {
            slot = gpt.defineOutOfPageSlot?.(process.env.NEXT_PUBLIC_WEB_REWARDED_AD_UNIT_ID!, 'RewardedAds') ?? null
            if (!slot) return finish({ type: 'failed', reason: 'gam_slot_unavailable' })
            slot.addService(gpt.pubads())
            gpt.pubads().addEventListener('rewardedSlotReady', () => {
              try {
                ;(gpt as unknown as { display: (s?: unknown) => void }).display?.()
                const brk = (gpt as unknown as { rewardedBreak?: { start: () => void } }).rewardedBreak
                brk?.start?.()
              } catch {
                finish({ type: 'failed', reason: 'gam_show_failed' })
              }
            })
            gpt.pubads().addEventListener('rewardedSlotClosed', () => finish({ type: 'completed' }))
            gpt.pubads().addEventListener('rewardedSlotFailedToLoad', () => finish({ type: 'failed', reason: 'gam_no_inventory' }))
            // Safety net: no rewarded slot after 60s → treat as no inventory.
            setTimeout(() => finish({ type: 'failed', reason: 'gam_timeout' }), 60_000)
          } catch (e) {
            finish({ type: 'failed', reason: e instanceof Error ? e.message : 'gam_error' })
          }
        })
      })
    } catch (e) {
      return { type: 'failed', reason: e instanceof Error ? e.message : 'gpt_error' }
    }
  }
}

// ─── Dev demo provider (house ad, server-gated) ────────────────────────────

export class MockAdProvider implements RewardedAdProvider {
  readonly kind = 'mock' as const
  constructor(private readonly onDevMockWatch: (cb: (e: RewardAdEvent) => void) => void) {}

  async isAvailable(): Promise<boolean> {
    // The SERVER decides (env gate); client mirrors via /rewards/status.
    return true
  }

  async show(): Promise<RewardAdEvent> {
    return new Promise((resolve) => {
      this.onDevMockWatch(resolve)
    })
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

export function getRewardedAdProvider(provider: string | null, onDevMockWatch: (cb: (e: RewardAdEvent) => void) => void): RewardedAdProvider | null {
  switch (provider) {
    case 'admob':
      return new NativeAdMobProvider()
    case 'web_ad':
      return new WebRewardedAdProvider()
    case 'mock':
      return new MockAdProvider(onDevMockWatch)
    default:
      return null
  }
}
