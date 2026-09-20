const isDev = process.env.NODE_ENV !== 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A long-running Node server, not serverless: SSE and the notification hub
  // both need a live process.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],

  // PGlite is 23 MB of WebAssembly used only by tests, the CLI scripts and
  // zero-infrastructure local development. Production requires DATABASE_URL and
  // throws before the dynamic import can ever run, so excluding it from the
  // deployment trace removes dead weight from the image and keeps serverless
  // function bundles well inside their size limits.
  outputFileTracingExcludes: {
    '*': ['node_modules/@electric-sql/pglite/**'],
  },

  // The provisioning route reads the migration SQL and the menu CSVs at runtime,
  // so they must travel with that function. Nothing else needs them.
  outputFileTracingIncludes: {
    '/api/admin/setup': ['./migrations/**', './data/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js injects inline bootstrap scripts; styles come from Tailwind.
              // 'unsafe-eval' is DEVELOPMENT ONLY — the dev server's hot reloader
              // evaluates strings. Production keeps the strict policy.
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
