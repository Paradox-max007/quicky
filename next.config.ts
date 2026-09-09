import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "localhost:3000",
    "127.0.0.1:3000",
    "172.20.10.7:3000",
    "10.93.186.102:3000",
  ],
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
