// next/image loader (next.config.ts → images.loaderFile). Resizes Blanxer
// product photos through wsrv.nl by default; set NEXT_PUBLIC_BLANXER_IMAGE_LOADER
// to 'cloudflare' to use Cloudflare Image Transformations on your own zone.
export { default } from '@blanxer-dev/storefront/image-loader';
