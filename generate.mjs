// Builds the README of each public awesome-* list repo from the catalog.
//
//   node scripts/awesome/generate.mjs                       read https://api.pluginboard.ai, write into awesome/
//   node scripts/awesome/generate.mjs --from listings.json  read a saved snapshot (an array of GET /v1/listings items)
//   node scripts/awesome/generate.mjs --api http://api.pluginboard.localhost:4100
//   node scripts/awesome/generate.mjs --only skills         one list: skills | plugins | mcp
//   node scripts/awesome/generate.mjs --save snapshot.json  also keep what was read
//   node scripts/awesome/generate.mjs --only mcp --flat 1 --dir .   write README.md straight into --dir (inside a list repo)
//
// A listing gets in when it is live (the API only returns live ones) and its latest security scan
// passed. Within a category the order is weekly installs, total installs, then GitHub stars.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE = "https://pluginboard.ai";
const MCP_FORMATS = new Set(["remote_mcp", "local_mcp"]);

const LISTS = {
  skills: {
    repo: "awesome-agent-skills",
    title: "Awesome Agent Skills",
    noun: "skills",
    blurb: "Agent Skills: folders with a `SKILL.md` that your agent loads when they fit the task.",
    shelf: `${SITE}/skills`,
    pick: (l) => l.type === "skill",
  },
  plugins: {
    repo: "awesome-agent-plugins",
    title: "Awesome Agent Plugins",
    noun: "plugins",
    blurb: "Plugins for your agents: Claude plugins, Gemini extensions, ChatGPT and Codex plugins.",
    shelf: `${SITE}/plugins`,
    pick: (l) => l.type === "plugin" && l.formats.some((f) => !MCP_FORMATS.has(f)),
  },
  mcp: {
    repo: "awesome-mcp-servers",
    title: "Awesome MCP Servers",
    noun: "MCP servers",
    blurb: "MCP servers that give your agents new tools, hosted or local.",
    shelf: `${SITE}/plugins`,
    pick: (l) => l.type === "plugin" && l.formats.some((f) => MCP_FORMATS.has(f)),
  },
};

function args(argv) {
  const out = { api: "https://api.pluginboard.ai", dir: "awesome", perCategory: 15, max: 200 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (!key || value === undefined) throw new Error(`Usage: ${argv[i]} needs a value`);
    if (key === "per-category") out.perCategory = Number(value);
    else if (key === "max") out.max = Number(value);
    else out[key] = value;
  }
  return out;
}

async function fetchAll(api) {
  const all = [];
  for (const type of ["plugin", "skill"]) {
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${api}/v1/listings?type=${type}&limit=100&offset=${offset}`);
      if (!res.ok) throw new Error(`${api}: ${res.status} for ${type} at offset ${offset}`);
      const { data, total } = await res.json();
      all.push(...data);
      if (offset + 100 >= total || data.length === 0) break;
    }
  }
  return all;
}

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
const clean = (s) => s.replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
const rank = (a, b) =>
  b.installs.weekly - a.installs.weekly ||
  b.installs.total - a.installs.total ||
  b.githubStars - a.githubStars ||
  a.name.localeCompare(b.name);

function entry(l) {
  const bits = [];
  if (l.maker) bits.push(`by ${clean(l.maker.name)}`);
  if (l.githubStars > 0) bits.push(`⭐ ${compact(l.githubStars)}`);
  if (l.installs.total > 0) bits.push(`${compact(l.installs.total)} installs`);
  const tagline = clean(l.tagline).replace(/\.$/, "");
  return `- [**${clean(l.name)}**](${l.url}) - ${tagline}.${bits.length ? ` _${bits.join(" · ")}_` : ""}`;
}

function build(list, listings, opts, today) {
  const scanned = listings.filter((l) => list.pick(l) && l.security?.verdict === "passed");
  const byCategory = new Map();
  for (const l of scanned) {
    const name = l.category?.name ?? "More";
    if (!byCategory.has(name)) byCategory.set(name, []);
    byCategory.get(name).push(l);
  }
  const sections = [...byCategory.entries()]
    .map(([name, items]) => [name, items.sort(rank).slice(0, opts.perCategory)])
    .sort(([an], [bn]) => (an === "More") - (bn === "More") || an.localeCompare(bn));

  // Over the cap: drop the lowest-ranked entries across all sections, not whole categories.
  let kept = sections.flatMap(([, items]) => items).sort(rank);
  if (kept.length > opts.max) kept = kept.slice(0, opts.max);
  const keep = new Set(kept.map((l) => l.id));
  const shown = sections.map(([name, items]) => [name, items.filter((l) => keep.has(l.id))]).filter(([, items]) => items.length);
  const total = shown.reduce((n, [, items]) => n + items.length, 0);

  const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
  const lines = [
    `# ${list.title}`,
    "",
    `${list.blurb} Every entry below is live on [Pluginboard](${SITE}) and its latest security scan passed.`,
    "",
    `Last updated ${today}. [Browse all ${list.noun} on pluginboard.ai](${list.shelf}) for search, install steps for each agent and the full security report of every listing.`,
    "",
    "## Contents",
    "",
    ...shown.map(([name, items]) => `- [${name}](#${anchor(name)}) (${items.length})`),
    "",
    ...shown.flatMap(([name, items]) => [`## ${name}`, "", ...items.map(entry), ""]),
    "## How entries get here",
    "",
    "- **Scanned.** Pluginboard scans every listing on each change, and again when its rules improve. Only listings whose latest scan passed are listed here. Anything with a warning stays on the site but not in this list.",
    `- **Ranked.** Within a category: installs in the last 7 days, then total installs, then GitHub stars. Each category shows its top ${opts.perCategory}, and the list holds at most ${opts.max}.`,
    "- **Current.** This list is generated from the live catalog, so please don't edit it by hand.",
    "",
    "## Add yours",
    "",
    `Makers can list ${list.noun} for free at [pluginboard.ai/submit](${SITE}/submit). Once it's live and its scan passes, it can appear here automatically.`,
    "",
    "## License",
    "",
    "[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): use this list however you like.",
    "",
  ];
  return { markdown: lines.join("\n"), total, categories: shown.length };
}

async function main() {
  const opts = args(process.argv.slice(2));
  const listings = opts.from ? JSON.parse(readFileSync(opts.from, "utf8")) : await fetchAll(opts.api);
  if (opts.save) writeFileSync(opts.save, JSON.stringify(listings));
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, list] of Object.entries(LISTS)) {
    if (opts.only && opts.only !== key) continue;
    const { markdown, total, categories } = build(list, listings, opts, today);
    const dir = opts.flat ? path.resolve(opts.dir) : path.resolve(opts.dir, list.repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "README.md"), markdown);
    console.log(`${list.repo}: ${total} entries in ${categories} categories`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
