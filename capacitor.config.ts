import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.quicky.app",
  appName: "Quicky",
  webDir: "out",

  // ─── Dev: point to the running Next.js server ──────────────────────────────
  // Your phone must be on the same Wi-Fi network as your PC.
  server: {
    url: "http://172.20.10.7:3000",
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
