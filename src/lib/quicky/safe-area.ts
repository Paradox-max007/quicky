/**
 * Quicky — SAFE-AREA CALIBRATION (mobile/Capacitor)
 *
 * WHY THIS EXISTS — the WebView is positioned differently per platform:
 *
 *   · Web (mobile browsers): viewport-fit=cover makes env(safe-area-inset-*)
 *     the real notch/browser-chrome insets — the PAGE owns the spacing.
 *
 *   · Native Capacitor shell: the SHELL already keeps the page content below
 *     the system bars (iOS contentInset "always"; Android SystemBars insets
 *     handling). On those platforms env(safe-area-inset-*) is either already
 *     0 or — on newer Chromium WebViews with viewport-fit=cover — still
 *     reports the raw insets, DOUBLE-COUNTING them when the app also pads
 *     with .safe-area-top. That double-count is exactly the "gap from the
 *     navbar is a bit large" report on the Games / Community / Chats screens
 *     (the screens WITHOUT the class looked right).
 *
 * The fix: inside the native shell the shell owns the TOP inset, so the app
 * reserves nothing extra (0px) — every screen then shares the SAME top
 * rhythm (pt-3) as the Discovery / Likes / Profile screens the design was
 * tuned on. On the web the real env() value is kept.
 *
 * BOTTOM/LEFT/RIGHT are intentionally left on env(): the bottom nav and the
 * sheets reserve the gesture-bar area on devices where the WebView really is
 * edge-to-edge, and no bottom gap complaint exists to fix.
 *
 * SSR-safe (no window access at import on the server).
 */

let initialized = false

export function initSafeArea(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (initialized) return
  initialized = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Capacitor } = require('@capacitor/core')
    if (Capacitor?.isNativePlatform?.()) {
      document.documentElement.setAttribute('data-qk-native', '1')
    }
  } catch {
    // web build without Capacitor — nothing to calibrate
  }
}
