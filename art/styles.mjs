// Cover art in different styles, from one JSON spec. The cover is also the printed label.
//
//   node styles.mjs list                              style names + one-line descriptions
//   node styles.mjs render <spec.json> <out.png>      one cover, 638x1011
//   node styles.mjs gallery <out.png> <a.json> <b.json> <c.json>
//                                                     three different cover designs, numbered 1-3
//   node styles.mjs gallery <out.png> <spec.json> --options=balloon,paper+clay,crayon
//                                                     one design in three styles (quick look only)
//   node styles.mjs palette <image>                   dominant colours of an image (source artwork)
//
// Run with FONTCONFIG_FILE=<art/fonts.conf> so the Rubik font is found.
//
// Spec (coordinates are in a 160 x 253 box, like the pixel covers; colours are hex):
// {
//   "style": "paper+clay",            // one style, or base+shapes to mix two
//   "title": "עוץ לי גוץ לי", "subtitle": "Rumpelstiltskin", "rtl": true,
//   "palette": ["#e23c3c", "#f5c542", "#3a7bd5", "#2e2a4f"],   // from `palette` on the source art
//   "background": "#2e2a4f",                                    // optional; default per style
//   "titleY": 42, "subtitleY": 240, "titleSize": 22, "titleColor": "#fff", // all optional
//   "layers": [
//     { "motif": "moon", "x": 120, "y": 70, "size": 30, "color": "#f5c542" },
//     { "path": "M 10 200 Q 80 150 150 200 V 253 H 10 Z", "color": "#3a7bd5" },
//     { "artwork": "brief/art/show.jpg", "x": 30, "y": 80, "w": 100, "h": 100, "shape": "circle" }
//   ]
// }
// A motif layer is drawn centred on x,y at `size` across; a path layer as given. Later layers
// are drawn on top. `artwork` puts a real image from the source on the cover, framed in the
// style. Motifs: see MOTIFS below - anything else is drawn as a path. Any layer can set its
// own "style". The title and subtitle are always plain, readable text over the art.
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { extname } from "path";

const VW = 160, VH = 253, OUT_W = 638, OUT_H = 1011;

