import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectRoutes, findPageFile, nextImageIssues, rendersPackageCheckout, SECRET_PATTERNS } from '../src/cli/check.js';
import { parse } from '../src/cli/image-size.js';
import { createImageLoader } from '../src/next/image-loader.js';

const site = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'bx-check-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
};

describe('check: routes', () => {
  it('normalises dynamic segments and route groups', () => {
    const root = site({
      'src/app/(shop)/product/[slug]/page.tsx': '',
      'src/app/track/[id]/page.tsx': '',
      'src/app/sitemap.xml/route.ts': '',
      'src/app/robots.ts': '',
      'src/app/layout.tsx': '',
    });
    const r = collectRoutes(join(root, 'src/app'));
    expect([...r].sort()).toEqual(['/product/[]', '/robots.txt', '/sitemap.xml', '/track/[]']);
  });
});

describe('check: checkout uses the package', () => {
  it('direct, aliased and via a local component', () => {
    const direct = site({ 'app/checkout/page.tsx': `import { Checkout } from '@blanxer-dev/storefront/react';\nexport default () => <Checkout />;` });
    expect(rendersPackageCheckout(findPageFile(join(direct, 'app'), '/checkout')!, direct)).toBe(true);

    const aliased = site({ 'app/checkout/page.tsx': `import { Money, Checkout as BxCheckout } from '@blanxer-dev/storefront/react';\nexport default () => <BxCheckout theme={{}}/>;` });
    expect(rendersPackageCheckout(findPageFile(join(aliased, 'app'), '/checkout')!, aliased)).toBe(true);

    const nested = site({
      'src/app/checkout/page.tsx': `import Shell from '@/components/checkout-shell';\nexport default () => <Shell />;`,
      'src/components/checkout-shell.tsx': `'use client';\nimport { Checkout } from '@blanxer-dev/storefront/react';\nexport default () => <div><Checkout/></div>;`,
    });
    expect(rendersPackageCheckout(findPageFile(join(nested, 'src/app'), '/checkout')!, nested)).toBe(true);
  });

  it('fails a hand-written checkout', () => {
    const root = site({ 'app/checkout/page.tsx': `export default function Checkout() { return <form>my own</form>; }` });
    expect(rendersPackageCheckout(findPageFile(join(root, 'app'), '/checkout')!, root)).toBe(false);
  });
});

describe('check: secrets', () => {
  const hit = (s: string) => SECRET_PATTERNS.some((p) => p.re.test(s));
  it('catches keys, ignores masked values', () => {
    // fake values, assembled at runtime so secret scanners don't flag the test itself
    const fakeKey = ['sk', 'live', 'x'.repeat(26)].join('_');
    expect(hit(`const k = "${fakeKey}";`)).toBe(true);
    expect(hit(`{"esewa_secret":"${'FAKE' + 'SECRET/:&x.1/q'}"}`)).toBe(true);
    expect(hit('{"esewa_secret":"yes"}')).toBe(false);
    expect(hit(`{"token":"${Buffer.from('fake-token-for-tests-only-0123456789').toString('base64')}"}`)).toBe(true);
    expect(hit('KHALTI_SECRET_KEY=live_secret_key_123456')).toBe(true);
  });
});

describe('image header sizes', () => {
  it('PNG', () => {
    const b = Buffer.alloc(32);
    b.writeUInt32BE(0x89504e47, 0);
    b.writeUInt32BE(3000, 16);
    b.writeUInt32BE(1200, 20);
    expect(parse(b)).toEqual({ width: 3000, height: 1200 });
  });
});

describe('image loader', () => {
  it('wsrv by default, local files untouched, cloudflare option', () => {
    const wsrv = createImageLoader('wsrv');
    expect(wsrv({ src: 'https://cdn.x/a.png', width: 640 })).toBe('https://wsrv.nl/?url=https%3A%2F%2Fcdn.x%2Fa.png&w=640&q=75&output=webp');
    expect(wsrv({ src: '/images/hero.avif', width: 1200 })).toBe('/images/hero.avif?w=1200');
    expect(wsrv({ src: 'https://cdn.x/logo.svg', width: 64 })).toBe('https://cdn.x/logo.svg');
    expect(createImageLoader('cloudflare')({ src: 'https://cdn.x/a.png', width: 320, quality: 60 })).toBe(
      '/cdn-cgi/image/width=320,quality=60,format=auto/https://cdn.x/a.png',
    );
  });
});

describe('check: next/image sizes and LCP hint', () => {
  it('flags unsized tags, accepts fill / width+height, sees preload', () => {
    const src = `import Image from 'next/image';
export default () => (
  <>
    <Image src={a} alt="" fill sizes="100vw" preload />
    <Image src={b} alt="" width={10} height={10} onLoad={() => (x > 1 ? 1 : 2)} />
    <Image
      src={c}
      alt=""
      sizes="50vw"
    />
  </>
);`;
    expect(nextImageIssues(src)).toEqual({ unsized: [6], hasLcpHint: true });
    expect(nextImageIssues(`import Img from 'next/image';\n<Img src={a} alt="" width={1} height={1} loading="lazy" />`).hasLcpHint).toBe(false);
    expect(nextImageIssues(`import Img from 'next/image';\n<Img src={a} alt="" fill loading="eager" />`)).toEqual({ unsized: [], hasLcpHint: true });
  });
});
