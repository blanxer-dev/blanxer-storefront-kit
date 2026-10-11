'use client';
import Image, { type ImageProps } from 'next/image';
import { blanxerImageLoader } from '../next/image-loader.js';

/** `next/image` with the Blanxer loader preset (use for product/category/brand photos from Blanxer). */
export function BlanxerImage(props: ImageProps) {
  return <Image loader={blanxerImageLoader} {...props} />;
}
