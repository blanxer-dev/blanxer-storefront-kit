#!/usr/bin/env node
/**
 * The feature map lookup: which feature a file belongs to, what that feature is linked to, and
 * what has to be checked before a change to it is finished. Same file in every Blanxer repo.
 *
 *   node scripts/claude/impact.cjs                 what my branch touches (diff against the base branch)
 *   node scripts/claude/impact.cjs <feature>       one feature: code in every repo, rules, tests, links
 *   node scripts/claude/impact.cjs <path>          the feature(s) that own a file
 *   node scripts/claude/impact.cjs <word> [...]    search features, settings and single homes
 *   node scripts/claude/impact.cjs --list          every feature, one line each
 *   node scripts/claude/impact.cjs --check         the map is valid for this repo (runs in the tests / CI)
 *   node scripts/claude/impact.cjs --check-all k=dir ...   also check the paths of sibling repos
 *   node scripts/claude/impact.cjs --render        rewrite docs/feature-map/README.md from the JSON
 *   node scripts/claude/impact.cjs --sync dir ...  copy the map, the README and this script to other repos
 *   node scripts/claude/impact.cjs --hook          Claude Code PostToolUse hook (reads the hook JSON on stdin)
 *
 * The map is docs/feature-map/feature-map.json. How to keep it: docs/feature-map/README.md.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAP_DIR = path.join(ROOT, 'docs', 'feature-map');
const MAP_FILE = path.join(MAP_DIR, 'feature-map.json');
const README = path.join(MAP_DIR, 'README.md');
const SHARED = ['docs/feature-map/feature-map.json', 'docs/feature-map/README.md', 'scripts/claude/impact.cjs'];

const loadMap = () => JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));

/** Which repo of the map this checkout is: IMPACT_REPO, else the package.json name. */
const repoKeyOf = (map, root = ROOT) => {
  if (process.env.IMPACT_REPO && root === ROOT) return process.env.IMPACT_REPO;
  let name = '';
  try {
    name = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name || '';
  } catch {
    /* no package.json */
  }
  for (const [key, r] of Object.entries(map.repos)) if (r.package === name) return key;
  return null;
};

// ── globs: `**` any depth, `*` inside one path part; a pattern without a wildcard also owns
//    everything under it when it is a folder ──────────────────────────────────────────────────
const reCache = new Map();
const globRe = (glob) => {
  if (!reCache.has(glob)) {
    const body = glob
      .split('**')
      .map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
      .join('.*');
    reCache.set(glob, new RegExp(`^${body}(/.*)?$`));
  }
  return reCache.get(glob);
};
const matches = (glob, file) => globRe(glob).test(file);

const walk = (dir, out = []) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/** true when the glob matches at least one real file or folder under root */
const globExists = (root, glob) => {
  if (!glob.includes('*')) return fs.existsSync(path.join(root, glob));
  const fixed = glob.split('*')[0];
  const start = fixed.endsWith('/') ? fixed : path.dirname(fixed);
  const base = path.join(root, start);
  return walk(base).some((abs) => matches(glob, path.relative(root, abs).split(path.sep).join('/')));
};

const featuresOfFile = (map, repo, file) =>
  Object.entries(map.features)
    .filter(([, f]) => (f.paths?.[repo] || []).some((g) => matches(g, file)))
    .map(([id]) => id);

// ── links: declared once on either side, shown from both ─────────────────────────────────────
const linksOf = (map, id) => {
  const byOther = new Map();
  const add = (other, l) => {
    const cur = byOther.get(other) || { other, why: [], check: [] };
    if (l.why && !cur.why.includes(l.why)) cur.why.push(l.why);
    if (l.check && !cur.check.includes(l.check)) cur.check.push(l.check);
    byOther.set(other, cur);
  };
  for (const l of map.features[id].links || []) add(l.to, l);
  for (const [otherId, f] of Object.entries(map.features))
    for (const l of f.links || []) if (l.to === id && otherId !== id) add(otherId, l);
  return [...byOther.values()].map((l) => ({ other: l.other, why: l.why.join(' '), check: l.check.join('; ') }));
};

