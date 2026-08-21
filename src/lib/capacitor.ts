/**
 * Capacitor native platform helpers.
 * Safe to import in both web (SSR) and native contexts.
 */

let _isNative: boolean = false;
let _isNativeChecked: boolean = false;

/** Returns true when running inside a Capacitor native shell (Android/iOS) */
export function isNative(): boolean {
  if (_isNativeChecked) return _isNative;
  if (typeof window === "undefined") {
    _isNative = false;
    _isNativeChecked = true;
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Capacitor } = require("@capacitor/core");
    _isNative = !!Capacitor?.isNativePlatform?.();
  } catch {
    _isNative = false;
  }
  _isNativeChecked = true;
  return _isNative;
}

/** Returns 'android' | 'ios' | 'web' */
export function getPlatform(): "android" | "ios" | "web" {
  if (typeof window === "undefined") return "web";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Capacitor } = require("@capacitor/core");
    return Capacitor.getPlatform() as "android" | "ios" | "web";
  } catch {
    return "web";
  }
}

/** Trigger haptic feedback (silently no-ops on web) */
export async function hapticImpact(
  style: "heavy" | "medium" | "light" = "medium"
): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const styleMap = {
      heavy: ImpactStyle.Heavy,
      medium: ImpactStyle.Medium,
      light: ImpactStyle.Light,
    };
    await Haptics.impact({ style: styleMap[style] });
  } catch {
    // ignore on web
  }
}

/** Trigger haptic notification feedback */
export async function hapticNotification(
  type: "success" | "warning" | "error" = "success"
): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    const typeMap = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: typeMap[type] });
  } catch {
    // ignore on web
  }
}

/** Hide the splash screen */
export async function hideSplashScreen(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    // ignore
  }
}

/** Set status bar to dark (matches Quicky theme) */
export async function initStatusBar(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0F0F14" });
  } catch {
    // ignore on web / iOS (overlay mode)
  }
}
