# Blanxer storefront kit

Everything a custom website for a [Blanxer](https://blanxer.com) store needs (BlanxerAPI). Merchants (or an AI agent working for them) build their own Next.js site and deploy it to their own Cloudflare account; Blanxer stays the admin and the checkout stays Blanxer's.

| Folder | What | Published as |
|---|---|---|
| [`packages/storefront`](packages/storefront) | `@blanxer-dev/storefront`: server data functions, browser calls (orders, payments, coupons, holds), React components (cart, product form, the full checkout, payment result and order-tracking pages), SEO helpers, Next route handlers and image loader, and the `blanxer-storefront` CLI (`check`, `images`) | npm [`@blanxer-dev/storefront`](https://www.npmjs.com/package/@blanxer-dev/storefront) |
| [`apps/starter`](apps/starter) | Next.js 16 App Router starter with every required route, store branding, SEO, and the Cloudflare (OpenNext) setup | GitHub [`blanxer-dev/blanxer-storefront-starter`](https://github.com/blanxer-dev/blanxer-storefront-starter) (this folder, copied out) |

Docs: https://developers.blanxer.com · agent index: https://developers.blanxer.com/llms.txt · Claude Code skill: `/plugin marketplace add blanxer-dev/blanxer-agent-skills` then `/plugin install blanxer-website@blanxer`.

## Working in this repo

npm workspaces. The starter depends on `@blanxer-dev/storefront@^0.1.0`, which npm links to `packages/storefront` here and installs from npm when the starter is used on its own.

```bash
npm install
npm run build                          # build the package (dist/)
npm test                               # unit tests (checkout logic, CLI)
cd apps/starter
cp .env.example .env                   # BLANXER_STORE=<subdomain>
npx next build
npx blanxer-storefront check
```

Build the package before the starter: the starter imports the package's `dist/`.

## Publishing

- Package: bump `packages/storefront/package.json` `version`, then `npm publish -w @blanxer-dev/storefront` (runs the build).
- Starter: copy `apps/starter` to `blanxer-dev/blanxer-storefront-starter` and keep its `@blanxer-dev/storefront` range on the published version.
- Keep the checkout in step with the Blanxer storefront: any storefront checkout change needs the same change here (or a note that it isn't needed).

## License

MIT
