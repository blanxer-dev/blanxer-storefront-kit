import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No incremental-cache binding by default, so a new merchant can deploy without
// creating R2/KV resources. Pages render on the Worker and @blanxer-dev/storefront
// keeps catalog reads for 60 s per Worker isolate.
//
// For full ISR on Cloudflare, create a bucket (`npx wrangler r2 bucket create <name>`),
// add the `r2_buckets` binding shown in wrangler.jsonc and use:
//
//   import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
//   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
export default defineCloudflareConfig();
