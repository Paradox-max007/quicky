import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "com.quicky.app",
  appName: "Quicky",
  webDir: "out",

  // ─── App origin: the deployed web app (production) ───────────────────────
  // The native shell loads the live Vercel deployment directly, so the APK
  // always runs the latest web build — no bundling, no local server. All
  // /api/* calls are same-origin against this deployment and the session
  // cookie (quicky_session) lives in the WebView cookie store.
  //
  // Dev: to run against a local dev server again, set url to
  // http://<your-LAN-IP>:3000 (or http://localhost:3000 + `adb reverse
  // tcp:3000 tcp:3000`), set cleartext: true + androidScheme: "http", and
  // re-run `bunx cap sync android`.
  server: {
    url: "https://quicky.vercel.app",
    androidScheme: "https",
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
    Keyboard: {
      // The keyboard OVERLAYS the page instead of resizing the WebView, so
      // the game room (table, seats, HUD) never shrinks when typing. The
      // chat composer lifts itself above the keyboard via the
      // keyboardWillShow/Hide events (see SpinBottleRoom.tsx, --sbr-kb).
      resize: KeyboardResize.None,
    },
  },
};

export default config;