// ---------- colour ----------
const hex2rgb = (h) => {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const rgb2hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));
const darker = (c, t = 0.35) => mix(c, "#000000", t);
const lighter = (c, t = 0.45) => mix(c, "#ffffff", t);
const luma = (c) => { const [r, g, b] = hex2rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const dist = (a, b) => hex2rgb(a).reduce((s, v, i) => s + (v - hex2rgb(b)[i]) ** 2, 0);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Real risograph drum colours; a riso cover snaps every colour to the nearest of these.
const RISO_INKS = ["#ff48b0", "#0078bf", "#ffe800", "#00a95c", "#ff6c2f", "#00838a", "#765ba7", "#ff665e", "#3d5588", "#000000"];
const RISO_PAPER = "#f6efe1";
// Near-white means "no ink": the paper shows through, as it would on a real riso print.
const toInk = (c) => (luma(c) > 225 ? RISO_PAPER : RISO_INKS.reduce((best, ink) => (dist(c, ink) < dist(c, best) ? ink : best)));

// ---------- motifs (100 x 100 box, centred on 50,50) ----------
// Each part: [path, tone] where tone shades the layer colour: 0 as is, -1 darker, 1 lighter,
// "w" white, "k" near-black.
const rays = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2, b = a + 0.13, c = a - 0.13;
  const p = (r, t) => `${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`;
  return `M ${p(30, c)} L ${p(48, a)} L ${p(30, b)} Z`;
}).join(" ");
const star5 = (cx, cy, R, r) => "M " + Array.from({ length: 10 }, (_, i) => {
  const t = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R;
  return `${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`;
}).join(" L ") + " Z";
export const MOTIFS = {
  sun: [[rays, 1], ["M 50 24 A 26 26 0 1 1 49.9 24 Z", 0]],
  moon: [["M 62 10 A 40 40 0 1 0 90 66 A 32 32 0 1 1 62 10 Z", 0]],
  star: [[star5(50, 52, 46, 19), 0]],
  cloud: [["M 22 70 A 16 16 0 0 1 26 40 A 20 20 0 0 1 60 30 A 18 18 0 0 1 84 46 A 13 13 0 0 1 80 70 Z", 0]],
  heart: [["M 50 88 C 10 60 4 36 22 22 C 36 12 48 22 50 32 C 52 22 64 12 78 22 C 96 36 90 60 50 88 Z", 0]],
  tree: [["M 44 60 H 56 V 96 H 44 Z", "k"], ["M 50 4 C 80 4 92 30 84 50 C 80 64 64 68 50 66 C 36 68 20 64 16 50 C 8 30 20 4 50 4 Z", 0]],
  house: [["M 18 48 L 50 18 L 82 48 Z", -1], ["M 24 46 H 76 V 92 H 24 Z", 0], ["M 43 66 H 57 V 92 H 43 Z", "k"], ["M 30 54 H 40 V 64 H 30 Z", "w"]],
  fish: [["M 12 50 C 30 22 64 22 78 50 C 64 78 30 78 12 50 Z", 0], ["M 76 50 L 96 32 L 92 50 L 96 68 Z", -1], ["M 30 46 A 4 4 0 1 1 29.9 46 Z", "k"]],
  flower: [...[0, 72, 144, 216, 288].map((d) => {
    const t = (d * Math.PI) / 180, x = 50 + 22 * Math.cos(t), y = 42 + 22 * Math.sin(t);
    return [`M ${x - 14} ${y} A 14 14 0 1 1 ${x - 13.9} ${y} Z`, 0];
  }), ["M 48 60 H 52 V 98 H 48 Z", "k"], ["M 50 30 A 12 12 0 1 1 49.9 30 Z", "w"]],
  crown: [["M 10 80 L 14 30 L 32 54 L 50 20 L 68 54 L 86 30 L 90 80 Z", 0], ["M 10 80 H 90 V 92 H 10 Z", -1]],
  hill: [["M 0 100 C 20 40 80 40 100 100 Z", 0]],
  balloon: [["M 50 6 C 76 6 84 30 80 46 C 76 62 60 74 50 76 C 40 74 24 62 20 46 C 16 30 24 6 50 6 Z", 0], ["M 46 76 L 54 76 L 50 82 Z", -1], ["M 50 82 C 46 88 54 94 50 100", "string"]],
  car: [["M 8 64 L 16 44 C 20 36 30 32 40 32 H 62 C 72 32 80 38 84 46 L 94 50 V 70 H 8 Z", 0], ["M 26 40 H 48 V 50 H 20 Z", "w"], ["M 54 40 H 68 C 74 40 76 44 78 50 H 54 Z", "w"], ["M 28 70 A 10 10 0 1 1 27.9 70 Z", "k"], ["M 74 70 A 10 10 0 1 1 73.9 70 Z", "k"]],
  note: [["M 40 76 A 12 9 0 1 1 39.9 76 Z M 48 74 V 14 L 80 6 V 22 L 52 30 V 74 Z", 0]],
  book: [["M 6 24 C 22 18 40 20 50 28 C 60 20 78 18 94 24 V 84 C 78 78 60 80 50 88 C 40 80 22 78 6 84 Z", 0], ["M 48 28 H 52 V 88 H 48 Z", -1]],
};

// ---------- styles ----------
// Each style: describe, bg (default background), defs, part (one filled path), frame (source
// artwork), overlay (texture over the scene) and optional grid (pixelation). Titles are NOT
// styled: they are one clean, readable overlay on top of every style (see titleSvg).
let uid = 0;
const id = (p) => `${p}${++uid}`;

const grain = (op = 0.18, freq = 0.9) => {
  const f = id("g");
  return `<filter id="${f}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 ${op * 4} 0"/></filter>
<rect width="${VW}" height="${VH}" filter="url(#${f})" style="mix-blend-mode:multiply"/>`;
};

// The artwork's outline, grown by `pad`: an ellipse for a round crop, a rounded rect otherwise.
const edge = (b, pad, attrs, dx = 0, dy = 0) => b.round
  ? `<ellipse cx="${b.x + b.w / 2 + dx}" cy="${b.y + b.h / 2 + dy}" rx="${b.w / 2 + pad}" ry="${b.h / 2 + pad}" ${attrs}/>`
  : `<rect x="${b.x - pad + dx}" y="${b.y - pad + dy}" width="${b.w + 2 * pad}" height="${b.h + 2 * pad}" rx="${b.r + pad}" ${attrs}/>`;

