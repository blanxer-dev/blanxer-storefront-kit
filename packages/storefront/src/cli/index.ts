#!/usr/bin/env node
import { resolve } from 'node:path';
import { runCheck } from './check.js';
import { runImages } from './images.js';

const HELP = `blanxer-storefront — checks and tools for Blanxer custom sites

Usage:
  blanxer-storefront check [dir] [--lighthouse <url>[,<url>…]] [--offline] [--no-worker-size] [--json]
      Required routes, no secrets (source, env, .next, .open-next), no customer-login calls,
      order/payment calls only from the browser, image budget, next/image, store data,
      Worker size (after an OpenNext build) and optional Lighthouse. Exits 1 on any failure.

  blanxer-storefront images <in> <out> [--max-width 2560] [--quality 75] [--formats avif,webp]
      Resize, strip EXIF/GPS and write AVIF + WebP copies. Prints a before/after size table.
      Sizes: hero 2560, banner 1600, card 800.
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  if (cmd === 'check') {
    const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--lighthouse'));
    const lh = flag(args, '--lighthouse');
    return runCheck({
      dir: resolve(positional[0] || '.'),
      lighthouse: lh ? lh.split(',').filter(Boolean) : undefined,
      offline: args.includes('--offline'),
      workerSize: !args.includes('--no-worker-size'),
      json: args.includes('--json'),
    });
  }
  if (cmd === 'images') {
    const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));
    if (positional.length < 2) {
      console.error('Usage: blanxer-storefront images <in> <out> [--max-width 2560] [--quality 75]');
      return 1;
    }
    const formats = (flag(args, '--formats') || 'avif,webp').split(',').filter((f) => f === 'avif' || f === 'webp') as Array<'avif' | 'webp'>;
    return runImages({
      input: positional[0]!,
      output: positional[1]!,
      maxWidth: Number(flag(args, '--max-width')) || 2560,
      quality: Number(flag(args, '--quality')) || 75,
      formats: formats.length ? formats : ['avif', 'webp'],
    });
  }
  console.error(`Unknown command: ${cmd}\n`);
  console.log(HELP);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
