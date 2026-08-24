import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.quicky.app",
  appName: "Quicky",
  webDir: "out",

  // ─── Dev: point to the running Next.js server ──────────────────────────────
  // Wi-Fi testing: the phone loads the app directly from the PC's Wi-Fi IP.
  // (Requires the dev server running with `npm run dev` and both devices on
  // the same network. If this IP changes, update it and re-run `cap sync`.)
  // For USB testing instead, revert to http://localhost:3000 and run
  // `adb reverse tcp:3000 tcp:3000` before launching the app.
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
