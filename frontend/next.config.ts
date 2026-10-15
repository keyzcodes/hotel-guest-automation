import type { NextConfig } from "next";
const backend = (process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
const nextConfig: NextConfig = {
  async rewrites() {
    // Same-origin proxy keeps HttpOnly cookies working across hosting providers.
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/socket.io/:path*", destination: `${backend}/socket.io/:path*` },
    ];
  },
};
export default nextConfig;
