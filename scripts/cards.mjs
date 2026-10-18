import { readFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const font = (name) => readFileSync(new URL(`./fonts/${name}.woff2`, import.meta.url)).toString("base64");
const VT323 = font("VT323");
const SILK = font("Silkscreen");

export const THEMES = {
  dark: {
    bg: "#05070b", fg: "#eaf2ff", dim: "#8190a6", osd: "#3dff9a",
    c1: "#ff2bd6", c2: "#00e5ff", blend: "screen", glow: 2.2,
    scan: "rgba(0,0,0,0.5)", noise: 0.07, vig: "#000", vigA: 0.85,
    roll: "#cfe6ff", rollA: 0.07, bez1: "#1b1e23", bez2: "#0a0b0e", rim: "rgba(255,255,255,0.07)",
    grid: "#1a2433", trace: "#3dff9a", other: "#4a5568",
  },
  light: {
    bg: "#f2ecdf", fg: "#16151a", dim: "#8a8170", osd: "#d10f2f",
    c1: "#ff2a4d", c2: "#1f5bff", blend: "multiply", glow: 0,
    scan: "rgba(70,50,20,0.11)", noise: 0.1, vig: "#5c4a2c", vigA: 0.3,
    roll: "#3a2a10", rollA: 0.06, bez1: "#e4dccb", bez2: "#cdc3ad", rim: "rgba(0,0,0,0.09)",
    grid: "#dcd2bd", trace: "#d10f2f", other: "#b3aa98",
  },
};

const W = 840;
const BEZEL = 8;
const SMPTE = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#e07000", "#c00000", "#0000c0"];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
const glowAttr = (t) => (t.glow ? `filter="url(#glow)"` : "");

// fixed seed keeps output stable between runs
function noisePng(size) {
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 255;
  const raw = Buffer.alloc((size * 2 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * (size * 2 + 1) + 1 + x * 2;
      raw[o] = rnd();
      raw[o + 1] = rnd();
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 4, 0, 0, 0], 8); // 8-bit grayscale + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
const NOISE = noisePng(96);

function chroma(t, content, { x, y, size, cls = "", dx = 2, anchor = "start", glow = false }) {
  const a = `x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}"`;
  return `<g>
  <text ${a} class="${cls} ch c1" transform="translate(${-dx} 0)">${content}</text>
  <text ${a} class="${cls} ch c2" transform="translate(${dx} 0)">${content}</text>
  <text ${a} class="${cls}" ${glow ? glowAttr(t) : ""}>${content}</text>
</g>`;
}

function playIcon(t, x, y) {
  return `<polygon points="${x},${y - 14} ${x + 13},${y - 7} ${x},${y}" fill="${t.osd}" ${glowAttr(t)}/>`;
}

function screen(t, { h, title, body, defs = "", css = "" }) {
  const s = BEZEL;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>
<style>
@font-face{font-family:VT;src:url(data:font/woff2;base64,${VT323}) format("woff2")}
@font-face{font-family:Silk;src:url(data:font/woff2;base64,${SILK}) format("woff2")}
text{font-family:VT,ui-monospace,Menlo,monospace;fill:${t.fg}}
.silk{font-family:Silk,ui-monospace,monospace;letter-spacing:.12em}
.dim{fill:${t.dim}}
.osd{fill:${t.osd}}
.ch{mix-blend-mode:${t.blend}}
.c1{fill:${t.c1}}
.c2{fill:${t.c2}}
.roll{animation:roll 8s linear infinite}
@keyframes roll{from{transform:translateY(-120px)}to{transform:translateY(${h + 40}px)}}
.flicker{animation:flicker 6s infinite}
@keyframes flicker{0%,40%,44%,76%,100%{opacity:1}42%{opacity:.84}78%{opacity:.92}}
${css}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<clipPath id="scr"><rect x="${s}" y="${s}" width="${W - 2 * s}" height="${h - 2 * s}" rx="14"/></clipPath>
<pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="${t.scan}"/></pattern>
<pattern id="noise" width="96" height="96" patternUnits="userSpaceOnUse"><image width="96" height="96" href="data:image/png;base64,${NOISE}"/></pattern>
<radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="50%" stop-color="${t.vig}" stop-opacity="0"/><stop offset="100%" stop-color="${t.vig}" stop-opacity="${t.vigA}"/></radialGradient>
<linearGradient id="rollg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.roll}" stop-opacity="0"/><stop offset=".6" stop-color="${t.roll}" stop-opacity="${t.rollA}"/><stop offset="1" stop-color="${t.roll}" stop-opacity="0"/></linearGradient>
<linearGradient id="bez" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.bez1}"/><stop offset="1" stop-color="${t.bez2}"/></linearGradient>
<filter id="glow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="${t.glow}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${defs}
</defs>
<rect width="${W}" height="${h}" rx="22" fill="url(#bez)"/>
<g clip-path="url(#scr)">
<rect width="${W}" height="${h}" fill="${t.bg}"/>
<g class="flicker">
${body}
</g>
<rect width="${W}" height="${h}" fill="url(#noise)" opacity="${t.noise}"/>
<rect width="${W}" height="${h}" fill="url(#scan)"/>
<rect class="roll" width="${W}" height="100" fill="url(#rollg)"/>
<rect width="${W}" height="${h}" fill="url(#vig)"/>
</g>
<rect x="${s + 0.5}" y="${s + 0.5}" width="${W - 2 * s - 1}" height="${h - 2 * s - 1}" rx="14" fill="none" stroke="${t.rim}"/>
</svg>
`;
}

export function heroCard(t, { name, tagline, date }) {
  const h = 236;
  const cx = W / 2;
  const nameY = 114;
  const nameText = esc(name);
  const mon = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  const stamp = `${mon}.${String(date.getUTCDate()).padStart(2, "0")} ${date.getUTCFullYear()}`;
  const barW = (W - 2 * BEZEL) / SMPTE.length;

  const slice = (id, cls, y0, y1) => `<g clip-path="url(#${id})"><g class="${cls}">
  <rect x="-60" y="${y0}" width="${W + 120}" height="${y1 - y0}" fill="${t.bg}"/>
  <text x="${cx}" y="${nameY}" font-size="96" text-anchor="middle" class="c2">${nameText}</text>
</g></g>`;

  return screen(t, {
    h,
    title: name,
    defs: `<clipPath id="sa"><rect x="0" y="${nameY - 54}" width="${W}" height="14"/></clipPath>
<clipPath id="sb"><rect x="0" y="${nameY - 28}" width="${W}" height="9"/></clipPath>`,
    css: `.ga{opacity:0;animation:tear 4.6s steps(1) infinite}
.gb{opacity:0;animation:tear 4.6s steps(1) .12s infinite reverse}
@keyframes tear{0%,86%,100%{opacity:0;transform:none}87%{opacity:1;transform:translateX(-22px)}89%{opacity:1;transform:translateX(14px)}91%{opacity:1;transform:translateX(-6px)}93%{opacity:0}}`,
    body: `${chroma(t, nameText, { x: cx, y: nameY, size: 96, anchor: "middle", dx: 3, glow: true })}
${slice("sa", "ga", nameY - 54, nameY - 40)}
${slice("sb", "gb", nameY - 28, nameY - 19)}
<text x="${cx}" y="${nameY + 40}" font-size="12" text-anchor="middle" class="silk dim" style="letter-spacing:.42em">${esc(tagline)}</text>
<text x="${cx}" y="${nameY + 76}" font-size="24" text-anchor="middle" class="osd" ${glowAttr(t)}>${stamp}</text>
${SMPTE.map((c, i) => `<rect x="${(BEZEL + i * barW).toFixed(2)}" y="${h - BEZEL - 6}" width="${(barW + 0.5).toFixed(2)}" height="6" fill="${c}"/>`).join("")}`,
  });
}

// catmull-rom -> cubic bezier
function smoothPath(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const [p1, p2] = [pts[i], pts[i + 1]];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(1))} ${c2.map((v) => v.toFixed(1))} ${p2.map((v) => v.toFixed(1))}`;
  }
  return d;
}

