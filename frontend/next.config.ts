import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.237", "100.100.179.99", "100.100.179.121"],
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: "http://localhost:8001/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
