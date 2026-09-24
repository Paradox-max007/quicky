import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // ── MOBILE-WEB DEV ACCESS (the "auto redirect to Discover" root cause) ──
  // allowedDevOrigins is deliberately NOT set:
  //   · As soon as the key exists, Next dev switches from WARN to BLOCK mode
  //     and 403s every /_next/* request whose Origin hostname is not listed.
  //   · Entries match against the Origin HOSTNAME ONLY (ports are never
  //     stripped), so the previous "172.20.10.7:3000"-style entries never
  //     matched anything — and the dev laptop's LAN IP changes per network,
  //     so no fixed list can work.
  //   · Blocked /_next/* chunks/HMR socket make Next.js recover with a full
  //     page RELOAD → the SPA re-boots → Discover, over and over at regular
  //     intervals on every phone on the LAN (desktop localhost is exempt,
  //     which is why it only reproduced in mobile web view).
  // With the key ABSENT, dev mode only WARNS on cross-origin requests and
  // never blocks — phones work from any network IP. Dev-only behavior;
  // production builds are unaffected either way.
  // Suppress noisy repeated GET logs for the spin-bottle room poll
  // and the matches badge poll in dev mode.
  logging: {
    incomingRequests: {
      ignore: [
        /^\/api\/quicky\/games\/spin-bottle\/room/,
        /^\/api\/quicky\/matches/,
      ],
    },
  },
};

export default nextConfig;