export function statsCard(t, s) {
  const h = 326;
  const left = 34;
  const right = W - 34;
  const items = [
    ["Contributions", fmt(s.contributions)],
    [`In ${s.year}`, fmt(s.thisYear)],
    ["Repositories", fmt(s.repoTotal)],
    ["Contributed to", fmt(s.contributedTo)],
    ["Languages", fmt(s.languageCount)],
  ];
  const colW = (right - left) / items.length;
  const metrics = items
    .map(([label, value], i) => {
      const x = left + i * colW;
      return `${chroma(t, esc(value), { x, y: 116, size: 58, dx: 1.5, glow: true })}
<text x="${x + 1}" y="142" font-size="10" class="silk dim">${esc(label.toUpperCase())}</text>`;
    })
    .join("\n");

  const top = 182;
  const bottom = h - 34;
  const max = Math.max(...s.weekly, 1);
  const pts = s.weekly.map((v, i) => [
    left + (i / (s.weekly.length - 1)) * (right - left),
    bottom - 10 - (v / max) * (bottom - top - 40),
  ]);
  const d = smoothPath(pts);
  const vLines = Array.from({ length: 13 }, (_, i) => left + (i * (right - left)) / 12);
  const hLines = Array.from({ length: 5 }, (_, i) => top + (i * (bottom - top)) / 4);
  const grid = [
    ...vLines.map((x) => `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`),
    ...hLines.map((y) => `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`),
  ].join("");

  return screen(t, {
    h,
    title: "GitHub activity",
    css: `.beam{offset-path:path("${d}");offset-rotate:0deg;animation:sweep 7s linear infinite}
@keyframes sweep{from{offset-distance:0%}to{offset-distance:100%}}`,
    body: `${playIcon(t, 34, 52)}
<text x="56" y="52" font-size="28" class="osd" ${glowAttr(t)}>ACTIVITY</text>
<text x="${right}" y="52" font-size="28" text-anchor="end" class="dim">${s.since} <tspan class="osd">▸</tspan> ${s.year}</text>
${metrics}
<g stroke="${t.grid}" stroke-width="1" stroke-dasharray="2 3">${grid}</g>
<text x="${left + 8}" y="${top + 18}" font-size="10" class="silk osd">CH1 · 52 WK · ${fmt(s.lastYear)} EVENTS</text>
<text x="${right - 8}" y="${top + 18}" font-size="10" text-anchor="end" class="silk dim">PEAK ${max}/WK</text>
<path d="${d}" fill="none" stroke="${t.c2}" stroke-width="2" opacity=".35" class="ch" transform="translate(0 3)"/>
<path d="${d}" fill="none" stroke="${t.trace}" stroke-width="2" stroke-linejoin="round" ${glowAttr(t)}/>
<circle r="4" fill="${t.fg}" class="beam" ${glowAttr(t)}/>`,
  });
}

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