const settingsOf = (map, id) => ({
  own: (map.settings || []).filter((s) => s.feature === id),
  dependants: (map.settings || []).filter((s) => s.feature !== id && (s.requires || []).some((r) => r.feature === id)),
});
const homesOf = (map, id) => (map.single_homes || []).filter((h) => (h.features || []).includes(id));

const wrap = (text, indent, width = 100) => {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width - indent.length) {
      lines.push(line);
      line = w;
    } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i ? indent : '') + l).join('\n');
};

/** The brief an agent reads before touching a feature. `compact` = the hook's shorter form. */
const brief = (map, id, repo, compact = false) => {
  const f = map.features[id];
  const L = [];
  L.push(`## ${id}: ${f.name}`);
  if (f.summary) L.push(wrap(f.summary, ''));
  if (f.rules?.length) L.push(`Rules (read first): ${f.rules.join(', ')}`);
  if (f.tests?.length && !compact) L.push(`Tests: ${f.tests.join(', ')}`);
  if (f.watch?.length) {
    L.push('Never break:');
    for (const w of f.watch) L.push('  - ' + wrap(w, '    '));
  }
  const links = linksOf(map, id);
  if (links.length) {
    L.push('Linked features (a change here can break these; check each):');
    for (const l of links) {
      L.push(`  - ${l.other}: ` + wrap(l.why, '    '));
      if (l.check) L.push('    Check: ' + wrap(l.check, '    '));
    }
  }
  const { own, dependants } = settingsOf(map, id);
  const settingLine = (s) => {
    L.push(`  - ${s.id} (${s.key})` + (s.summary ? `: ${s.summary}` : ''));
    for (const r of s.requires || []) L.push('    needs ' + wrap(`${r.what}${r.handled ? ` [${r.handled}]` : ''}${r.note ? `: ${r.note}` : ''}`, '      '));
  };
  if (own.length) {
    L.push('Settings of this feature and what each needs to keep working:');
    own.forEach(settingLine);
  }
  if (dependants.length) {
    L.push('Settings elsewhere that stop working if this feature is switched off or changed:');
    dependants.forEach(settingLine);
  }
  const homes = homesOf(map, id);
  if (homes.length) {
    L.push('One home only (use it, never write a second copy):');
    for (const h of homes) {
      L.push(`  - ${h.rule}: ${h.home}`);
      if (h.mirrors?.length) L.push('    Copies that must change with it: ' + wrap(h.mirrors.join('; '), '      '));
    }
  }
  const others = Object.keys(map.repos).filter((k) => (f.paths?.[k] || []).length);
  if (others.length) {
    L.push(compact ? 'The same feature in the other repos (keep them in step):' : 'Code:');
    for (const k of others) {
      if (compact && k === repo) continue;
      L.push(`  - ${k}: ${f.paths[k].join(', ')}`);
    }
  }
  // notes from past work: all of them in the full brief, this repo's in the hook's
  const notes = (f.notes || []).filter((n) => !compact || n.startsWith(`${repo}:`));
  if (notes.length) L.push(`Notes from past work (read before changing it): ${notes.join(', ')}`);
  return L.join('\n');
};

// ── git ──────────────────────────────────────────────────────────────────────────────────────
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const changedFiles = (map, repo) => {
  const refs = [map.repos[repo]?.base, 'origin/dev', 'origin/main'].filter(Boolean);
  let base = 'HEAD';
  for (const ref of refs) {
    try {
      base = git(`merge-base HEAD ${ref}`).trim();
      break;
    } catch {
      /* try the next one */
    }
  }
  return [
    ...new Set([...git(`diff --name-only ${base}`).split('\n'), ...git('ls-files --others --exclude-standard').split('\n')].filter(Boolean)),
  ];
};

