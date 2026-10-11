/**
 * next/image loader for product photos. Default: wsrv.nl (the resize proxy the
 * Blanxer storefront uses), output WebP. Local images (`/…`) are returned as-is.
 *
 * Use globally in next.config.ts:
 *   images: { loader: 'custom', loaderFile: './src/lib/image-loader.ts' }
 * with src/lib/image-loader.ts: `export { default } from '@blanxer/storefront/image-loader'`.
 *
 * Switch provider with NEXT_PUBLIC_BLANXER_IMAGE_LOADER = 'wsrv' (default) |
 * 'cloudflare' (Cloudflare Image Transformations on your zone, /cdn-cgi/image) | 'none'.
 */
export interface ImageLoaderProps {
  src: string;
  width: number;
  quality?: number;
}

export type ImageProvider = 'wsrv' | 'cloudflare' | 'none';

const envProvider = (): ImageProvider => {
  let v: string | undefined;
  try {
    v = process.env.NEXT_PUBLIC_BLANXER_IMAGE_LOADER;
  } catch {
    v = undefined;
  }
  return v === 'cloudflare' || v === 'none' ? v : 'wsrv';
};

/** Build a loader for a given provider. */
export function createImageLoader(provider: ImageProvider = envProvider()) {
  return function blanxerImageLoader({ src, width, quality }: ImageLoaderProps): string {
    const q = quality || 75;
    if (!src) return src;
    if (src.startsWith('/') && !src.startsWith('//')) {
      // Local files are already optimised (`blanxer-storefront images`); the width param keeps next/image happy.
      return `${src}${src.includes('?') ? '&' : '?'}w=${width}`;
    }
    if (src.startsWith('data:') || src.endsWith('.svg')) return src;
    if (provider === 'none') return src;
    if (provider === 'cloudflare') return `/cdn-cgi/image/width=${width},quality=${q},format=auto/${src}`;
    return `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=${width}&q=${q}&output=webp`;
  };
}

/** Default loader (provider from NEXT_PUBLIC_BLANXER_IMAGE_LOADER, else wsrv.nl). */
export const blanxerImageLoader = createImageLoader();

export default blanxerImageLoader;
