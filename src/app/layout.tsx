import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quicky — Instant sparks. Real connections.",
  description: "Premium dating app with disappearing Quickies, streaks, exclusive games, and clear visibility advantages for Premium subscribers.",
  keywords: ["Quicky", "dating app", "premium dating", "disappearing media"],
  authors: [{ name: "Quicky" }],
  openGraph: {
    title: "Quicky — Instant sparks. Real connections.",
    description: "Premium dating app with disappearing Quickies, streaks, and exclusive games.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // CRITICAL for the game room: when the on-screen keyboard opens, Chrome /
  // Android WebViews must NOT resize the layout viewport (which would shrink
  // the whole page, including the game table). 'resizes-visual' shrinks only
  // the visual viewport, so the keyboard becomes a pure overlay on top of a
  // fixed-size page. The chat composer lifts itself above the keyboard via
  // --sbr-pop (see useRoomKeyboardPop.ts). Native Capacitor mirrors this with
  // plugins.Keyboard.resize = KeyboardResize.None in capacitor.config.ts.
  interactiveWidget: 'resizes-visual',
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/*
          Capacitor native-bridge noise filter — runs BEFORE any app module.
          The WebView-injected bridge (native-bridge.js) forwards native plugin
          debug output to the web console via logFromNative(); unwired plugins
          (e.g. native Firebase) log a single EMPTY OBJECT, which surfaces as
          the "{}" Console Error inside the Capacitor shell. The filter only
          drops calls that originate from logFromNative — every real app log
          passes through untouched.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var ms=['error','log','warn','debug','info'];ms.forEach(function(m){var o=console[m];if(typeof o!=='function')return;console[m]=function(){var a=arguments;if(a.length===1&&a[0]!==null&&typeof a[0]==='object'){try{if(Object.keys(a[0]).length===0&&(new Error().stack||'').indexOf('logFromNative')!==-1)return;}catch(e){}}return o.apply(console,a);};});}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