// ── check ────────────────────────────────────────────────────────────────────────────────────
const checkRepo = (map, repo, root) => {
  const errors = [];
  const ids = new Set(Object.keys(map.features));
  for (const [id, f] of Object.entries(map.features)) {
    for (const g of f.paths?.[repo] || []) if (!globExists(root, g)) errors.push(`${id}: path "${g}" matches nothing in ${repo}`);
    for (const key of ['rules', 'tests', 'notes'])
      for (const ref of f[key] || []) {
        const [r, p] = ref.includes(':') ? ref.split(/:(.*)/) : [null, ref];
        if (r === repo && !globExists(root, p)) errors.push(`${id}: ${key} "${ref}" does not exist`);
      }
  }
  for (const h of map.single_homes || [])
    for (const ref of [h.home, ...(h.mirrors || [])]) {
      const [r, rest] = ref.split(/:(.*)/);
      const p = (rest || '').split(/[ #]/)[0];
      if (r === repo && p && !globExists(root, p)) errors.push(`single home "${h.rule}": "${ref}" does not exist`);
    }
  // every source file is owned by a feature, so a new folder cannot stay off the map
  for (const cover of map.repos[repo]?.cover || []) {
    const [glob, depthStr] = cover.split('@');
    const depth = Number(depthStr || 0);
    const baseDir = glob.replace(/\/\*\*$/, '');
    const seen = new Set();
    for (const abs of walk(path.join(root, baseDir))) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel) || /\.(test|spec)\.[a-z]+$/.test(rel)) continue;
      if (featuresOfFile(map, repo, rel).length) continue;
      const unit = rel.split('/').slice(0, baseDir.split('/').length + depth).join('/');
      if (!seen.has(unit)) {
        seen.add(unit);
        errors.push(`"${unit}" belongs to no feature: add it to a feature's paths.${repo} in docs/feature-map/feature-map.json`);
      }
    }
  }
  return { errors, ids };
};

const checkStructure = (map) => {
  const errors = [];
  const ids = new Set(Object.keys(map.features));
  for (const [id, f] of Object.entries(map.features)) {
    if (!f.name) errors.push(`${id}: no name`);
    for (const l of f.links || []) {
      if (!ids.has(l.to)) errors.push(`${id}: link to unknown feature "${l.to}"`);
      if (!l.why) errors.push(`${id}: link to "${l.to}" has no why`);
    }
    for (const k of Object.keys(f.paths || {})) if (!map.repos[k]) errors.push(`${id}: paths for unknown repo "${k}"`);
  }
  for (const s of map.settings || []) {
    if (!ids.has(s.feature)) errors.push(`setting ${s.id}: unknown feature "${s.feature}"`);
    for (const r of s.requires || []) if (r.feature && !ids.has(r.feature)) errors.push(`setting ${s.id}: requires unknown feature "${r.feature}"`);
  }
  for (const h of map.single_homes || []) for (const fid of h.features || []) if (!ids.has(fid)) errors.push(`single home "${h.rule}": unknown feature "${fid}"`);
  return errors;
};

