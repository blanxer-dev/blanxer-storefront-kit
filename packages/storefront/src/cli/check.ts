import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { imageSize } from './image-size.js';
import { kb, printTable, type Row } from './table.js';

export interface CheckOptions {
  dir: string;
  lighthouse?: string[];
  offline?: boolean;
  workerSize?: boolean;
  json?: boolean;
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.open-next', '.git', '.wrangler', '.vercel', '.turbo', 'dist', 'coverage', 'out']);

function walk(dir: string, opts: { skip?: Set<string>; maxFiles?: number } = {}, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if ((opts.skip || SKIP_DIRS).has(name)) continue;
      walk(p, opts, acc);
    } else acc.push(p);
    if (opts.maxFiles && acc.length > opts.maxFiles) break;
  }
  return acc;
}

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

// ------------------------------------------------------------------ routes

/** The routes every BlanxerAPI site has (contract). */
export const REQUIRED_ROUTES = [
  '/checkout',
  '/payment/success',
  '/payment/failed',
  '/track/[]',
  '/',
  '/products',
  '/product/[]',
  '/collections/[]',
  '/brand/[]',
  '/brands',
  '/search',
  '/sale',
  '/cart',
  '/forms/[]',
  '/blogs',
  '/blog/[]',
  '/sitemap.xml',
  '/sitemap-catalog.xml',
  '/robots.txt',
];
const FORBIDDEN_ROUTES = ['/account', '/login', '/signup', '/wishlist', '/rewards', '/p/[]'];
const pretty = (r: string) => r.replace(/\[\]/g, r.startsWith('/track') ? '[id]' : '[slug]');

/** Route paths from an App Router directory (route groups and parallel slots removed, dynamic names normalised to []). */
export function collectRoutes(appDir: string): Set<string> {
  const out = new Set<string>();
  for (const f of walk(appDir)) {
    const rel = relative(appDir, f).split(sep);
    const file = rel.pop()!;
    const stem = file.replace(/\.(tsx|ts|jsx|js|mdx)$/, '');
    const segs = rel.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')).map((s) => (/^\[.*\]$/.test(s) ? '[]' : s));
    const route = `/${segs.join('/')}`.replace(/\/+$/, '') || '/';
    if (['page', 'route'].includes(stem) && SOURCE_EXT.has(extname(file))) out.add(route);
    // metadata file conventions
    if (stem === 'robots' && segs.length === 0) out.add('/robots.txt');
    if (stem === 'sitemap' && SOURCE_EXT.has(extname(file))) out.add(`${route === '/' ? '' : route}/sitemap.xml`);
  }
  return out;
}

/** The `page.*` file serving `route` (route groups ignored), or null. */
export function findPageFile(appDir: string, route: string): string | null {
  for (const f of walk(appDir)) {
    const rel = relative(appDir, f).split(sep);
    const file = rel.pop()!;
    if (!/^page\.(tsx|ts|jsx|js)$/.test(file)) continue;
    const segs = rel.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')).map((s) => (/^\[.*\]$/.test(s) ? '[]' : s));
    if ((`/${segs.join('/')}`.replace(/\/+$/, '') || '/') === route) return f;
  }
  return null;
}

