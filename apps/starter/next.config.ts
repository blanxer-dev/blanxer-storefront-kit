import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // Product photos are resized by @blanxer-dev/storefront's loader (wsrv.nl by
    // default, or Cloudflare Image Transformations). Local files in public/ are
    // served as they are, so optimise them first: `npx blanxer-storefront images`.
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
  },
  poweredByHeader: false,
};

export default nextConfig;