// ── render the README ────────────────────────────────────────────────────────────────────────
const START = '<!-- generated:start (node scripts/claude/impact.cjs --render) -->';
const END = '<!-- generated:end -->';
const render = (map) => {
  const L = [START, ''];
  L.push('## Features', '', '| Feature | What it is | Linked to |', '|---|---|---|');
  for (const [id, f] of Object.entries(map.features)) {
    const links = [...new Set(linksOf(map, id).map((l) => l.other))].sort();
    L.push(`| [\`${id}\`](#${id}) | ${f.name} | ${links.map((x) => `\`${x}\``).join(', ')} |`);
  }
  L.push('', '## Links at a glance', '', '```mermaid', 'graph LR');
  const seen = new Set();
  for (const [id, f] of Object.entries(map.features))
    for (const l of f.links || []) {
      const key = [id, l.to].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      L.push(`  ${id.replace(/-/g, '_')}["${id}"] --- ${l.to.replace(/-/g, '_')}["${l.to}"]`);
    }
  L.push('```', '');
  if ((map.settings || []).length) {
    L.push('## Settings that depend on something else', '');
    L.push('A setting here stops working when what it needs is switched off, removed or downgraded.');
    L.push('"handled" says what the code does about it today.', '');
    L.push('| Setting | Feature | Needs | Handled |', '|---|---|---|---|');
    for (const s of map.settings)
      for (const r of s.requires || [])
        L.push(`| \`${s.id}\`<br>${s.key} | \`${s.feature}\` | ${r.what}${r.feature ? ` (\`${r.feature}\`)` : ''} | ${r.handled || ''}${r.note ? `: ${r.note}` : ''} |`);
    L.push('');
  }
  if ((map.single_homes || []).length) {
    L.push('## One home only', '');
    L.push('Each rule below lives in one place. Use it; never write a second copy. The copies listed are');
    L.push('the ones that already exist in other repos and must change in the same piece of work.', '');
    L.push('| Rule | Home | Copies that must change with it |', '|---|---|---|');
    for (const h of map.single_homes) L.push(`| ${h.rule} | \`${h.home}\` | ${(h.mirrors || []).map((m) => `\`${m}\``).join('<br>')} |`);
    L.push('');
  }
  L.push('## Feature by feature', '');
  for (const [id, f] of Object.entries(map.features)) {
    L.push(`### ${id}`, '', `**${f.name}.** ${f.summary || ''}`, '');
    if (f.rules?.length) L.push(`- **Rules:** ${f.rules.map((r) => `\`${r}\``).join(', ')}`);
    if (f.tests?.length) L.push(`- **Tests:** ${f.tests.map((r) => `\`${r}\``).join(', ')}`);
    if (f.notes?.length) L.push(`- **Notes:** ${f.notes.map((r) => `\`${r}\``).join(', ')}`);
    for (const k of Object.keys(map.repos)) if ((f.paths?.[k] || []).length) L.push(`- **${k}:** ${f.paths[k].map((p) => `\`${p}\``).join(', ')}`);
    if (f.watch?.length) {
      L.push('- **Never break:**');
      for (const w of f.watch) L.push(`  - ${w}`);
    }
    const links = linksOf(map, id);
    if (links.length) {
      L.push('- **Linked features:**');
      for (const l of links) L.push(`  - \`${l.other}\`: ${l.why}${l.check ? ` **Check:** ${l.check}` : ''}`);
    }
    L.push('');
  }
  L.push(END);
  return L.join('\n');
};
const withRendered = (map) => {
  const cur = fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : `# Feature map\n\n${START}\n${END}\n`;
  const a = cur.indexOf(START);
  const b = cur.indexOf(END);
  if (a < 0 || b < 0) return `${cur.trimEnd()}\n\n${render(map)}\n`;
  return cur.slice(0, a) + render(map) + cur.slice(b + END.length);
};