export function timeCard(t, { grid, timeZone }) {
  const h = 360;
  const hours = Array.from({ length: 24 }, (_, i) => grid.reduce((s, row) => s + row[i], 0));
  const days = grid.map((row) => row.reduce((s, v) => s + v, 0));
  const total = days.reduce((s, v) => s + v, 0) || 1;
  const maxHour = Math.max(...hours, 1);
  const maxCell = Math.max(...grid.flat(), 1);
  const peakHour = hours.indexOf(Math.max(...hours));
  const busiest = days.indexOf(Math.max(...days));
  const after = grid.reduce(
    (s, row, d) => s + row.reduce((a, v, hr) => a + (d >= 5 || hr < 9 || hr >= 18 ? v : 0), 0),
    0,
  );
  const tz = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName").value;

  // radar: 00 at the top, clockwise
  const cx = 176;
  const cy = 206;
  const R = 92;
  const r0 = 16;
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`;
  };
  const sector = (ra, rb, d0, d1) =>
    `M${pt(ra, d0)} L${pt(rb, d0)} A${rb} ${rb} 0 0 1 ${pt(rb, d1)} L${pt(ra, d1)} A${ra} ${ra} 0 0 0 ${pt(ra, d0)}Z`;
  const wedges = hours
    .map((v, i) => {
      if (!v) return "";
      const r = r0 + Math.sqrt(v / maxHour) * (R - r0);
      return `<path d="${sector(r0, r, i * 15 - 5.5, i * 15 + 5.5)}" fill="${t.trace}" opacity="${i === peakHour ? 1 : 0.78}"/>`;
    })
    .join("");
  const rings = [R / 3, (2 * R) / 3, R].map((r) => `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none"/>`).join("");
  const ticks = hours.map((_, i) => `<path d="M${pt(R + 2, i * 15)} L${pt(R + (i % 6 ? 6 : 10), i * 15)}"/>`).join("");
  const dial = [0, 6, 12, 18]
    .map((hr) => {
      const [x, y] = pt(R + 22, hr * 15).split(",");
      return `<text x="${x}" y="${Number(y) + 6}" font-size="18" text-anchor="middle" class="dim">${String(hr).padStart(2, "0")}</text>`;
    })
    .join("");
  const sweep = [30, 18, 8]
    .map((w, i) => `<path d="${sector(0, R, -w, 0)}" fill="${t.trace}" opacity="${[0.06, 0.08, 0.12][i]}"/>`)
    .join("");

  // day x hour grid
  const gx = 352;
  const gy = 104;
  const pitch = 19;
  const cell = 15;
  const cells = grid
    .flatMap((row, d) =>
      row.map((v, hr) => {
        const x = gx + hr * pitch;
        const y = gy + d * pitch;
        return v
          ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${t.trace}" opacity="${(0.18 + 0.82 * Math.pow(v / maxCell, 0.6)).toFixed(2)}"/>`
          : `<rect x="${x + 0.5}" y="${y + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="2" fill="none" stroke="${t.grid}"/>`;
      }),
    )
    .join("");
  const rowLabels = DAYS.map(
    (d, i) => `<text x="${gx - 10}" y="${gy + i * pitch + 11}" font-size="9" text-anchor="end" class="silk dim">${d}</text>`,
  ).join("");
  const colLabels = Array.from({ length: 8 }, (_, i) => i * 3)
    .map((hr) => `<text x="${gx + hr * pitch}" y="${gy + 7 * pitch + 14}" font-size="16" class="dim">${String(hr).padStart(2, "0")}</text>`)
    .join("");

  const readouts = [
    [hh(peakHour), "PEAK HOUR"],
    [DAYS[busiest], "BUSIEST DAY"],
    [`${Math.round((after / total) * 100)}%`, "AFTER HOURS"],
  ]
    .map(([value, label], i) => {
      const x = gx + i * 152;
      return `${chroma(t, value, { x, y: 300, size: 40, dx: 1.5, glow: true })}
<text x="${x + 1}" y="320" font-size="10" class="silk dim">${label}</text>`;
    })
    .join("\n");

  return screen(t, {
    h,
    title: "Commits by time of day",
    css: `.sweep{transform-origin:${cx}px ${cy}px;animation:spin 6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}`,
    body: `${playIcon(t, 34, 52)}
<text x="56" y="52" font-size="28" class="osd" ${glowAttr(t)}>COMMITS BY TIME OF DAY</text>
<text x="${W - 34}" y="52" font-size="28" text-anchor="end" class="dim"><tspan class="osd">${fmt(total)}</tspan> COMMITS · ${esc(tz)}</text>
<g stroke="${t.grid}" stroke-width="1" stroke-dasharray="2 3">${rings}
<line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}"/><line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}"/></g>
<g stroke="${t.dim}" stroke-width="1">${ticks}</g>
${dial}
<g class="sweep">${sweep}<path d="M${cx},${cy} L${pt(R, 0)}" stroke="${t.trace}" stroke-width="1.5" opacity=".7"/></g>
<g ${glowAttr(t)}>${wedges}</g>
<circle cx="${cx}" cy="${cy}" r="3" fill="${t.fg}"/>
${rowLabels}
<g ${glowAttr(t)}>${cells}</g>
${colLabels}
${readouts}`,
  });
}

