import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async redirects() {
    return [
      {
        source: "/news",
        destination: "/index.html#rsipu30",
        permanent: false,
      },
      {
        source: "/backtest",
        destination: "/index.html#rsipu30",
        permanent: false,
      },
      {
        source: "/rsi-pu30",
        destination: "/index.html#rsipu30",
        permanent: false,
      },
      {
        source: "/rsi-pu30/:symbol",
        destination: "/index.html?symbol=:symbol#rsipu30",
        permanent: false,
      },
      {
        source: "/",
        destination: "/index.html",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/chart/:symbol",
        destination: "/api/bist/:symbol/chart",
      },
      // Lightweight Python signal engine (api/index.py) on Vercel; locally the
      // full engine runs separately on port 8001.
      {
        source: "/api/py/:path*",
        destination: process.env.NODE_ENV === "development" ? "http://127.0.0.1:8001/:path*" : "/api/",
      },
    ];
  },
};

export default nextConfig;