// ── commands ─────────────────────────────────────────────────────────────────────────────────
const main = () => {
  const args = process.argv.slice(2);
  const map = loadMap();
  const repo = repoKeyOf(map);

  if (args[0] === '--hook') return hook(map, repo);

  if (args[0] === '--list') {
    for (const [id, f] of Object.entries(map.features)) console.log(`${id.padEnd(26)} ${f.name}`);
    return;
  }

  if (args[0] === '--render') {
    fs.writeFileSync(README, withRendered(map));
    console.log(`Wrote ${path.relative(ROOT, README)}`);
    return;
  }

  if (args[0] === '--sync') {
    for (const dir of args.slice(1)) {
      for (const rel of SHARED) {
        const to = path.join(path.resolve(dir), rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), to);
      }
      console.log(`Synced the feature map to ${dir}`);
    }
    return;
  }

  if (args[0] === '--check' || args[0] === '--check-all') {
    const errors = checkStructure(map);
    if (!repo) errors.push('this repo is not in the map (repos.<key>.package must equal the package.json name)');
    else errors.push(...checkRepo(map, repo, ROOT).errors);
    if (fs.readFileSync(README, 'utf8') !== withRendered(map)) errors.push('docs/feature-map/README.md is out of date: run `node scripts/claude/impact.cjs --render`');
    if (args[0] === '--check-all')
      for (const pair of args.slice(1)) {
        const [key, dir] = pair.split('=');
        const root = path.resolve(dir);
        errors.push(...checkRepo(map, key, root).errors.map((e) => `[${key}] ${e}`));
        for (const rel of SHARED) {
          const theirs = path.join(root, rel);
          if (!fs.existsSync(theirs) || fs.readFileSync(theirs, 'utf8') !== fs.readFileSync(path.join(ROOT, rel), 'utf8'))
            errors.push(`[${key}] ${rel} differs from this repo's copy: run --sync`);
        }
      }
    if (errors.length) {
      console.error(`The feature map has ${errors.length} problem(s):\n` + errors.map((e) => `  - ${e}`).join('\n'));
      process.exit(1);
    }
    console.log(`The feature map is valid for ${repo} (${Object.keys(map.features).length} features).`);
    return;
  }

  if (!args.length) {
    if (!repo) return console.log('This repo is not in the feature map.');
    const files = changedFiles(map, repo);
    const touched = new Map();
    for (const f of files) for (const id of featuresOfFile(map, repo, f)) touched.set(id, [...(touched.get(id) || []), f]);
    if (!touched.size) return console.log('Nothing on this branch touches a mapped feature yet.');
    console.log(`This branch touches ${touched.size} feature(s) in ${repo}:\n`);
    for (const [id, fs_] of touched) {
      console.log(brief(map, id, repo));
      console.log(`Changed here: ${fs_.slice(0, 12).join(', ')}${fs_.length > 12 ? ` … (+${fs_.length - 12})` : ''}\n`);
    }
    return;
  }

  // a feature id, a path, or words to search
  const out = [];
  for (const a of args) {
    if (map.features[a]) {
      out.push(brief(map, a, repo));
      continue;
    }
    const rel = path.isAbsolute(a) ? path.relative(ROOT, a).split(path.sep).join('/') : a.replace(/^\.\//, '');
    const owners = repo ? featuresOfFile(map, repo, rel) : [];
    if (owners.length && fs.existsSync(path.join(ROOT, rel))) {
      out.push(`${rel} belongs to: ${owners.join(', ')}\n`);
      for (const id of owners) out.push(brief(map, id, repo));
      continue;
    }
    const q = a.toLowerCase();
    const hits = Object.entries(map.features).filter(([id, f]) =>
      [id, f.name, f.summary, ...(f.keywords || []), ...(f.watch || [])].join(' ').toLowerCase().includes(q),
    );
    const settingHits = (map.settings || []).filter((s) => [s.id, s.key, s.summary].join(' ').toLowerCase().includes(q));
    const homeHits = (map.single_homes || []).filter((h) => [h.rule, h.home].join(' ').toLowerCase().includes(q));
    if (!hits.length && !settingHits.length && !homeHits.length) {
      out.push(`Nothing in the feature map matches "${a}". \`--list\` shows every feature.`);
      continue;
    }
    if (hits.length) out.push(`Features matching "${a}":\n` + hits.map(([id, f]) => `  ${id.padEnd(26)} ${f.name}`).join('\n'));
    if (settingHits.length) out.push(`Settings matching "${a}":\n` + settingHits.map((s) => `  ${s.id} (${s.key}) → feature ${s.feature}`).join('\n'));
    if (homeHits.length) out.push(`Single homes matching "${a}":\n` + homeHits.map((h) => `  ${h.rule}: ${h.home}`).join('\n'));
  }
  console.log(out.join('\n\n'));
};

/**
 * PostToolUse hook for Edit / Write: the first time a session edits a file of a feature, the
 * feature's brief (links, rules, settings, copies in other repos) is put in front of the agent.
 * Never blocks and never fails the edit.
 */
function hook(map, repo) {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const file = input.tool_input?.file_path || input.tool_response?.filePath;
    if (!repo || !file) return;
    const rel = path.relative(ROOT, path.resolve(file)).split(path.sep).join('/');
    if (rel.startsWith('..')) return;
    const ids = featuresOfFile(map, repo, rel);
    if (!ids.length) return;
    const stateFile = path.join(os.tmpdir(), `blanxer-impact-${String(input.session_id || 'x').replace(/[^\w-]/g, '')}-${repo}.json`);
    let told = [];
    try {
      told = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      /* first edit of the session */
    }
    const fresh = ids.filter((id) => !told.includes(id));
    if (!fresh.length) return;
    fs.writeFileSync(stateFile, JSON.stringify([...told, ...fresh]));
    const text =
      `Feature map (docs/feature-map): ${rel} belongs to ${fresh.join(', ')}. Before this change is finished, ` +
      `check every linked feature and copy below, and say in your final report which ones you checked.\n\n` +
      fresh.map((id) => brief(map, id, repo, true)).join('\n\n');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
  } catch {
    /* the map must never get in the way of an edit */
  }
}

main();
