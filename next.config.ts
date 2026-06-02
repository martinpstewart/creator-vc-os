import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Old /email route renamed to /marketing in May 2026. Keep stale bookmarks alive.
  async redirects() {
    return [
      { source: "/email", destination: "/marketing", permanent: true },
      { source: "/email/:path*", destination: "/marketing/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