const DEST = {
  Cloudflare: { kind: "EDGE", color: ["#f38020", "#e06a00"] },
  Vercel: { kind: "EDGE", color: [null, null] },
  Netlify: { kind: "EDGE", color: ["#00c7b7", "#00968a"] },
  Firebase: { kind: "CLOUD", color: ["#ffca28", "#e09400"] },
  "GitHub Pages": { kind: "STATIC", color: [null, null] },
  "Fly.io": { kind: "CLOUD", color: ["#a78bfa", "#7c3aed"] },
  Kubernetes: { kind: "CLUSTER", color: ["#5b8def", "#326ce5"] },
  Docker: { kind: "CONTAINER", color: ["#2496ed", "#1d7fc4"] },
  iOS: { kind: "MOBILE", color: [null, null] },
  Android: { kind: "MOBILE", color: ["#3ddc84", "#1ea362"] },
};

export function uplinkCard(t, { targets, repoTotal }) {
  const top = 112;
  const pitch = 34;
  const h = top + targets.length * pitch + 26;
  const max = Math.max(...targets.map(([, c]) => c), 1);
  const sx = 150;
  const sy = top + ((targets.length - 1) * pitch) / 2 - 34;
  const dotX = 372;
  const segs = 8;

  const rows = targets.map(([name, count], i) => {
    const y = top + i * pitch;
    const d = DEST[name] ?? { kind: "", color: [null, null] };
    const color = d.color[t === THEMES.dark ? 0 : 1] ?? t.fg;
    const lit = Math.max(1, Math.round((count / max) * segs));
    const meter = Array.from(
      { length: segs },
      (_, k) => `<rect x="${640 + k * 13}" y="${y - 13}" width="10" height="14" rx="1" fill="${k < lit ? color : "none"}" stroke="${k < lit ? "none" : t.grid}"/>`,
    ).join("");
    const path = `M${sx},${sy} C${sx + 110},${sy} ${dotX - 170},${y - 5} ${dotX - 60},${y - 5}`;
    return {
      line: `<path d="${path}" fill="none" stroke="${t.grid}" stroke-width="1"/>
<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 13" class="flow" style="animation-duration:${(1.4 + (i % 3) * 0.4).toFixed(1)}s"/>`,
      row: `<text x="${dotX - 52}" y="${y}" font-size="18" class="dim">CH${String(i + 1).padStart(2, "0")}</text>
<circle cx="${dotX}" cy="${y - 5}" r="5" fill="${color}" ${glowAttr(t)}/>
<text x="${dotX + 16}" y="${y + 2}" font-size="26">${esc(name)}</text>
<text x="548" y="${y - 1}" font-size="9" class="silk dim">${d.kind}</text>
<g ${glowAttr(t)}>${meter}</g>
<text x="${W - 34}" y="${y + 1}" font-size="20" text-anchor="end">${count} <tspan class="dim">REPO${count > 1 ? "S" : ""}</tspan></text>`,
    };
  });

  // lattice mast with the signal source at its tip
  const mb = sy + 104;
  const mast = `<g stroke="${t.dim}" stroke-width="1.5" fill="none">
<path d="M${sx},${sy + 8} L${sx - 26},${mb} M${sx},${sy + 8} L${sx + 26},${mb}"/>
${[0.3, 0.55, 0.8].map((f) => {
    const y = sy + 8 + f * (mb - sy - 8);
    const w = f * 26;
    return `<path d="M${sx - w},${y} L${sx + w},${y}"/>`;
  }).join("")}
<path d="M${sx - 26 * 0.3},${sy + 8 + 0.3 * (mb - sy - 8)} L${sx + 26 * 0.55},${sy + 8 + 0.55 * (mb - sy - 8)} L${sx - 26 * 0.8},${sy + 8 + 0.8 * (mb - sy - 8)}"/>
<path d="M${sx - 40},${mb} L${sx + 40},${mb}"/>
</g>`;
  const waves = [14, 26, 38]
    .map((r, i) => {
      const a = (deg) => [sx + r * Math.cos((deg * Math.PI) / 180), sy + r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(1));
      const [x0, y0] = a(-50);
      const [x1, y1] = a(50);
      const [x2, y2] = a(130);
      const [x3, y3] = a(230);
      return `<path class="wave" style="animation-delay:${i * 0.35}s" d="M${x0},${y0} A${r} ${r} 0 0 1 ${x1},${y1} M${x2},${y2} A${r} ${r} 0 0 1 ${x3},${y3}" fill="none" stroke="${t.osd}" stroke-width="1.5"/>`;
    })
    .join("");

  return screen(t, {
    h,
    title: "Deploy targets",
    css: `.flow{animation:flow 1.6s linear infinite}
@keyframes flow{to{stroke-dashoffset:-48}}
.wave{opacity:.15;animation:wave 1.4s ease-out infinite}
@keyframes wave{0%{opacity:.9}100%{opacity:.1}}`,
    body: `${playIcon(t, 34, 52)}
<text x="56" y="52" font-size="28" class="osd" ${glowAttr(t)}>DEPLOY TARGETS</text>
<text x="${W - 34}" y="52" font-size="28" text-anchor="end" class="dim"><tspan class="osd">${targets.length}</tspan> TARGETS</text>
${rows.map((r) => r.line).join("\n")}
${mast}
<g ${glowAttr(t)}>${waves}</g>
<circle cx="${sx}" cy="${sy}" r="5" fill="${t.osd}" ${glowAttr(t)}/>
<text x="${sx}" y="${mb + 26}" font-size="24" text-anchor="middle">${repoTotal} <tspan class="dim">REPOS</tspan></text>
${rows.map((r) => r.row).join("\n")}`,
  });
}

