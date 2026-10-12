import type { NextConfig } from 'next';
const dev = process.env.NODE_ENV === 'development';
const config: NextConfig = {
  output: dev ? undefined : 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@cenora/shared'],
  ...(dev
    ? {
        async rewrites() {
          return [{ source: '/api/:path*', destination: 'http://localhost:8787/api/:path*' }];
        },
      }
    : {}),
};
export default config;
