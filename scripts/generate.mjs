// GH_TOKEN needs repo + read:org scopes

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { THEMES, heroCard, statsCard, languagesCard } from "./cards.mjs";

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

console.log(`Repos counted: ${repos.length}`);
console.log("Top languages:", topN(bytes, config.topLanguages).map(([n]) => n).join(", "));
