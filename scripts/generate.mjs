// GH_TOKEN needs repo + read:org scopes

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { THEMES, heroCard, statsCard, timeCard, uplinkCard, languagesCard } from "./cards.mjs";

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) throw new Error("GH_TOKEN is required");

const config = JSON.parse(await readFile(new URL("../stats.config.json", import.meta.url), "utf8"));
const excludeRepos = new Set(config.excludeRepos.map((r) => r.toLowerCase()));
const excludeLangs = new Set(config.excludeLanguages);
const OUT = new URL("../generated/", import.meta.url);

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

async function fetchRepos() {
  const repos = [];
  let cursor = null;
  do {
    const { viewer } = await gql(
      `query($cursor: String) {
        viewer {
          repositories(first: 100, after: $cursor, isFork: false,
                       ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
            pageInfo { hasNextPage endCursor }
            nodes {
              nameWithOwner stargazerCount
              owner { login }
              primaryLanguage { name color }
              languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
                edges { size node { name color } }
              }
            }
          }
        }
      }`,
      { cursor },
    );
    repos.push(...viewer.repositories.nodes);
    cursor = viewer.repositories.pageInfo.hasNextPage ? viewer.repositories.pageInfo.endCursor : null;
  } while (cursor);
  return repos.filter((r) => !excludeRepos.has(r.nameWithOwner.toLowerCase()));
}

async function fetchActivity() {
  const { viewer } = await gql(`{
    viewer {
      login createdAt
      pullRequests { totalCount }
      issues { totalCount }
      repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) { totalCount }
      contributionsCollection {
        contributionCalendar { totalContributions weeks { contributionDays { contributionCount } } }
      }
    }
  }`);
  const calendar = viewer.contributionsCollection.contributionCalendar;
  const weekly = calendar.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));

  // contributionsCollection is limited to a one year range
  let contributions = 0;
  let thisYear = 0;
  const start = new Date(viewer.createdAt).getUTCFullYear();
  const now = new Date();
  for (let y = start; y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1)).toISOString();
    const to = y === now.getUTCFullYear() ? now.toISOString() : new Date(Date.UTC(y, 11, 31, 23, 59, 59)).toISOString();
    const { viewer: v } = await gql(
      `query($from: DateTime!, $to: DateTime!) {
        viewer {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { totalContributions }
          }
        }
      }`,
      { from, to },
    );
    const total = v.contributionsCollection.contributionCalendar.totalContributions;
    contributions += total;
    if (y === now.getUTCFullYear()) thisYear = total;
  }
  return { ...viewer, contributions, thisYear, weekly, lastYear: calendar.totalContributions };
}

async function fetchCommitDates(repos) {
  const { viewer } = await gql(`{ viewer { id } }`);
  const dates = [];
  for (const repo of repos) {
    const [owner, name] = repo.nameWithOwner.split("/");
    let cursor = null;
    do {
      const { repository } = await gql(
        `query($owner: String!, $name: String!, $author: ID!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            defaultBranchRef { target { ... on Commit {
              history(first: 100, after: $cursor, author: { id: $author }) {
                pageInfo { hasNextPage endCursor }
                nodes { authoredDate }
              }
            } } }
          }
        }`,
        { owner, name, author: viewer.id, cursor },
      );
      const history = repository.defaultBranchRef?.target?.history;
      if (!history) break;
      dates.push(...history.nodes.map((n) => n.authoredDate));
      cursor = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
    } while (cursor);
  }
  return dates;
}