const SHORT = { "Objective-C": "Obj-C", "Jupyter Notebook": "Jupyter", "Vim Script": "Vim" };

export function languagesCard(t, { entries, colors, repoCount, repoTotal }) {
  const h = 356;
  const left = 74;
  const right = W - 34;
  const top = 92;
  const base = 262;
  const H = base - top;
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const max = entries[0][1];
  const colW = (right - left) / entries.length;
  const barW = Math.min(52, colW * 0.62);

  const scale = [0, 6, 12, 18, 24]
    .map((db, i) => {
      const y = top + (i * H) / 4;
      return `<line x1="${left - 6}" y1="${y}" x2="${right}" y2="${y}"/>
<text x="${left - 12}" y="${y + 5}" font-size="17" text-anchor="end" class="dim" stroke="none">-${db}</text>`;
    })
    .join("");

  const cols = entries.map(([name, v], i) => {
    const cx = left + colW * (i + 0.5);
    const bh = Math.max(10, Math.sqrt(v / max) * H);
    const color = name === "Other" ? t.other : colors.get(name) ?? t.other;
    const pct = ((v / total) * 100).toFixed(1);
    const repos = repoCount.get(name);
    return {
      bar: `<rect class="eq" style="animation-duration:${(1.1 + (i % 4) * 0.37).toFixed(2)}s;animation-delay:-${(i * 0.29).toFixed(2)}s" x="${(cx - barW / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"/>`,
      cap: `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(base - bh - 7).toFixed(1)}" width="${barW.toFixed(1)}" height="2" fill="${t.fg}" opacity=".85"/>
<text x="${cx}" y="${(base - bh - 14).toFixed(1)}" font-size="20" text-anchor="middle">${pct}<tspan class="dim">%</tspan></text>`,
      label: `<text x="${cx}" y="${base + 26}" font-size="20" text-anchor="middle">${esc(SHORT[name] ?? name)}</text>
<text x="${cx}" y="${base + 44}" font-size="9" text-anchor="middle" class="silk dim">${repos ? `${repos} REPO${repos > 1 ? "S" : ""}` : "—"}</text>`,
    };
  });

  return screen(t, {
    h,
    title: "Most used languages",
    defs: `<pattern id="segp" width="8" height="7" y="${base}" patternUnits="userSpaceOnUse"><rect width="8" height="5" fill="#fff"/></pattern>
<mask id="seg"><rect x="0" y="${top - 40}" width="${W}" height="${H + 40}" fill="url(#segp)"/></mask>`,
    css: `.eq{transform-box:fill-box;transform-origin:50% 100%;animation:eq 1.4s ease-in-out infinite alternate}
@keyframes eq{from{transform:scaleY(1)}to{transform:scaleY(.82)}}`,
    body: `${playIcon(t, 34, 52)}
<text x="56" y="52" font-size="28" class="osd" ${glowAttr(t)}>LANGUAGES</text>
<text x="${right}" y="52" font-size="28" text-anchor="end" class="dim">INPUT <tspan class="osd">${repoTotal}</tspan> REPOS</text>
<g stroke="${t.grid}" stroke-width="1" stroke-dasharray="2 3">${scale}</g>
<g ${glowAttr(t)}><g mask="url(#seg)">${cols.map((c) => c.bar).join("\n")}</g></g>
${cols.map((c) => c.cap).join("\n")}
<line x1="${left - 6}" y1="${base + 0.5}" x2="${right}" y2="${base + 0.5}" stroke="${t.dim}"/>
${cols.map((c) => c.label).join("\n")}`,
  });
}
