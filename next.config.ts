import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["172.20.10.*", "10.93.186.*", "localhost:3000", "127.0.0.1:3000", "localhost", "127.0.0.1"],
};

export default nextConfig;