const TARGETS = [
  { name: "Cloudflare", apps: [/cloudflare/], creators: [/cloudflare/i], files: [/(^|\/)wrangler\.(toml|jsonc?)$/] },
  { name: "Vercel", apps: [/vercel/], creators: [/^vercel/i], files: [/(^|\/)vercel\.json$/] },
  { name: "Netlify", apps: [/netlify/], creators: [/netlify/i], files: [/(^|\/)netlify\.toml$/] },
  { name: "Firebase", files: [/(^|\/)firebase\.json$/, /(^|\/)apphosting\.yaml$/] },
  { name: "GitHub Pages", creators: [/github-pages/], envs: [/github-pages/] },
  { name: "Fly.io", files: [/(^|\/)fly\.toml$/] },
  { name: "Kubernetes", files: [/(^|\/)(k8s|helm|charts)\//, /(^|\/)skaffold\.ya?ml$/] },
  { name: "Docker", files: [/(^|\/)Dockerfile$/, /(^|\/)(docker-)?compose[^/]*\.ya?ml$/] },
  { name: "iOS", files: [/\.xcodeproj\//, /(^|\/)eas\.json$/] },
  { name: "Android", files: [/(^|\/)AndroidManifest\.xml$/, /(^|\/)eas\.json$/] },
];

async function rest(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
  });
  return res.ok ? res.json() : null;
}

async function fetchDeployTargets(repos) {
  const counts = new Map();
  for (const repo of repos) {
    const [owner, name] = repo.nameWithOwner.split("/");
    const { repository: r } = await gql(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          deployments(last: 50) { nodes { environment creator { login } } }
          defaultBranchRef { name target { ... on Commit { history(first: 30) { nodes {
            statusCheckRollup { contexts(first: 20) { nodes {
              ... on CheckRun { checkSuite { app { slug } } }
              ... on StatusContext { creator { login } }
            } } }
          } } } } }
        }
      }`,
      { owner, name },
    );
    if (!r.defaultBranchRef) continue;
    const apps = new Set();
    const creators = new Set(r.deployments.nodes.map((d) => d.creator?.login ?? ""));
    const envs = new Set(r.deployments.nodes.map((d) => d.environment ?? ""));
    for (const c of r.defaultBranchRef.target.history.nodes) {
      for (const n of c.statusCheckRollup?.contexts.nodes ?? []) {
        if (n.checkSuite?.app) apps.add(n.checkSuite.app.slug);
        if (n.creator) creators.add(n.creator.login);
      }
    }
    const tree = await rest(`repos/${owner}/${name}/git/trees/${r.defaultBranchRef.name}?recursive=1`);
    const files = (tree?.tree ?? []).map((f) => f.path).filter((p) => !p.includes("node_modules/"));
    const hit = (rules = [], values) => rules.some((re) => [...values].some((v) => re.test(v)));
    for (const t of TARGETS) {
      if (hit(t.apps, apps) || hit(t.creators, creators) || hit(t.envs, envs) || hit(t.files, files)) {
        counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// rows Mon..Sun, columns 0..23 in the configured timezone
function bucketByHour(dates, timeZone) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const grid = days.map(() => Array(24).fill(0));
  for (const d of dates) {
    const p = Object.fromEntries(f.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
    grid[days.indexOf(p.weekday)][Number(p.hour) % 24]++;
  }
  return grid;
}

function aggregateLanguages(repos) {
  const bytes = new Map();
  const colors = new Map();
  const repoCount = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      if (excludeLangs.has(node.name)) continue;
      bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
      colors.set(node.name, node.color);
    }
    const p = repo.primaryLanguage;
    if (p && !excludeLangs.has(p.name)) {
      repoCount.set(p.name, (repoCount.get(p.name) ?? 0) + 1);
      colors.set(p.name, p.color);
    }
  }
  return { bytes, colors, repoCount };
}

function topN(map, n) {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) top.push(["Other", rest]);
  return top;
}

const [repos, activity] = await Promise.all([fetchRepos(), fetchActivity()]);
const { bytes, colors, repoCount } = aggregateLanguages(repos);
const commitDates = await fetchCommitDates(repos);
const targets = await fetchDeployTargets(repos);
const now = new Date();

const cards = {
  hero: (t) => heroCard(t, { ...config.hero, date: now }),
  stats: (t) =>
    statsCard(t, {
      contributions: activity.contributions,
      thisYear: activity.thisYear,
      lastYear: activity.lastYear,
      weekly: activity.weekly,
      pullRequests: activity.pullRequests.totalCount,
      contributedTo: activity.repositoriesContributedTo.totalCount,
      repoTotal: repos.length,
      languageCount: bytes.size,
      since: new Date(activity.createdAt).getUTCFullYear(),
      year: now.getUTCFullYear(),
    }),
  time: (t) => timeCard(t, { grid: bucketByHour(commitDates, config.timezone), timeZone: config.timezone }),
  uplink: (t) => uplinkCard(t, { targets, repoTotal: repos.length }),
  languages: (t) =>
    languagesCard(t, { entries: topN(bytes, config.topLanguages), colors, repoCount, repoTotal: repos.length }),
};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const [name, render] of Object.entries(cards)) {
  for (const [theme, t] of Object.entries(THEMES)) {
    await writeFile(new URL(`${name}-${theme}.svg`, OUT), render(t));
  }
}

console.log(`Repos counted: ${repos.length}, commits: ${commitDates.length}`);
console.log("Deploy targets:", targets.map(([n, c]) => `${n} ${c}`).join(", "));
console.log("Top languages:", topN(bytes, config.topLanguages).map(([n]) => n).join(", "));