const RESOLVE_EXT = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function resolveLocalImport(fromFile: string, spec: string, root: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('@/') || spec.startsWith('~/')) base = existsSync(join(root, 'src')) ? join(root, 'src', spec.slice(2)) : join(root, spec.slice(2));
  else return null;
  for (const ext of RESOLVE_EXT) {
    const p = base + ext;
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Does `file` (or a local module it imports, up to 3 levels deep) render the
 * package's `<Checkout>` from `@blanxer-dev/storefront/react`?
 */
export function rendersPackageCheckout(file: string, root: string, depth = 0, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const t = read(file);
  const imp = /import\s*\{([^}]*)\}\s*from\s*['"]@blanxer-dev\/storefront\/react['"]/g;
  let m: RegExpExecArray | null;
  while ((m = imp.exec(t))) {
    for (const part of m[1]!.split(',')) {
      const mm = /^\s*Checkout(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (!mm) continue;
      const local = mm[1] || 'Checkout';
      if (new RegExp(`<${local.replace(/\$/g, '\\$')}[\\s/>]`).test(t)) return true;
    }
  }
  if (/export\s*\{[^}]*\bCheckout\b[^}]*\}\s*from\s*['"]@blanxer-dev\/storefront\/react['"]/.test(t)) return true;
  if (depth >= 3) return false;
  const specs = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  while ((m = specs.exec(t))) {
    const next = resolveLocalImport(file, m[1]!, root);
    if (next && rendersPackageCheckout(next, root, depth + 1, seen)) return true;
  }
  return false;
}

/** Opening JSX tags `<Name …>` in `src` (attribute text included, braces respected). */
export function jsxTags(src: string, name: string): Array<{ attrs: string; line: number }> {
  const out: Array<{ attrs: string; line: number }> = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = '';
    for (; i < src.length; i++) {
      const ch = src[i]!;
      if (quote) {
        if (ch === quote && src[i - 1] !== '\\') quote = '';
        continue;
      }
      if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    out.push({ attrs: src.slice(m.index + m[0].length, i), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** next/image usage in one file: tags without a size, and whether any tag is marked as the LCP image. */
export function nextImageIssues(src: string): { unsized: number[]; hasLcpHint: boolean } {
  const unsized: number[] = [];
  let hasLcpHint = false;
  const names = new Set<string>();
  const def = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]next\/image['"]/g;
  let m: RegExpExecArray | null;
  while ((m = def.exec(src))) names.add(m[1]!);
  if (/from\s*['"]@blanxer-dev\/storefront\/react['"]/.test(src) && /\bBlanxerImage\b/.test(src)) names.add('BlanxerImage');
  for (const name of names) {
    for (const tag of jsxTags(src, name)) {
      const a = tag.attrs;
      if (/\{\s*\.\.\./.test(a)) continue; // spread props: can't tell
      const fill = /(?:^|\s)fill(?:\s|$|=\{true\}|\/)/.test(a);
      if (!fill && !(/\bwidth=/.test(a) && /\bheight=/.test(a))) unsized.push(tag.line);
      if (/(?:^|\s)(?:preload|priority)(?:\s|$|=\{|\/)|fetchPriority=|loading=\{?['"]eager/.test(a)) hasLcpHint = true;
    }
  }
  return { unsized, hasLcpHint };
}

export function findAppDir(root: string): string | null {
  for (const c of ['src/app', 'app']) if (existsSync(join(root, c))) return join(root, c);
  return null;
}

// ------------------------------------------------------------------ secrets

interface Pattern {
  name: string;
  re: RegExp;
}

/** Specific enough to scan build output and env files. */
export const SECRET_PATTERNS: Pattern[] = [
  { name: 'Blanxer API key (sk_…)', re: /\bsk_(?:live|test)?_?[A-Za-z0-9]{20,}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  {
    name: 'payment gateway secret',
    re: /\b(?:ESEWA|KHALTI|FONEPAY|NPX|NABIL|NBANK|CYBERSOURCE|CONNECTIPS)[A-Z_]*(?:SECRET|KEY|TOKEN|PASSWORD)\s*[=:]\s*['"]?[A-Za-z0-9+/=_\-]{8,}/i,
  },
  {
    name: 'gateway/plugin secret value',
    re: /["'](?:esewa_secret|esewa_scd|khalti_secret_key|khalti_public_key|fonepay_secret_key|fonepay_merchant_id|fonepay_static_secret|fonepay_dynamic_key|fonepay_checkout_key|npx_key|nbank_token|cybersource_token|qr_request_key|client_secret|secret_key|private_key)["']\s*:\s*["'](?!yes["'])[^"']{6,}["']/,
  },
  { name: 'plugin/integration token', re: /["']token["']\s*:\s*["'][A-Za-z0-9+/=_\-.]{16,}["']/ },
  { name: 'Blanxer login / MCP token', re: /\b(?:BLANXER|MCP)_(?:PASSWORD|TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|SECRET|API_KEY)\s*[=:]\s*['"]?[^\s'"]{6,}/i },
];

/** Looser patterns for hand-written source and env files only. */
const SOURCE_ONLY_PATTERNS: Pattern[] = [
  { name: 'hard-coded password', re: /\bpassword\s*[:=]\s*['"][^'"\s]{4,}['"]/i },
  { name: 'JWT / bearer token', re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Authorization header', re: /Authorization['"]?\s*:\s*['"`]Bearer\s+[A-Za-z0-9._-]{12,}/ },
];

function scanSecrets(files: string[], patterns: Pattern[], root: string, maxBytes = 8 * 1024 * 1024) {
  const hits: string[] = [];
  for (const f of files) {
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      continue;
    }
    if (size > maxBytes) continue;
    const text = read(f);
    if (!text) continue;
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        hits.push(`${relative(root, f)}:${line} — ${p.name}`);
      }
    }
  }
  return hits;
}

const TEXT_BUILD_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.rsc', '.txt', '.body', '.meta', '.css']);

function buildFiles(root: string): string[] {
  const out: string[] = [];
  const next = join(root, '.next');
  if (existsSync(next)) {
    for (const d of ['server', 'static']) out.push(...walk(join(next, d), { skip: new Set(['cache']) }));
    for (const f of ['required-server-files.json', 'routes-manifest.json']) if (existsSync(join(next, f))) out.push(join(next, f));
  }
  const on = join(root, '.open-next');
  if (existsSync(on)) {
    out.push(...walk(join(on, 'assets'), { skip: new Set(['node_modules']) }));
    if (existsSync(join(on, 'worker.js'))) out.push(join(on, 'worker.js'));
    out.push(...walk(join(on, 'server-functions'), { skip: new Set(['node_modules', 'cache']) }));
  }
  return out.filter((f) => TEXT_BUILD_EXT.has(extname(f)) || !extname(f));
}

// ------------------------------------------------------------------ main

const hasUseClient = (src: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(src);
const hasUseServer = (src: string) => /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use server['"]/.test(src) || /['"]use server['"]/.test(src);
const ROUTE_FILE = /(?:^|[\\/])(page|layout|template|default|not-found|route|loading|head|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(tsx|ts|jsx|js)$/;

export async function runCheck(opts: CheckOptions): Promise<number> {
  const root = opts.dir;
  const rows: Row[] = [];
  const add = (status: Row['status'], check: string, detail: string) => rows.push({ status, check, detail });

  const appDir = findAppDir(root);
  if (!appDir || !existsSync(join(root, 'package.json'))) {
    add('FAIL', 'Next.js app', `No app/ or src/app/ directory under ${root}. Run the check from your site folder.`);
    printTable(rows);
    return 1;
  }

  const pkg = JSON.parse(read(join(root, 'package.json')) || '{}');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  add(deps.next ? 'PASS' : 'FAIL', 'Next.js', deps.next ? `next ${deps.next}, App Router (${relative(root, appDir)})` : 'next is not a dependency');
  add(deps['@blanxer-dev/storefront'] ? 'PASS' : 'FAIL', '@blanxer-dev/storefront', deps['@blanxer-dev/storefront'] ? `using ${deps['@blanxer-dev/storefront']}` : 'the site must use @blanxer-dev/storefront for checkout and data');

  // routes
  const routes = collectRoutes(appDir);
  const missing = REQUIRED_ROUTES.filter((r) => !routes.has(r));
  add(
    missing.length ? 'FAIL' : 'PASS',
    'Required routes',
    missing.length ? `missing: ${missing.map(pretty).join(', ')}` : `all ${REQUIRED_ROUTES.length} present (checkout, payment/success, payment/failed, track/[id] …)`,
  );
  const checkoutPage = findPageFile(appDir, '/checkout');
  if (checkoutPage) {
    const ok = rendersPackageCheckout(checkoutPage, root);
    add(
      ok ? 'PASS' : 'FAIL',
      'Checkout from the package',
      ok
        ? `${relative(root, checkoutPage)} renders <Checkout> from @blanxer-dev/storefront/react`
        : `${relative(root, checkoutPage)} must render <Checkout> from @blanxer-dev/storefront/react (theme it, don't rewrite it)`,
    );
  }
  const forbidden = FORBIDDEN_ROUTES.filter((r) => routes.has(r) || [...routes].some((x) => x.startsWith(`${r}/`)));
  add(forbidden.length ? 'FAIL' : 'PASS', 'No account/login pages', forbidden.length ? `remove: ${forbidden.map(pretty).join(', ')}` : 'none');

  // source files
  const srcFiles = walk(root).filter((f) => SOURCE_EXT.has(extname(f)));
  const envFiles = readdirSync(root)
    .filter((n) => n.startsWith('.env') || n === '.dev.vars' || /^wrangler\.(jsonc?|toml)$/.test(n))
    .map((n) => join(root, n));

  // secrets
  const srcHits = scanSecrets([...srcFiles, ...envFiles], [...SECRET_PATTERNS, ...SOURCE_ONLY_PATTERNS], root);
  add(srcHits.length ? 'FAIL' : 'PASS', 'No secrets in source/env', srcHits.length ? srcHits.slice(0, 8).join('\n') : `${srcFiles.length} source + ${envFiles.length} env/config files scanned`);
  const built = buildFiles(root);
  if (built.length) {
    const buildHits = scanSecrets(built, SECRET_PATTERNS, root);
    add(buildHits.length ? 'FAIL' : 'PASS', 'No secrets in build output', buildHits.length ? buildHits.slice(0, 8).join('\n') : `${built.length} files in .next/.open-next scanned`);
  } else add('SKIP', 'No secrets in build output', 'no .next or .open-next yet (run the build, then check again)');

  // no login code
  const authHits: string[] = [];
  for (const f of [...srcFiles, ...built]) {
    const t = read(f);
    const m = /\/customer\/(?:auth|account|wishlist|rewards)\b/.exec(t);
    if (m) authHits.push(`${relative(root, f)}:${t.slice(0, m.index).split('\n').length}`);
  }
  add(authHits.length ? 'FAIL' : 'PASS', 'No customer login calls', authHits.length ? `/customer/auth|account|wishlist|rewards in: ${authHits.slice(0, 6).join(', ')}` : 'no /customer/auth, /customer/account, wishlist or rewards');

  // browser-only order/payment calls
  const serverImports: string[] = [];
  const softImports: string[] = [];
  const directCalls: string[] = [];
  for (const f of srcFiles) {
    const t = read(f);
    const rel = relative(root, f);
    if (/['"]@blanxer-dev\/storefront\/client['"]/.test(t) && !hasUseClient(t)) {
      if (ROUTE_FILE.test(f) || hasUseServer(t) || /(?:^|[\\/])middleware\.|(?:^|[\\/])proxy\./.test(f)) serverImports.push(rel);
      else softImports.push(rel);
    }
    const d = /['"`][^'"`\n]*\/(?:payment\/(?:esewa|khalti|fonepay|fonepay_checkout|dynamic_qr|static_qr|npx|nabil_card|card)\/|order\/public\/release-hold|public\/coupon\b)/.exec(t);
    if (d) directCalls.push(`${rel}:${t.slice(0, d.index).split('\n').length}`);
    if (/fetch\([^)]*\/order\/\$\{/.test(t)) directCalls.push(`${rel} (POST /order)`);
  }
  if (serverImports.length) add('FAIL', 'Order/payment calls are browser-only', `@blanxer-dev/storefront/client imported by server code: ${serverImports.join(', ')}`);
  else if (softImports.length)
    add('WARN', 'Order/payment calls are browser-only', `imported by files without "use client" (fine only if they are used from client components): ${softImports.join(', ')}`);
  else add('PASS', 'Order/payment calls are browser-only', '@blanxer-dev/storefront/client is only imported from "use client" files');
  add(
    directCalls.length ? 'FAIL' : 'PASS',
    'Checkout logic not re-implemented',
    directCalls.length ? `direct order/payment/coupon API calls (use the package): ${directCalls.slice(0, 6).join(', ')}` : 'no direct payment/coupon/hold API calls',
  );

  // images
  const pub = join(root, 'public');
  const tooBig: string[] = [];
  const tooWide: string[] = [];
  const legacy: string[] = [];
  const legacyWarn: string[] = [];
  const media: string[] = [];
  let pubCount = 0;
  let pubBytes = 0;
  for (const f of walk(pub)) {
    const ext = extname(f).toLowerCase();
    const size = statSync(f).size;
    const rel = relative(root, f);
    if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(ext)) {
      pubCount++;
      pubBytes += size;
      if (size > 300 * 1024) tooBig.push(`${rel} (${kb(size)})`);
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        const dim = imageSize(f);
        if (dim && dim.width > 2560) tooWide.push(`${rel} (${dim.width}px)`);
      }
      if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        const stem = f.slice(0, -ext.length);
        const iconLike = /(?:^|[-_/\\])(?:favicon|icon|apple-touch|android-chrome|mstile|og|opengraph|twitter)/i.test(basename(f));
        if (existsSync(`${stem}.webp`) || existsSync(`${stem}.avif`)) legacy.push(`${rel} (an AVIF/WebP copy exists — delete the original)`);
        else if (!iconLike && size > 20 * 1024) legacy.push(`${rel} (${kb(size)} — convert with blanxer-storefront images)`);
        else if (!iconLike) legacyWarn.push(rel);
      }
      if (ext === '.gif' && size > 50 * 1024) media.push(`${rel} (GIF ${kb(size)})`);
    } else if (['.mp4', '.webm', '.mov'].includes(ext)) media.push(`${rel} (video ${kb(size)})`);
  }
  const imgFails = [...tooBig.map((x) => `>300 KB: ${x}`), ...tooWide.map((x) => `>2560 px: ${x}`), ...legacy.map((x) => `JPEG/PNG: ${x}`)];
  add(imgFails.length ? 'FAIL' : 'PASS', 'Image budget (public/)', imgFails.length ? imgFails.slice(0, 10).join('\n') : `${pubCount} images, ${kb(pubBytes)} total, all ≤300 KB / ≤2560 px, AVIF/WebP`);
  if (legacyWarn.length) add('WARN', 'Small JPEG/PNG files', `consider WebP/SVG: ${legacyWarn.slice(0, 6).join(', ')}`);
  if (media.length) add('WARN', 'Heavy media', `${media.slice(0, 6).join(', ')} — autoplay video / GIF banners cost speed`);

  // <img> tags
  const imgTags: string[] = [];
  const googleFonts: string[] = [];
  for (const f of srcFiles.filter((x) => ['.tsx', '.jsx'].includes(extname(x)))) {
    const lines = read(f).split('\n');
    lines.forEach((ln, i) => {
      if (/<img[\s>]/.test(ln) && !/no-img-element|bx-allow-img/.test(lines[i - 1] || '') && !/no-img-element|bx-allow-img/.test(ln)) imgTags.push(`${relative(root, f)}:${i + 1}`);
    });
    if (/fonts\.googleapis\.com/.test(lines.join('\n'))) googleFonts.push(relative(root, f));
  }
  add(imgTags.length ? 'FAIL' : 'PASS', 'next/image for images', imgTags.length ? `<img> instead of next/image: ${imgTags.slice(0, 8).join(', ')}` : 'no raw <img> tags');
  const unsized: string[] = [];
  let lcpHint = false;
  for (const f of srcFiles.filter((x) => ['.tsx', '.jsx'].includes(extname(x)))) {
    const r = nextImageIssues(read(f));
    unsized.push(...r.unsized.map((ln) => `${relative(root, f)}:${ln}`));
    lcpHint ||= r.hasLcpHint;
  }
  add(
    unsized.length ? 'FAIL' : 'PASS',
    'next/image sizes',
    unsized.length ? `<Image> without width+height or fill: ${unsized.slice(0, 8).join(', ')}` : 'every <Image> has width+height or fill',
  );
  if (!lcpHint) add('WARN', 'LCP image', 'no <Image> has preload / fetchPriority / loading="eager": mark each page\'s first big image');
  if (googleFonts.length) add('WARN', 'Fonts via next/font', `Google Fonts <link> in ${googleFonts.join(', ')} — use next/font`);

  // env + live store
  let lighthouseProductPath = '';
  const envText = envFiles.map(read).join('\n');
  const storeHandle = process.env.BLANXER_STORE || /^\s*BLANXER_STORE\s*=\s*["']?([^"'\s#]+)/m.exec(envText)?.[1] || /"BLANXER_STORE"\s*:\s*"([^"]+)"/.exec(envText)?.[1];
  const apiBase = (process.env.BLANXER_API || /^\s*BLANXER_API\s*=\s*["']?([^"'\s#]+)/m.exec(envText)?.[1] || 'https://api.blanxer.com').replace(/\/+$/, '');
  if (!storeHandle) add('FAIL', 'BLANXER_STORE', 'not set in the environment, .env* or wrangler config');
  else if (opts.offline) add('SKIP', 'Store data', `BLANXER_STORE=${storeHandle} (offline: not fetched)`);
  else {
    try {
      const ctl = AbortSignal.timeout(15000);
      const res = await fetch(`${apiBase}/store/check_domain?domain=${encodeURIComponent(storeHandle)}`, { signal: ctl });
      const store: any = res.ok ? await res.json() : null;
      if (!store?._id) add('FAIL', 'Store data', `no store for "${storeHandle}" at ${apiBase} (HTTP ${res.status})`);
      else {
        const dres = await fetch(`${apiBase}/public/delivery_charge/${store._id}`, { signal: AbortSignal.timeout(15000) });
        const delivery: any = dres.ok ? await dres.json() : { places: [] };
        const { paymentMethodsFor } = await import('../core/payments.js');
        const { isCodAllowed } = await import('../core/delivery.js');
        const places = (delivery?.places || []) as any[];
        const codPlaces = places.filter((p) => isCodAllowed(p?.[1])).length;
        const online = paymentMethodsFor(store, { codAllowed: false }).map((m) => m.name);
        if (opts.lighthouse?.length) {
          try {
            const pres = await fetch(`${apiBase}/product/p/public/${store._id}?page=1&per_page=1`, { signal: AbortSignal.timeout(15000) });
            const slug = pres.ok ? (await pres.json())?.products?.[0]?.slug : '';
            if (slug) lighthouseProductPath = `/product/${encodeURIComponent(slug)}`;
          } catch {
            /* product page skipped */
          }
        }
        add(
          'PASS',
          'Store data',
          `${store.customization?.brand_name || store.name} (${store.sub_domain}, plan ${store.plan || 'free'}) via ${apiBase}\n` +
            `${places.length} delivery places (${codPlaces} with COD); online methods: ${online.length ? online.join(', ') : 'none (COD only)'}` +
            (store.storefront_url ? `\nstorefront_url: ${store.storefront_url}` : '\nstorefront_url not set yet (link the site after deploy)'),
        );
      }
    } catch (e: any) {
      add('WARN', 'Store data', `could not reach ${apiBase}: ${e?.message || e}`);
    }
  }

  // worker size
  const workerJs = join(root, '.open-next', 'worker.js');
  if (existsSync(workerJs) && opts.workerSize !== false) {
    const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
    const alt = join(root, '..', '..', 'node_modules', '.bin', 'wrangler');
    const bin = existsSync(wrangler) ? wrangler : existsSync(alt) ? alt : null;
    if (bin) {
      const r = spawnSync(bin, ['deploy', '--dry-run', '--outdir', join(root, '.wrangler', 'dry-run')], { cwd: root, encoding: 'utf8', timeout: 180000 });
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      const m = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/i.exec(out);
      if (m) {
        const gz = Number(m[2]) * 1024;
        const raw = Number(m[1]) * 1024;
        add(gz > 3 * 1024 * 1024 ? 'WARN' : 'PASS', 'Worker size', `${kb(raw)} uncompressed / ${kb(gz)} gzip (free plan limit 3 MiB gzip, paid 10 MiB)`);
      } else add('WARN', 'Worker size', `wrangler dry-run did not report a size${r.status ? ` (exit ${r.status})` : ''}`);
    } else add('SKIP', 'Worker size', 'wrangler not installed');
  }

  // lighthouse
  if (opts.lighthouse?.length) {
    let urls = opts.lighthouse;
    // A bare origin means "the pages that matter": home, one product page and checkout.
    if (urls.length === 1) {
      try {
        const u = new URL(urls[0]!);
        if (u.pathname === '/' && !u.search) {
          const o = u.origin;
          urls = [`${o}/`, ...(lighthouseProductPath ? [`${o}${lighthouseProductPath}`] : []), `${o}/checkout`];
        }
      } catch {
        /* not a URL: use as given */
      }
    }
    for (const url of urls) {
      const r = spawnSync('npx', ['--yes', 'lighthouse', url, '--only-categories=performance', '--form-factor=mobile', '--output=json', '--quiet', '--chrome-flags=--headless=new'], {
        encoding: 'utf8',
        timeout: 240000,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.status !== 0 || !r.stdout) {
        add('FAIL', `Lighthouse ${url}`, `lighthouse did not run${r.status != null ? ` (exit ${r.status})` : ''}: it needs Chrome and the site running (next build && next start). ${String(r.stderr || '').trim().split('\n').pop() || ''}`.trim());
        continue;
      }
      try {
        const rep = JSON.parse(r.stdout);
        const score = Math.round((rep.categories?.performance?.score || 0) * 100);
        const lcp = rep.audits?.['largest-contentful-paint']?.numericValue || 0;
        const ok = score >= 90 && lcp < 2500;
        add(ok ? 'PASS' : 'FAIL', `Lighthouse ${url}`, `mobile performance ${score}, LCP ${(lcp / 1000).toFixed(2)} s (need ≥90 and <2.5 s)`);
      } catch {
        add('WARN', `Lighthouse ${url}`, 'could not read the report');
      }
    }
  }

  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const warns = rows.filter((r) => r.status === 'WARN').length;
  if (opts.json) console.log(JSON.stringify({ ok: fails === 0, rows }, null, 2));
  else {
    console.log(`\nblanxer-storefront check — ${root}\n`);
    printTable(rows);
    console.log(fails ? `\n✗ ${fails} check(s) failed, ${warns} warning(s). Fix the failures before deploying.\n` : `\n✓ All checks passed (${warns} warning(s)).\n`);
  }
  return fails ? 1 : 0;
}
