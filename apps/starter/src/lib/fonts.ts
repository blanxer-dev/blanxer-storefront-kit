import { Inter, Poppins } from 'next/font/google';

// Self-hosted by next/font (no request to Google at runtime). Only the family
// the page uses is downloaded. Add the store's font here if it is another one
// (keep to two families at most).
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-store', preload: false });
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-store', preload: false });

const FONTS: Record<string, { variable: string }> = { inter, poppins };

/** The next/font for the store's font (`customization.font`), Inter when it isn't loaded here. */
export const storeFontClass = (font: string): string => (FONTS[font.trim().toLowerCase()] || inter).variable;
