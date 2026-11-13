# blanxer-storefront-kit — rules for agents

## Feature map: read it before changing a feature

Blanxer's features are linked across six repos (backend, dashboard, app, storefront, storefront kit,
MCP). `docs/feature-map/` says, for every feature, where its code is in each repo, which rules and
tests guard it, what it is linked to, and what each setting needs to keep working.

- **Before changing a feature:** `node scripts/claude/impact.cjs <feature | file | word>`. On a branch,
  `node scripts/claude/impact.cjs` lists every feature the branch touches. A Claude Code hook shows the
  brief the first time you edit a file of a feature.
- **Check every linked feature it lists**, and say in your final report which ones you checked.
- **A setting that needs something else** (another setting, a plugin, a plan, an outlet, a record) must
  stay valid on every path that removes it: switch it off, ignore it at read time or refuse the change,
  with a test per path. Example: advance payment needs an online payment method (rule AP-24).
- **One home only:** the rules in the map's "One home only" table live in one place. Call them; never
  copy them. A client copy shows the backend's answer and has a contract test.
- **Keep the map true in the same PR:** a new feature, folder, link or dependent setting goes into
  `docs/feature-map/feature-map.json` (edit it in the backend, `--render`, then `--sync` to the other
  repos). The repo's check runs `--check`, which fails when the map no longer matches the code.
