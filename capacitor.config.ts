import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.quicky.app",
  appName: "Quicky",
  webDir: "out",

  // ─── Dev: point to the running Next.js server ──────────────────────────────
  // When testing on Android via USB, `adb reverse tcp:3000 tcp:3000` forwards localhost:3000.
  // For Wi-Fi testing, you can change this back to your PC's Wi-Fi IP (e.g. http://172.20.10.7:3000).
  server: {
    url: "http://localhost:3000",
    cleartext: true,
    androidScheme: "http",
  },

  // ─── Android ───────────────────────────────────────────────────────────────
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
    },
  },

  // ─── iOS ───────────────────────────────────────────────────────────────────
  ios: {
    contentInset: "always",
  },

  // ─── Plugins ───────────────────────────────────────────────────────────────
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#0F0F14",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "Dark",
      backgroundColor: "#0F0F14",
    },
  },
};

export default config;
