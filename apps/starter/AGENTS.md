# AGENTS.md — Blanxer store website (BlanxerAPI)

This project is a Blanxer store website: Next.js 16 App Router + `@blanxer-dev/storefront`, deployed to Cloudflare Workers. Every coding agent working here follows these rules and steps. Full docs: https://developers.blanxer.com/llms.txt

The merchant gets their own Next.js website. **Blanxer stays the admin**: products, stock, orders, payments, delivery and SEO data live in Blanxer and are read through the public API. The site is the front end only, deployed to **the merchant's own Cloudflare account**.

Three channels, each with one job:

| Channel | Who | What for |
|---|---|---|
| Public API `https://api.blanxer.com` (no key) | the **site's code** | read store, catalog, delivery table; place orders and payments from the browser |
| Blanxer MCP `https://mcp.blanxer.com/mcp` (OAuth) | **you**, in this chat | change the store: SEO text, products, photos, categories, coupons, delivery, the website link |
| Blanxer-served XML | Google / Meta | product feed and catalog sitemap, built by Blanxer for the site's domain |

The full docs are at https://developers.blanxer.com (agent index: https://developers.blanxer.com/llms.txt). Fetch a page when a step below points to it.

## Hard rules (follow every time)

1. **Next.js only.** TypeScript, App Router. If asked for another framework, say BlanxerAPI supports Next.js and continue in Next.js.
2. **Start from the starter and keep `@blanxer-dev/storefront`.** Restyle the checkout through its theme props, CSS variables and wrappers. **Never rewrite** the payment, delivery, coupon or order logic, and never call payment endpoints yourself. The checkout's **"Checkout Powered by Blanxer"** line is part of it: restyle it through `.bx-powered-by`, never remove or hide it. Keep the root layout's metadata from `storeMetadata`: its `generator: Blanxer Storefront` and `blanxer-store` tags are how Blanxer confirms the saved website link is this store's site.
3. **Required routes, exact paths:** `/checkout`, `/payment/success`, `/payment/failed`, `/track/[id]`. Payment gateways send the shopper back to the last three; missing ones mean a 404 **after paying**.
4. **The site sends its own origin as `url`** on orders and payments. The package does it; never hardcode a domain.
5. **Orders, coupons, the offers cart quote, payment starts, hold release, back-in-stock, forms, cancel and review run in the browser** (client components via `@blanxer-dev/storefront/client` or `/react`). Never from server components, route handlers or server actions: they are rate-limited per shopper IP.
6. **No secrets in the site.** It needs no key. Never put an `sk_` API key, MCP token, dashboard login or gateway key in code, `.env` or the build. Never ask the merchant to paste a key. Store changes go through the Blanxer MCP.
7. **No customer login.** Don't call `/customer/auth/*` or build account, login, wishlist or rewards pages. Custom sites use guest checkout.
8. **Don't invent data.** Prices, stock, delivery charges and payment methods come only from the API. No sample products or placeholder prices in the deployed site.
9. **Payment methods come from the store's settings** via the package. Never add or remove them by hand.
10. **Use Blanxer's URL paths**: `/product/[slug]`, `/collections/[slug]`, `/brand/[slug]`, `/blogs`, `/blog/[slug]`, `/forms/[slug]`. The feed, sitemap, SMS and emails use them. **Don't build a product feed or catalog sitemap**: Blanxer serves both for the site's domain. Keep the starter's `/sitemap-catalog.xml` pass-through and `/sitemap.xml` index; only add the site's own extra pages to the index.
11. **Optimise every image before it goes into the site** (see https://developers.blanxer.com/api-docs/images-and-speed.md): `npx blanxer-storefront images`, AVIF + WebP, ×2 the largest display size, metadata stripped, `next/image` with width/height, `preload` only on each page's main (largest, first) image (Next.js 16 replaced `priority` with `preload`). **Product photos go into Blanxer through the MCP, never into the site.** No autoplay video backgrounds or GIF banners unless the merchant insists after hearing the speed cost. Fonts through `next/font`, at most 2 families.
12. **The site's design lives in the site.** Don't use MCP page-builder or section tools (`blanxer_add_section`, `blanxer_update_section`, `blanxer_apply_page_template`, navigation/footer editors) to design a custom site; they change the Blanxer-hosted site. Exception: blog post bodies. `blanxer_create_blog_post` makes an empty post, and its body is written with `blanxer_add_section` / `blanxer_update_section` using `{ post_id }`. That is content the site shows, so use them for blog posts. **The design comes from the merchant's brief** (step 2): ask for reference sites first, and don't copy the Blanxer-hosted storefront unless they ask.
13. **Offers: prices come from the server's quote. Never compute a discount.** For stores on Blanxer's Offers plugin (`useOffers().enabled`, from `GET /public/promotions/:store_id`), every cart total, line saving, gift line, free delivery and code result comes from the quote (`useCartQuote()` / `quoteCart`, `POST /public/promotions/:store_id/quote`). Don't add up discounts, apply percentages, work out tier prices or decide whether a code applies in the site's code: show the quote's `totals`, `applications`, `lines` and the server's `messages` text. Lines with `added_by` (gifts the server added) are shown with "Free" and never sent back in a quote or an order. Orders carry `code`, `removed_offers` and `gift_choices` (the package does this). Stores not on Offers (`enabled: false`) keep the coupon flow; keep both paths. Use the package's offer components (`OfferBadges`, `OfferCardHint`, `ProductOffers`, `OffersList`, `OfferTopBar`, `OffersLink`; `CartView` and `Checkout` switch on their own) or build your own from `useOffers` / `useCartQuote`, and respect the store's offer display settings (`useOffers().display`).
14. **Confirm before bulk store changes.** Show the merchant the list (SEO for many products, imports, delivery charges) and get a yes. The MCP's own confirmations still apply.

## Steps (confirm each with the merchant before moving on)

**Keep a progress file.** As soon as the site's folder exists, keep `BLANXER-PROGRESS.md` in it: the store, the design brief, what's decided and the step you're on. Update it after every step. If a session starts without the earlier conversation (the merchant restarted, or says "let's continue the website"), read it first and carry on from there instead of starting over.

### 1. Connect the Blanxer MCP first, then find the store
- **Before anything else, make sure the Blanxer MCP is connected**, so the merchant never has to restart in the middle of the work:
  - **Its tools (`blanxer_…`) are already there:** if they need a sign-in, the merchant runs `/mcp`, picks `blanxer` and signs in to Blanxer in the browser. No restart.
  - **Not there:** add it: `claude mcp add --transport http blanxer https://mcp.blanxer.com/mcp`, or install the skill (`/plugin marketplace add blanxer-dev/blanxer-agent-skills`, then `/plugin install blanxer-website@blanxer`). **Claude Code only loads a new MCP server when it starts**, so ask the merchant to restart **now**, while nothing is lost: type `/exit`, then run `claude -c` from the same folder Claude Code was started in. `claude -c` reopens this same conversation with its history. Give them the exact line (`cd <that folder> && claude -c`). Then `/mcp` → `blanxer` → sign in.
  - **Other agents:** Codex resumes with `codex resume --last`. Cursor, Gemini CLI and claude.ai: add `https://mcp.blanxer.com/mcp` as a remote MCP server. If the tool needs a restart, write `BLANXER-PROGRESS.md` first.
- Ask for the store subdomain (`mystore` in `mystore.blanxer.io`) or its link.
- Read `https://api.blanxer.com/store/check_domain?domain=<subdomain>`. Show: store name, plan, product count (`/product/public/<_id>` length), and the payment methods the site will offer (rules in https://developers.blanxer.com/api-docs/checkout.md).
  - Plan not in `basic / premium / plus / platinum` → "your site will take Cash on Delivery only".
  - `customer_program.enabled` → "shoppers check out as guests on the new site".
- Run `blanxer_audit_seo` and look for catalog gaps (products without photos, prices, categories or SEO text). Show what's missing; fix later in step 4.

### 2. Design brief (ask, don't copy)
**Ask the merchant before you design anything:**
- 2–3 websites whose look they like (links or screenshots), or "something like <brand>";
- colours and mood, the pages they need, the tone, and any must-haves.

No references? Offer 3 short, clearly different style directions and let them pick.

**Don't copy their current Blanxer-hosted storefront** (its layout, its sections, or `blanxer_get_site_design`). They are building a new site because they want something different. Reuse it only if they ask to keep their current look. Offer the store's logo, colours (`customization.theme`) and font (`customization.font`) as defaults, not as the design. Agree on a short page list and write the brief into `BLANXER-PROGRESS.md` before building.

### 3. Scaffold
```bash
npx degit blanxer-dev/blanxer-storefront-starter <folder>
cd <folder>
cp .env.example .env    # set BLANXER_STORE=<subdomain>; optional SITE_URL once the domain is known
npm install
./node_modules/.bin/next dev
```
Show the merchant the starter running with their real products before changing the design.

### 4. Build
- Pages and design with the package's data functions (`@blanxer-dev/storefront/server`) and components (`@blanxer-dev/storefront/react`). Theme the checkout; don't rewrite it.
- Page metadata from `@blanxer-dev/storefront/seo` (`productMetadata`, `categoryMetadata`, ...). SEO text is edited in Blanxer, not in the code.
- Images: rule 11. Show a before/after size table, e.g. `hero.jpg 6.2 MB → hero.avif 180 KB`.
- Store fixes through the MCP, confirmed first (rule 14): product and category SEO text, categories and brands the menus need, product photos the merchant sends, launch offers or coupons, delivery places/charges. They reach the site through the API (allow ~60 s cache).

### 5. Check before deploy
```bash
./node_modules/.bin/next build
npx blanxer-storefront check            # with ./node_modules/.bin/next start running: add --lighthouse http://localhost:3000
```
It must pass: required routes, no secrets, no login code, browser-only order/payment calls, image budget (no file in `public/` over 300 KB or wider than 2560 px, no JPEG/PNG where AVIF/WebP fits, every image `next/image` with a size, a `preload` main image), Lighthouse mobile ≥ 90 with LCP < 2.5 s on home, a product page and checkout. Fix failures before deploying, or tell the merchant why one can't be fixed.

### 6. Test checkout
- Stores on Offers: put a few products in the bag and check that the bag and checkout totals equal the server's quote (`POST /public/promotions/<store_id>/quote` with the same products, code and place), that a gift line shows as "Free", and that `/offers` lists the live offers.
On the local production build:
- Fill the checkout with phone `0000000000`: the API answers success **without creating an order** and the checkout shows "Test order accepted". This proves the form, delivery charge, coupon and order request work. (Because no order exists, no gateway or QR screen opens on this path.)
- Check every enabled payment method appears for a COD and a non-COD place as expected (rules in https://developers.blanxer.com/api-docs/checkout.md).
- Open `/payment/success`, `/payment/failed` and `/track/<any order id>` directly: they must render.
- The gateway and QR screens themselves are checked once, live, in step 12.

### 7. Cloudflare sign-in
```bash
npx wrangler login
```
The browser opens and **the merchant signs in to their own Cloudflare account** and approves. You never see a password. No browser available → walk them through creating an API token (Workers edit) and `export CLOUDFLARE_API_TOKEN=...` in their own terminal.
Check the build size first: the Workers free plan allows a 3 MiB (compressed) worker. If it's bigger, say so before deploying and offer trimming or the $5/month Workers paid plan. See https://developers.blanxer.com/api-docs/deploy-cloudflare.md.

### 8. Deploy
First rename the worker: in `wrangler.jsonc` change `"name": "blanxer-storefront"` to the site's name (e.g. `mystore-site`) and the `WORKER_SELF_REFERENCE` service to match. `.env` is copied into the Worker, so `BLANXER_STORE` must be set there.
```bash
./node_modules/.bin/opennextjs-cloudflare build && ./node_modules/.bin/opennextjs-cloudflare deploy
```
Print the live `*.workers.dev` link and open it.

### 9. Link the site to Blanxer
- Save the link with `blanxer_set_storefront_url { url: "https://..." }`. The first call is a preview that returns a `confirm_token`. Show it to the merchant, and after their yes call again with `{ dry_run: false, confirm_token }` (or the merchant pastes it in Blanxer → avatar menu → **BlanxerAPI** → Your website). From then on the tracking link shown in the dashboard, order and delivered emails, flash-sale alerts, the product feed and the sitemap use the new site. (SMS messages use `bxr.sh` short links; whether those follow the new site is not yet confirmed.)
- Register the product feed URL (`https://api.blanxer.com/public/product-feed/<store_id>.xml`) in Meta Commerce Manager / Google Merchant Center.
- Submit `https://<site>/sitemap.xml` in Google Search Console; verify ownership with `blanxer_set_site_verification` (the site renders the tag).

### 10. Custom domain (optional)
Add the domain to the merchant's Cloudflare account and attach it to the Worker (custom domain), then update the link from step 9. If the domain currently points at Blanxer (Blanxer's custom-domain setup), explain that moving it switches shoppers from the Blanxer site to the new one; that's the merchant's decision. See https://developers.blanxer.com/api-docs/deploy-cloudflare.md.

### 11. Retire the old subdomain site (optional, merchant's choice, only after step 9)
`blanxer_update_appearance { store_visibility: 'hidden_on_subdomain' }` (or Blanxer → Appearance → Branding → Site under construction → Sub-domain). Say plainly: every page on `<sub>.blanxer.io` will show a placeholder, **including tracking links already sent for older orders, and possibly SMS tracking links (`bxr.sh`), which aren't confirmed to follow the new site yet**; new orders link to the new site; it can be switched back any time.

### 12. Live check and hand-over
- On the live site: home, a product, checkout, `/payment/success`, `/payment/failed`, and `/track/<a real order id>`.
- With the merchant's OK and their own phone number, place one COD order on the real store, then cancel it in the Blanxer dashboard.
- For one online method the store uses, start a real order and open the gateway or QR screen, then stop without paying (close the QR screen, which releases the stock hold) and cancel the order in the dashboard.
- Leave a short `README.md` in the project: how to run it locally, change the design, and redeploy (`opennextjs-cloudflare build && opennextjs-cloudflare deploy`).

## When something goes wrong
- 404 after paying → `/payment/success`, `/payment/failed` or `/track/[id]` is missing or renamed.
- "Place not found" / COD refused → the delivery place must be one of the store's places exactly; COD only where that place allows it.
- Coupon refused at order time → the order must carry the coupon's `_id`, not its code (the package does this). Stores on Offers send the code itself (`code`); a refused code comes back as `{ fields: { code } }` and `Checkout` shows it on the code field.
- Bag total differs from what the order charges → something in the site computed a price. Show the quote's numbers only (hard rule 13, Offers).
- `403 error code: 1010` from the API on server-side fetches → make sure the package's fetch (with its User-Agent) is used; report it to Blanxer support.
- More: https://developers.blanxer.com/api-docs/troubleshooting.md

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
