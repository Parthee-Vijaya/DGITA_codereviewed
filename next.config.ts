import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        ],
      },
      {
        source: "/cases/:caseNumber/receipt",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        source: "/approve/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'none'; form-action 'self'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Formularmotoren accepterer dokumenter op til 25 MB. Multipart-overhead
      // kræver lidt ekstra plads, mens endpointet fortsat håndhæver 25 MB pr. fil.
      bodySizeLimit: "30mb",
    },
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