const fontFamily = 'font-family="Rubik ExtraBold, Rubik" font-weight="800"';
const textEl = (t, x, y, size, attrs, rtl) =>
  `<text x="${x}" y="${y}" font-size="${size}" ${fontFamily} text-anchor="middle" direction="${rtl ? "rtl" : "ltr"}" ${attrs}>${esc(t)}</text>`;

// Titles: plain bold letters with a thick contrasting outline and a soft shadow, the same in
// every style. Art makes lettering hard to read, so the title is never part of the art.
function titleSvg(spec, P, bg) {
  const rtl = !!spec.rtl;
  const fill = spec.titleColor || (luma(bg) < 120 ? "#ffffff" : P.find((p) => luma(p) < 110) || "#2b2340");
  const outline = luma(fill) > 140 ? "#1f1a2e" : "#ffffff";
  const size = spec.titleSize || Math.min(24, 150 / Math.max(4, [...(spec.title || "")].length * 0.62));
  const line = (t, y, s, f, o, r) =>
    textEl(t, 80, y + s * 0.06, s, `fill="#000" opacity=".25"`, r) +
    textEl(t, 80, y, s, `fill="${f}" stroke="${o}" stroke-width="${(s / 5.5).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"`, r);
  const lines = String(spec.title || "").split("\n");
  let svg = lines.map((t, i) => line(t, (spec.titleY ?? 36) + i * size * 1.05, size, fill, outline, rtl)).join("");
  if (spec.subtitle) {
    const s = spec.subtitleSize || 11;
    svg += line(spec.subtitle, spec.subtitleY ?? 240, s, spec.subtitleColor || fill, outline, !!spec.subtitleRtl);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${VW} ${VH}">${svg}</svg>`;
}

const STYLES = {
  pixel: {
    describe: "Chunky pixels and a small palette, like an old video game.",
    bg: (P) => darker(P[3] || P[0], 0.55),
    part: (d, c) => `<path d="${d}" fill="${c}"/>`,
    frame: (img, box) => img(box) + edge(box, 0, `fill="none" stroke="#000" stroke-width="3"`),
    overlay: () => "",
    // Render smooth, then drop to an 80-pixel-wide grid and blow it back up without smoothing.
    grid: 80, // the scene is pixelated to an 80-pixel-wide grid; titles stay crisp on top
  },

  balloon: {
    describe: "Shiny twisted-balloon shapes and puffy lettering with soft highlights.",
    bg: (P) => lighter(P[2] || P[0], 0.75),
    defs: (P) => {
      const f = "bsh";
      return `<filter id="${f}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dx="1.5" dy="2.5"/><feComponentTransfer><feFuncA type="linear" slope=".35"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<pattern id="bdots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1.6" fill="#fff" opacity=".55"/></pattern>`;
    },
    backdrop: () => `<rect width="${VW}" height="${VH}" fill="url(#bdots)"/>`,
    part: (d, c, reg) => {
      const g = reg(`<radialGradient id="@" cx="32%" cy="28%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".18" stop-color="${lighter(c, 0.25)}"/><stop offset=".65" stop-color="${c}"/><stop offset="1" stop-color="${darker(c, 0.4)}"/></radialGradient>`);
      return `<path d="${d}" fill="url(#${g})" stroke="${darker(c, 0.45)}" stroke-width=".6" filter="url(#bsh)"/>`;
    },
    frame: (img, box, c) => `<g filter="url(#bsh)">${img(box)}${edge(box, 0, `fill="none" stroke="${c}" stroke-width="5"`)}${edge(box, 0, `fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="6 14"`)}</g>`,
    overlay: () => "",
  },

  isometric: {
    describe: "Little 3D blocks and scenes, each shape extruded with three shades.",
    bg: (P) => lighter(P[2] || P[0], 0.82),
    defs: (P, bg) => `<pattern id="iso" width="20" height="11.547" patternUnits="userSpaceOnUse"><path d="M 0 0 L 20 11.547 M 20 0 L 0 11.547" stroke="${darker(bg, 0.12)}" stroke-width=".35"/></pattern>`,
    backdrop: () => `<rect width="${VW}" height="${VH}" fill="url(#iso)"/>`,
    part: (d, c) => {
      // Stacked copies along the isometric depth axis make solid side faces; the top face
      // gets a light edge, like a block lit from the upper left.
      const steps = 14, side = darker(c, 0.42);
      let s = "";
      for (let i = steps; i > 0; i--) s += `<path d="${d}" transform="translate(${(i * 0.6).toFixed(2)} ${(i * 0.42).toFixed(2)})" fill="${side}" stroke="${side}" stroke-width=".6"/>`;
      return s + `<path d="${d}" transform="translate(.5 .35)" fill="${darker(c, 0.2)}"/><path d="${d}" fill="${c}" stroke="${lighter(c, 0.45)}" stroke-width=".7" stroke-linejoin="round"/>`;
    },
    frame: (img, box, c) => {
      let s = "";
      for (let i = 14; i > 0; i--) s += edge(box, 0, `fill="${darker(c, 0.42)}"`, i * 0.6, i * 0.42);
      return s + img(box);
    },
    overlay: () => "",
  },

  risograph: {
    describe: "Two or three bright inks with halftone dots, slightly off-register, on warm paper.",
    ink: true,
    bg: () => RISO_PAPER,
    part: (d, c, reg) => {
      if (c === RISO_PAPER) return `<path d="${d}" fill="${c}" stroke="#3d5588" stroke-width=".9" style="mix-blend-mode:multiply"/>`;
      const p = reg(`<pattern id="@" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(22)"><circle cx="1.6" cy="1.6" r="1.15" fill="${c}"/></pattern>`);
      return `<g style="mix-blend-mode:multiply"><path d="${d}" fill="url(#${p})" transform="translate(1.6 1.1)"/><path d="${d}" fill="${c}" opacity=".82"/></g>`;
    },
    frame: (img, box, c) => `<g style="mix-blend-mode:multiply">${edge(box, 0, `fill="${c}" opacity=".85"`, 2.2, 1.6)}${img(box, `filter="url(#duo)"`)}</g>`,
    defs: (P) => {
      // Duotone the source artwork into the darkest ink, like a riso plate, so it stays legible.
      const darkest = [...P].filter((p) => p !== RISO_PAPER).sort((a, b) => luma(a) - luma(b))[0] || "#3d5588";
      const [r, g, b] = hex2rgb(darkest).map((v) => v / 255);
      return `<filter id="duo"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="table" tableValues="${r} 1"/><feFuncG type="table" tableValues="${g} 1"/><feFuncB type="table" tableValues="${b} 1"/></feComponentTransfer></filter>`;
    },
    overlay: () => grain(0.1, 1.1),
  },

  watercolour: {
    describe: "Soft washes that bleed past the lines, with a loose ink outline, on textured paper.",
    bg: () => "#fbf7ee",
    defs: () => `<filter id="wc" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="3"/><feDisplacementMap in="SourceGraphic" scale="9"/><feGaussianBlur stdDeviation=".6"/></filter>
<filter id="wc2" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="9"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter>
<filter id="ink" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>`,
    part: (d, c) => `<path d="${d}" fill="${c}" opacity=".5" filter="url(#wc)"/><path d="${d}" fill="${c}" opacity=".38" filter="url(#wc2)" transform="translate(-.8 .6)"/><path d="${d}" fill="none" stroke="${darker(c, 0.6)}" stroke-width=".7" filter="url(#ink)"/>`,
    frame: (img, box, c) => edge(box, 3, `fill="${c}" opacity=".45" filter="url(#wc)"`) + img(box, `opacity=".92"`),
    overlay: () => grain(0.08, 0.7),
  },

  paper: {
    describe: "Layered coloured paper with white cut edges and soft shadows, like a collage.",
    bg: (P) => P[3] || darker(P[0], 0.3),
    defs: () => `<filter id="pc" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.6"/><feOffset dx="1.2" dy="2"/><feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    part: (d, c) => `<g filter="url(#pc)"><path d="${d}" fill="#fff" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><path d="${d}" fill="${c}"/></g>`,
    frame: (img, box) => `<g filter="url(#pc)" transform="rotate(-3 ${box.x + box.w / 2} ${box.y + box.h / 2})">${edge(box, 4, `fill="#fff"`)}${img(box)}</g>`,
    overlay: () => grain(0.07, 0.6),
  },

  crayon: {
    describe: "Wobbly thick outlines and waxy crayon colouring, like a child's own drawing.",
    bg: () => "#fffdf6",
    defs: () => `<filter id="wob" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="turbulence" baseFrequency=".06" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>
<filter id="wax" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="1.4 .25" numOctaves="2" seed="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.55" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in" result="c"/><feDisplacementMap in="c" in2="n" scale="2"/></filter>`,
    part: (d, c) => `<path d="${d}" fill="${c}" filter="url(#wax)"/><path d="${d}" fill="none" stroke="${darker(c, 0.55)}" stroke-width="1.6" stroke-linejoin="round" filter="url(#wob)"/>`,
    frame: (img, box, c) => img(box) + edge(box, 0, `fill="none" stroke="${c}" stroke-width="2.4" filter="url(#wob)"`),
    overlay: () => grain(0.06, 0.9),
  },

  clay: {
    describe: "Soft rounded plasticine shapes with gentle 3D lighting.",
    bg: (P) => lighter(P[2] || P[0], 0.6),
    defs: () => `<filter id="clay" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b"/><feSpecularLighting in="b" surfaceScale="4" specularConstant=".55" specularExponent="14" lighting-color="#fff" result="s"><fePointLight x="-40" y="-60" z="120"/></feSpecularLighting><feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/><feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="sh0"/><feOffset in="sh0" dx="1.5" dy="2.5" result="sh"/><feComponentTransfer in="sh" result="sh2"><feFuncA type="linear" slope=".35"/></feComponentTransfer><feMerge><feMergeNode in="sh2"/><feMergeNode in="SourceGraphic"/><feMergeNode in="s2"/></feMerge></filter>
<filter id="clayT" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation=".7" result="b"/><feSpecularLighting in="b" surfaceScale="2.5" specularConstant=".6" specularExponent="16" lighting-color="#fff" result="s"><fePointLight x="-40" y="-60" z="120"/></feSpecularLighting><feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/><feOffset in="SourceAlpha" dx="1" dy="1.6" result="sh"/><feComponentTransfer in="sh" result="sh2"><feFuncA type="linear" slope=".3"/></feComponentTransfer><feMerge><feMergeNode in="sh2"/><feMergeNode in="SourceGraphic"/><feMergeNode in="s2"/></feMerge></filter>`,
    part: (d, c) => `<path d="${d}" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round" filter="url(#clay)"/>`,
    frame: (img, box, c) => edge(box, 4, `fill="${c}" filter="url(#clay)"`) + img(box),
    overlay: () => "",
  },
};

export const STYLE_NAMES = Object.keys(STYLES);

// ---------- rendering ----------
function imageHref(path) {
  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
  const type = ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg";
  return `data:image/${type};base64,${buf.toString("base64")}`;
}

// A style option is one name ("paper") or a mix ("paper+clay": the first gives the
// background, texture and frames, the second draws the shapes). Single layers can also set
// their own "style".
function parseStyle(name) {
  const [base, shapes] = String(name || "").split("+");
  for (const n of [base, shapes].filter(Boolean))
    if (!STYLES[n]) throw new Error(`unknown style "${n}" - one of: ${STYLE_NAMES.join(", ")}`);
  return { base, shapes: shapes || base };
}

function buildSvg(spec) {
  const { base, shapes } = parseStyle(spec.style);
  const st = STYLES[base];
  let P = spec.palette?.length ? [...spec.palette] : ["#e5484d", "#f5c542", "#3a7bd5", "#2e2a4f"];
  if (st.ink) P = P.map(toInk);
  const col = (c) => (st.ink ? toInk(c) : c);
  const bg = spec.background ? col(spec.background) : st.bg(P);
  spec._P = P; spec._bg = bg;

  const extraDefs = [];
  const reg = (tpl) => { const i = id("r"); extraDefs.push(tpl.replace("@", i)); return i; };

  const used = new Set([base, shapes, ...(spec.layers || []).map((l) => l.style).filter(Boolean)]);
  for (const n of used) if (!STYLES[n]) throw new Error(`unknown style "${n}"`);
  const body = [];
  for (const L of spec.layers || []) {
    const ls = STYLES[L.style || (L.artwork ? base : shapes)];
    if (L.artwork) {
      if (!existsSync(L.artwork)) throw new Error(`artwork not found: ${L.artwork}`);
      const box = { x: L.x, y: L.y, w: L.w, h: L.h, round: L.shape === "circle", r: L.r ?? 6 };
      const clip = reg(L.shape === "circle"
        ? `<clipPath id="@"><ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}"/></clipPath>`
        : `<clipPath id="@"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.r}"/></clipPath>`);
      const href = imageHref(L.artwork);
      const img = (b, extra = "") => `<image href="${href}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" ${extra}/>`;
      body.push(ls.frame(img, box, col(L.color || P[0])));
      continue;
    }
    const c = col(L.color || P[0]);
    const tone = (t) => (t === 0 ? c : t === -1 ? darker(c, 0.3) : t === 1 ? lighter(c, 0.3) : t === "w" ? "#ffffff" : t === "k" ? (st.ink ? toInk("#3d5588") : "#3b2a20") : c);
    if (L.motif) {
      const parts = MOTIFS[L.motif];
      if (!parts) throw new Error(`unknown motif "${L.motif}" - one of: ${Object.keys(MOTIFS).join(", ")}, or give a path`);
      const s = (L.size || 40) / 100;
      const flip = L.flip ? ` scale(-1 1) translate(-100 0)` : "";
      const rot = L.rotate ? ` rotate(${L.rotate} 50 50)` : "";
      body.push(`<g transform="translate(${L.x - (L.size || 40) / 2} ${L.y - (L.size || 40) / 2}) scale(${s})${flip}${rot}">` +
        parts.map(([d, t]) => (t === "string" ? `<path d="${d}" fill="none" stroke="${darker(c, 0.5)}" stroke-width="1.5"/>` : ls.part(d, tone(t), reg))).join("") + `</g>`);
    } else if (L.path) {
      body.push(ls.part(L.path, c, reg));
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${VW} ${VH}">
<defs>${[...used].map((n) => (STYLES[n].defs ? STYLES[n].defs(P, bg) : "")).join("")}${extraDefs.join("")}</defs>
<rect width="${VW}" height="${VH}" fill="${bg}"/>
${st.backdrop ? st.backdrop(P) : ""}
${body.join("\n")}
${st.overlay()}
</svg>`;
}

export async function render(spec) {
  const scene = buildSvg(spec);
  const grid = STYLES[parseStyle(spec.style).base].grid;
  let img;
  if (grid) {
    // Pixel style: render smooth, drop to a coarse grid, blow back up without smoothing.
    const small = await sharp(Buffer.from(scene)).resize(grid, Math.round((grid * OUT_H) / OUT_W), { kernel: "nearest" }).png().toBuffer();
    img = await sharp(small).resize(OUT_W, OUT_H, { kernel: "nearest" }).png().toBuffer();
  } else {
    img = await sharp(Buffer.from(scene)).resize(OUT_W, OUT_H).png().toBuffer();
  }
  const title = titleSvg(spec, spec._P, spec._bg);
  return sharp(img).composite([{ input: Buffer.from(title) }]).png().toBuffer();
}

// Dominant colours of an image: a small k-means over a thumbnail, most common first.
export async function palette(path, k = 5) {
  const { data, info } = await sharp(path).resize(48, 48, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]]);
  let cents = Array.from({ length: k }, (_, i) => px[Math.floor(((i + 0.5) / k) * px.length)]);
  let assign = [];
  for (let it = 0; it < 12; it++) {
    assign = px.map((p) => cents.reduce((bi, c, j) => (c.reduce((s, v, q) => s + (v - p[q]) ** 2, 0) < cents[bi].reduce((s, v, q) => s + (v - p[q]) ** 2, 0) ? j : bi), 0));
    cents = cents.map((c, j) => {
      const m = px.filter((_, i) => assign[i] === j);
      return m.length ? [0, 1, 2].map((q) => m.reduce((s, p) => s + p[q], 0) / m.length) : c;
    });
  }
  const counts = cents.map((_, j) => assign.filter((a) => a === j).length);
  return cents.map((c, j) => ({ hex: rgb2hex(c), share: +(counts[j] / px.length).toFixed(2) }))
    .sort((a, b) => b.share - a.share);
}

const SAMPLE = {
  title: "Sample Stories", subtitle: "a Yoto card",
  palette: ["#e5484d", "#f5c542", "#3a7bd5", "#2e2a4f"],
  layers: [
    { motif: "sun", x: 118, y: 78, size: 46, color: "#f5c542" },
    { motif: "cloud", x: 46, y: 84, size: 40, color: "#ffffff" },
    { path: "M 0 200 C 40 150 90 160 160 190 V 253 H 0 Z", color: "#3a7bd5" },
    { motif: "tree", x: 44, y: 160, size: 48, color: "#3fa34d" },
    { motif: "house", x: 108, y: 168, size: 50, color: "#e5484d" },
  ],
};

// The options shown to the parent: exactly three, each its own full design (different
// picture, layout and style), side by side and numbered. A spec may carry "optionLabel", a
// few words shown under its number ("the show's own picture").
export const DEFAULT_OPTIONS = ["balloon", "paper+clay", "crayon"];

async function gallery(out, specs) {
  if (specs.length > 3) throw new Error("show at most 3 options");
  const thumbW = 300, thumbH = 475, pad = 20, label = 70;
  const W = specs.length * thumbW + (specs.length + 1) * pad, H = thumbH + label + 2 * pad;
  const comps = [];
  for (const [i, spec] of specs.entries()) {
    const png = await render(spec);
    const x = pad + i * (thumbW + pad);
    comps.push({ input: await sharp(png).resize(thumbW, thumbH).png().toBuffer(), left: x, top: pad });
    const note = spec.optionLabel ? `<text x="${thumbW / 2}" y="58" font-size="17" font-family="Rubik" text-anchor="middle" fill="#6a5a7a" direction="${/[\u0590-\u06ff]/.test(spec.optionLabel) ? "rtl" : "ltr"}">${esc(spec.optionLabel)}</text>` : "";
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${thumbW}" height="${label}"><text x="${thumbW / 2}" y="28" font-size="26" font-family="Rubik" font-weight="800" text-anchor="middle" fill="#333">${i + 1}</text>${note}</svg>`), left: x, top: pad + thumbH + 4 });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#f1efe9" } }).composite(comps).png().toFile(out);
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "list") console.log(JSON.stringify(Object.fromEntries(STYLE_NAMES.map((n) => [n, STYLES[n].describe])), null, 2));
    else if (cmd === "render") { writeFileSync(b, await render(JSON.parse(readFileSync(a, "utf8")))); console.log(b); }
    else if (cmd === "gallery") {
      // gallery <out.png> <a.json> <b.json> <c.json>  - three different designs (the normal case)
      // gallery <out.png> <spec.json> --options=a,b,c - one design in three styles (quick look)
      const files = process.argv.slice(4).filter((x) => !x.startsWith("--"));
      const opt = process.argv.find((x) => x.startsWith("--options="));
      const load = (f) => JSON.parse(readFileSync(f, "utf8"));
      let specs;
      if (files.length > 1) specs = files.map(load);
      else {
        const base = files.length ? load(files[0]) : SAMPLE;
        specs = (opt ? opt.split("=")[1].split(",") : DEFAULT_OPTIONS).map((st) => ({ ...base, style: st }));
      }
      console.log(await gallery(a, specs));
    }
    else if (cmd === "palette") console.log(JSON.stringify(await palette(a), null, 2));
    else { console.error("usage: node styles.mjs list | render <spec.json> <out.png> | gallery <out.png> <a.json> <b.json> <c.json> | gallery <out.png> <spec.json> --options=a,b,c | palette <image>"); process.exit(1); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
