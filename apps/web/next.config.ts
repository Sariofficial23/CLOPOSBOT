import path from 'node:path';
import type { NextConfig } from 'next';

// Only NEXT_PUBLIC_* variables are exposed to the browser. This app has no
// server-side secrets at all: it talks exclusively to our backend API.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const csp = [
  "default-src 'self'",
  // Next.js needs inline scripts for hydration; telegram.org hosts the Login Widget
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://t.me https://*.telegram.org",
  "font-src 'self' data:",
  `connect-src 'self' ${apiUrl}`,
  'frame-src https://oauth.telegram.org',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // standalone output only for the Docker image; Vercel uses its own output
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: process.env.NEXT_OUTPUT === 'standalone' ? path.join(__dirname, '../../') : undefined,
  poweredByHeader: false,
  transpilePackages: ['@cpos/shared'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: process.env.NODE_ENV === 'production' ? csp : csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
