import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { kb } from './table.js';

export interface ImagesOptions {
  input: string;
  output: string;
  maxWidth: number;
  quality: number;
  formats: Array<'avif' | 'webp'>;
}

const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif', '.heic', '.heif']);

function list(input: string): string[] {
  const st = statSync(input);
  if (st.isFile()) return [input];
  const out: string[] = [];
  for (const n of readdirSync(input)) {
    if (n.startsWith('.')) continue;
    const p = join(input, n);
    if (statSync(p).isDirectory()) out.push(...list(p));
    else out.push(p);
  }
  return out;
}

/** Resize, strip metadata (EXIF/GPS) and export AVIF + WebP. Prints a before/after table. */
export async function runImages(opts: ImagesOptions): Promise<number> {
  let sharp: any;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp is not installed. Run: npm i -D sharp   (then run this command again)');
    return 1;
  }
  const input = resolve(opts.input);
  const output = resolve(opts.output);
  if (!existsSync(input)) {
    console.error(`Input not found: ${input}`);
    return 1;
  }
  const isFile = statSync(input).isFile();
  const files = list(input);
  const rows: string[][] = [];
  let before = 0;
  let after = 0;

  for (const f of files) {
    const ext = extname(f).toLowerCase();
    const rel = isFile ? basename(f) : relative(input, f);
    const outBase = join(output, rel.slice(0, rel.length - ext.length));
    mkdirSync(dirname(outBase), { recursive: true });
    const size = statSync(f).size;
    if (ext === '.svg') {
      copyFileSync(f, `${outBase}.svg`);
      rows.push([rel, kb(size), '-', 'svg copied', '', '']);
      continue;
    }
    if (!RASTER.has(ext)) continue;
    before += size;
    try {
      const img = sharp(f, { animated: ext === '.gif' }).rotate();
      const meta = await img.metadata();
      const resized = img.resize({ width: opts.maxWidth, withoutEnlargement: true });
      const outs: Record<string, number> = {};
      for (const fmt of opts.formats) {
        const target = `${outBase}.${fmt}`;
        const pipeline = resized.clone();
        const info =
          fmt === 'avif'
            ? await pipeline.avif({ quality: Math.max(1, opts.quality - 20), effort: 4 }).toFile(target)
            : await pipeline.webp({ quality: opts.quality, effort: 5 }).toFile(target);
        outs[fmt] = info.size;
      }
      const best = Math.min(...Object.values(outs));
      after += best;
      const w = Math.min(meta.width || 0, opts.maxWidth);
      rows.push([
        rel,
        kb(size),
        `${meta.width}×${meta.height} → ${w}px`,
        outs.avif != null ? kb(outs.avif) : '-',
        outs.webp != null ? kb(outs.webp) : '-',
        `${Math.round((1 - best / size) * 100)}%`,
      ]);
    } catch (e: any) {
      rows.push([rel, kb(size), 'error', String(e?.message || e).slice(0, 40), '', '']);
    }
  }

  const head = ['File', 'Original', 'Size', 'AVIF', 'WebP', 'Saved'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || '').length)));
  const fmt = (r: string[]) => r.map((c, i) => (c || '').padEnd(widths[i]!)).join('  ');
  console.log(`\n${fmt(head)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  rows.forEach((r) => console.log(fmt(r)));
  console.log(`\n${rows.length} file(s): ${kb(before)} → ${kb(after)} (smallest format each). Output: ${output}`);
  console.log('Use the AVIF/WebP files with next/image; do not commit the originals.\n');
  return 0;
}
