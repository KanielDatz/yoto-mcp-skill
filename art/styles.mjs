// Cover art in different styles, from one JSON spec. The cover is also the printed label.
//
//   node styles.mjs list                              style names + one-line descriptions
//   node styles.mjs motifs                            the ready-made filler shapes
//   node styles.mjs inspire [--n=3]                   three random, different concept starting points
//   node styles.mjs chosen <n>                        record which option the parent picked
//   node styles.mjs history                           concepts used on recent cards
//   node styles.mjs render <spec.json> <out.png>      one cover, 638x1011
//   node styles.mjs gallery <out.png> <a.json> <b.json> <c.json>
//                                                     three different cover designs, numbered 1-3.
//                                                     Refuses options that share a concept, style or
//                                                     composition, lack "concept"/"elements", the real
//                                                     artwork, or hand-drawn objects, or repeat a
//                                                     concept from a recent card.
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
//
// More layer types: { "label": "text", x, y, size, color, bg } small readable text;
// { "frame": "stamp|card|book|case|ticket|scroll|globe|stage", x, y, w, h, color };
// { "dots": [[x,y],...], color, stations } dotted trail with stops; { "tiles": [[x,y],...], size };
// { "sprite": ["..ab..", ...], palette: { a: "#hex" }, x, y, cell } pixel sprite.
// Any layer can have "depth": 1-5 (diorama style: back wall to front, shadows grow).
// Options also carry "concept": { name, idea, ideaShort, composition, inspiration } and
// "elements": [{ name, episode }] - see SKILL.md, "Cover concepts".
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { extname, dirname, join } from "path";

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
// "w" white, "k" near-black, "#rrggbb" a fixed colour, "string" an outline only.
// These are fillers. Objects that are specific to a card's content should be drawn by hand as
// `path` layers - see SKILL.md, "Cover concepts".
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
  // --- animals and sea life ---
  octopus: [["M 22 50 C 22 14 78 14 78 50 C 78 62 84 70 92 78 C 82 82 74 74 70 68 C 70 80 74 90 68 98 C 60 92 60 82 58 72 C 54 84 52 94 46 98 C 40 90 42 80 44 70 C 38 80 32 88 24 90 C 24 80 30 72 32 66 C 24 72 14 74 6 70 C 14 64 22 58 22 50 Z", 0],
    ["M 34 44 A 7 8 0 1 0 48 44 A 7 8 0 1 0 34 44 Z M 54 44 A 7 8 0 1 0 68 44 A 7 8 0 1 0 54 44 Z", "w"], ["M 39 46 A 3 3 0 1 0 45 46 A 3 3 0 1 0 39 46 Z M 59 46 A 3 3 0 1 0 65 46 A 3 3 0 1 0 59 46 Z", "k"]],
  whale: [["M 6 56 C 6 30 40 22 64 32 C 74 36 78 44 80 50 C 86 42 90 32 94 26 C 98 38 96 52 88 60 C 92 64 96 70 96 76 C 90 70 84 66 78 64 C 70 80 44 88 26 84 C 14 82 6 72 6 56 Z", 0],
    ["M 10 64 C 22 80 52 82 72 70 C 56 80 28 80 10 64 Z", 1], ["M 24 50 A 3 3 0 1 0 30 50 A 3 3 0 1 0 24 50 Z", "k"], ["M 40 24 C 38 16 42 10 40 4 M 44 24 C 48 16 54 14 56 8", "string"]],
  crab: [["M 20 60 C 20 40 80 40 80 60 C 80 72 66 78 50 78 C 34 78 20 72 20 60 Z", 0],
    ["M 14 36 C 4 26 10 12 22 14 C 18 20 22 26 28 24 C 30 32 24 38 14 36 Z M 86 36 C 96 26 90 12 78 14 C 82 20 78 26 72 24 C 70 32 76 38 86 36 Z", 0],
    ["M 22 36 L 30 50 L 34 48 L 26 34 Z M 78 36 L 70 50 L 66 48 L 74 34 Z M 24 70 L 10 82 L 14 86 L 28 74 Z M 30 76 L 20 92 L 25 94 L 34 78 Z M 76 70 L 90 82 L 86 86 L 72 74 Z M 70 76 L 80 92 L 75 94 L 66 78 Z", -1],
    ["M 38 40 A 5 5 0 1 0 48 40 A 5 5 0 1 0 38 40 Z M 52 40 A 5 5 0 1 0 62 40 A 5 5 0 1 0 52 40 Z", "w"], ["M 41 41 A 2 2 0 1 0 45 41 A 2 2 0 1 0 41 41 Z M 55 41 A 2 2 0 1 0 59 41 A 2 2 0 1 0 55 41 Z", "k"]],
  turtle: [["M 20 58 L 18 72 L 30 72 L 32 60 Z M 54 58 L 56 72 L 68 72 L 64 58 Z", 1], ["M 70 50 C 76 40 94 42 94 54 C 94 62 82 64 72 60 Z", 1],
    ["M 16 60 C 16 30 72 30 72 60 Z", 0], ["M 30 58 L 36 44 L 52 44 L 58 58 Z", -1], ["M 12 58 H 76 V 64 H 12 Z", -1], ["M 84 50 A 2.5 2.5 0 1 0 89 50 A 2.5 2.5 0 1 0 84 50 Z", "k"]],
  jellyfish: [["M 26 54 C 22 66 32 74 26 90 M 42 56 C 38 70 48 80 42 96 M 58 56 C 54 70 64 80 58 96 M 74 54 C 70 66 80 74 74 90", "string"],
    ["M 14 50 C 14 10 86 10 86 50 C 76 56 66 50 58 56 C 52 50 46 50 40 56 C 32 50 24 56 14 50 Z", 0], ["M 36 34 A 3 3 0 1 0 42 34 A 3 3 0 1 0 36 34 Z M 58 34 A 3 3 0 1 0 64 34 A 3 3 0 1 0 58 34 Z", "k"]],
  starfish: [[star5(50, 54, 46, 20), 0], ["M 47 50 A 3 3 0 1 0 53 50 A 3 3 0 1 0 47 50 Z M 47 30 A 2 2 0 1 0 51 30 A 2 2 0 1 0 47 30 Z M 66 46 A 2 2 0 1 0 70 46 A 2 2 0 1 0 66 46 Z M 30 46 A 2 2 0 1 0 34 46 A 2 2 0 1 0 30 46 Z", 1]],
  shell: [["M 50 88 L 12 46 C 14 22 34 10 50 10 C 66 10 86 22 88 46 Z", 0], ["M 50 88 L 30 18 L 34 17 Z M 50 88 L 50 10 L 54 10 Z M 50 88 L 70 18 L 74 20 Z M 50 88 L 18 34 L 21 31 Z M 50 88 L 82 34 L 79 31 Z", -1], ["M 40 82 H 60 L 56 94 H 44 Z", -1]],
  bird: [["M 20 60 C 20 34 60 26 72 44 L 78 52 C 80 70 60 82 40 80 C 28 78 20 70 20 60 Z", 0], ["M 34 56 C 44 44 60 48 62 60 C 54 66 42 66 34 56 Z", -1], ["M 72 44 L 92 40 L 78 52 Z", "#ffb020"], ["M 60 42 A 3 3 0 1 0 66 42 A 3 3 0 1 0 60 42 Z", "k"]],
  cat: [["M 20 50 L 22 16 L 40 32 H 60 L 78 16 L 80 50 C 80 72 66 84 50 84 C 34 84 20 72 20 50 Z", 0], ["M 34 48 A 4 5 0 1 0 42 48 A 4 5 0 1 0 34 48 Z M 58 48 A 4 5 0 1 0 66 48 A 4 5 0 1 0 58 48 Z", "k"], ["M 46 60 H 54 L 50 65 Z", "#ff6fb5"], ["M 20 62 L 40 62 M 20 70 L 40 66 M 60 62 L 80 62 M 60 66 L 80 70", "string"]],
  rabbit: [["M 32 44 C 24 20 26 4 34 4 C 42 4 44 22 42 44 Z M 58 44 C 56 22 58 4 66 4 C 74 4 76 20 68 44 Z", 0], ["M 34 38 C 30 22 31 12 34 12 C 37 12 38 24 38 38 Z M 62 38 C 62 24 63 12 66 12 C 69 12 70 22 66 38 Z", "#ff9ec4"],
    ["M 24 62 A 26 24 0 1 0 76 62 A 26 24 0 1 0 24 62 Z", 0], ["M 38 58 A 3 4 0 1 0 44 58 A 3 4 0 1 0 38 58 Z M 56 58 A 3 4 0 1 0 62 58 A 3 4 0 1 0 56 58 Z", "k"], ["M 46 68 H 54 L 50 72 Z", "#ff6fb5"]],
  bear: [["M 14 30 A 12 12 0 1 0 38 30 A 12 12 0 1 0 14 30 Z M 62 30 A 12 12 0 1 0 86 30 A 12 12 0 1 0 62 30 Z", 0], ["M 14 56 A 36 34 0 1 0 86 56 A 36 34 0 1 0 14 56 Z", 0],
    ["M 34 68 A 16 12 0 1 0 66 68 A 16 12 0 1 0 34 68 Z", 1], ["M 44 62 A 6 4 0 1 0 56 62 A 6 4 0 1 0 44 62 Z M 33 48 A 4 4 0 1 0 41 48 A 4 4 0 1 0 33 48 Z M 59 48 A 4 4 0 1 0 67 48 A 4 4 0 1 0 59 48 Z", "k"]],
  // --- adventure, places, time ---
  boat: [["M 48 10 H 52 V 62 H 48 Z", "k"], ["M 54 14 L 86 56 H 54 Z", "w"], ["M 46 22 L 20 56 H 46 Z", 1], ["M 8 62 H 92 L 78 82 H 22 Z", 0]],
  rocket: [["M 40 74 C 40 86 50 96 50 96 C 50 96 60 86 60 74 Z", "#ffb020"], ["M 36 56 L 20 80 L 36 74 Z M 64 56 L 80 80 L 64 74 Z", -1], ["M 50 4 C 70 18 72 50 64 74 H 36 C 28 50 30 18 50 4 Z", 0], ["M 42 34 A 8 8 0 1 0 58 34 A 8 8 0 1 0 42 34 Z", "w"]],
  planet: [["M 20 50 A 30 30 0 1 0 80 50 A 30 30 0 1 0 20 50 Z", 0], ["M 26 40 C 40 46 62 44 76 38 C 77 41 78 43 78 46 C 62 52 40 54 24 48 C 24 45 25 42 26 40 Z", 1], ["M 6 56 C 10 66 90 50 94 42 C 96 38 90 36 84 38 C 88 42 20 56 12 52 C 8 51 5 53 6 56 Z", -1]],
  castle: [["M 8 30 H 28 V 92 H 8 Z M 72 30 H 92 V 92 H 72 Z", -1], ["M 14 40 H 86 V 92 H 14 Z", 0], ["M 8 22 H 13 V 30 H 8 Z M 17 22 H 23 V 30 H 17 Z M 72 22 H 77 V 30 H 72 Z M 81 22 H 87 V 30 H 81 Z", -1], ["M 40 92 V 70 C 40 60 60 60 60 70 V 92 Z", "k"], ["M 49 8 H 51 V 40 H 49 Z", "k"], ["M 51 8 L 68 14 L 51 20 Z", "#e5484d"]],
  chest: [["M 10 46 H 90 V 88 H 10 Z", 0], ["M 10 46 C 10 20 90 20 90 46 Z", 1], ["M 10 46 H 90 V 52 H 10 Z M 26 30 H 32 V 88 H 26 Z M 68 30 H 74 V 88 H 68 Z", "#f5c542"], ["M 43 50 H 57 V 66 H 43 Z", "#f5c542"], ["M 48 55 H 52 V 62 H 48 Z", "k"]],
  key: [["M 10 50 A 18 18 0 1 0 46 50 A 18 18 0 1 0 10 50 Z M 44 46 H 92 V 54 H 44 Z M 76 54 H 82 V 66 H 76 Z M 86 54 H 92 V 62 H 86 Z", 0], ["M 21 50 A 7 7 0 1 0 35 50 A 7 7 0 1 0 21 50 Z", "w"]],
  clock: [["M 6 50 A 44 44 0 1 0 94 50 A 44 44 0 1 0 6 50 Z", 0], ["M 14 50 A 36 36 0 1 0 86 50 A 36 36 0 1 0 14 50 Z", "w"], ["M 48 16 H 52 V 22 H 48 Z M 78 48 H 84 V 52 H 78 Z M 48 78 H 52 V 84 H 48 Z M 16 48 H 22 V 52 H 16 Z M 48 24 H 52 V 52 H 48 Z M 50 48 L 72 62 L 70 66 L 48 52 Z", "k"]],
  compass: [["M 6 50 A 44 44 0 1 0 94 50 A 44 44 0 1 0 6 50 Z", 0], ["M 14 50 A 36 36 0 1 0 86 50 A 36 36 0 1 0 14 50 Z", "w"], ["M 50 14 L 58 50 L 42 50 Z", "#e5484d"], ["M 50 86 L 58 50 L 42 50 Z", "k"]],
  xmark: [["M 14 22 L 22 14 L 50 42 L 78 14 L 86 22 L 58 50 L 86 78 L 78 86 L 50 58 L 22 86 L 14 78 L 42 50 Z", 0]],
  pin: [["M 50 96 C 30 66 18 52 18 36 A 32 32 0 1 1 82 36 C 82 52 70 66 50 96 Z", 0], ["M 38 36 A 12 12 0 1 0 62 36 A 12 12 0 1 0 38 36 Z", "w"]],
  mountain: [["M 0 92 L 34 30 L 52 58 L 66 40 L 100 92 Z", 0], ["M 26 44 L 34 30 L 42 44 L 38 42 L 34 46 L 30 42 Z M 60 50 L 66 40 L 72 50 L 69 48 L 66 51 L 63 48 Z", "w"]],
  wave: [["M 0 70 C 10 40 40 30 56 44 C 44 44 40 56 50 62 C 62 70 80 60 84 48 C 92 60 98 70 100 70 V 100 H 0 Z", 0]],
  train: [["M 10 40 H 60 V 78 H 10 Z", 0], ["M 56 24 H 88 V 78 H 56 Z", -1], ["M 64 32 H 80 V 48 H 64 Z", "w"], ["M 18 22 H 30 V 40 H 18 Z", "k"], ["M 14 82 A 10 10 0 1 0 34 82 A 10 10 0 1 0 14 82 Z M 38 82 A 10 10 0 1 0 58 82 A 10 10 0 1 0 38 82 Z M 64 82 A 10 10 0 1 0 84 82 A 10 10 0 1 0 64 82 Z", "k"]],
  // --- things kids talk about ---
  drum: [["M 20 10 L 46 30 L 43 33 L 17 13 Z M 80 10 L 54 30 L 57 33 L 83 13 Z", "#8a5a2b"], ["M 14 36 V 76 C 14 90 86 90 86 76 V 36 Z", 0], ["M 14 46 L 26 72 L 38 46 L 50 72 L 62 46 L 74 72 L 86 46 L 86 52 L 74 78 L 62 52 L 50 78 L 38 52 L 26 78 L 14 52 Z", -1], ["M 14 36 A 36 12 0 1 0 86 36 A 36 12 0 1 0 14 36 Z", "w"]],
  microphone: [["M 30 40 C 30 62 70 62 70 40 H 66 C 66 56 34 56 34 40 Z", -1], ["M 36 30 A 14 14 0 0 1 64 30 V 44 A 14 14 0 0 1 36 44 Z", 0], ["M 47 58 H 53 V 86 H 47 Z M 34 86 H 66 V 92 H 34 Z", "k"]],
  bulb: [["M 50 6 C 76 6 86 30 76 48 C 70 58 64 62 64 72 H 36 C 36 62 30 58 24 48 C 14 30 24 6 50 6 Z", 0], ["M 36 74 H 64 V 90 H 36 Z", "k"], ["M 34 22 C 38 16 44 14 48 14 C 44 18 40 22 38 28 Z", "w"]],
  magnifier: [["M 60 58 L 66 52 L 92 78 L 86 84 Z", "k"], ["M 12 40 A 28 28 0 1 0 68 40 A 28 28 0 1 0 12 40 Z", 0], ["M 20 40 A 20 20 0 1 0 60 40 A 20 20 0 1 0 20 40 Z", "#d9f3ff"]],
  gift: [["M 12 40 H 88 V 90 H 12 Z", 0], ["M 8 30 H 92 V 44 H 8 Z", -1], ["M 45 30 H 55 V 90 H 45 Z", "#f5c542"], ["M 50 30 C 36 10 20 20 36 30 Z M 50 30 C 64 10 80 20 64 30 Z", "#f5c542"]],
  bubbles: [["M 20 70 A 12 12 0 1 0 44 70 A 12 12 0 1 0 20 70 Z M 52 40 A 8 8 0 1 0 68 40 A 8 8 0 1 0 52 40 Z M 64 80 A 6 6 0 1 0 76 80 A 6 6 0 1 0 64 80 Z M 34 20 A 5 5 0 1 0 44 20 A 5 5 0 1 0 34 20 Z", "w"]],
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
const isHebrew = (t) => /[\u0590-\u06ff]/.test(String(t));
// U+200F first, so a Hebrew line that starts with a Latin word ("Claude ...") stays right to left.
const textEl = (t, x, y, size, attrs, rtl, anchor = "middle") =>
  `<text x="${x}" y="${y}" font-size="${size}" ${fontFamily} text-anchor="${anchor}" direction="${rtl ? "rtl" : "ltr"}" ${attrs}>${rtl ? "\u200F" : ""}${esc(t)}</text>`;

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
    describe: "A whole video-game scene: stepped sky, ground, chunky pixels and a small palette.",
    bg: (P) => lighter(P[2] || P[0], 0.35),
    // Stepped sky bands (no smooth gradients in pixel art) and a ground strip, unless the
    // spec says "pixelSky": false.
    backdrop: (P, spec) => {
      if (spec.pixelSky === false) return "";
      const sky = spec.skyColor || P[2] || "#4cc9f0", gy = spec.groundY ?? 214;
      // a dark (night) sky only lightens a little towards the horizon, a day sky a lot
      const k = luma(sky) < 90 ? 0.3 : 1;
      const bands = [0.06, 0.18, 0.32, 0.46, 0.6].map((t, i) =>
        `<rect y="${i * 34}" width="${VW}" height="35" fill="${lighter(sky, t * k)}"/>`).join("");
      const ground = spec.groundColor || "#59c36a";
      return bands + `<rect y="170" width="${VW}" height="${VH - 170}" fill="${sky}"/>` +
        `<rect y="${gy}" width="${VW}" height="${VH - gy}" fill="${ground}"/><rect y="${gy}" width="${VW}" height="4" fill="${lighter(ground, 0.3)}"/>`;
    },
    part: (d, c) => `<path d="${d}" fill="${c}"/>`,
    frame: (img, box) => img(box) + edge(box, 0, `fill="none" stroke="#1d1a26" stroke-width="3"`),
    overlay: () => "",
    // Render smooth, drop to a coarse grid (spec.pixelGrid, default 80 wide), cut the palette
    // to spec.pixelColors (default 16), then blow it back up without smoothing. Artwork and
    // titles go on afterwards, crisp, so a real picture never gets blurred.
    grid: 80,
  },

  diorama: {
    describe: "A paper box diorama: 3-5 cut-paper layers stacked in depth, with real shadows between them.",
    bg: (P) => lighter(P[2] || P[0], 0.55),
    depth: true,
    defs: () => [1, 2, 3, 4, 5].map((d) =>
      `<filter id="dep${d}" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="${(0.6 + d * 0.7).toFixed(1)}"/><feOffset dx="${(0.4 * d).toFixed(1)}" dy="${(0.8 + d * 1.1).toFixed(1)}"/><feComponentTransfer><feFuncA type="linear" slope="${(0.22 + d * 0.05).toFixed(2)}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`).join("") +
      `<linearGradient id="dioVig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`,
    // The inside of a box: back wall (the background), two side walls, a floor and a lip, each
    // a shade darker, so the layers look like they stand inside it.
    backdrop: (P, spec, bg) => {
      const i = 12;
      return `<path d="M 0 0 L ${i} ${i} V ${VH - 40} L 0 ${VH} Z" fill="${darker(bg, 0.14)}"/>
<path d="M ${VW} 0 L ${VW - i} ${i} V ${VH - 40} L ${VW} ${VH} Z" fill="${darker(bg, 0.2)}"/>
<path d="M 0 ${VH} L ${i} ${VH - 40} H ${VW - i} L ${VW} ${VH} Z" fill="${spec.floorColor || darker(bg, 0.26)}"/>
<path d="M 0 0 H ${VW} L ${VW - i} ${i} H ${i} Z" fill="${darker(bg, 0.08)}"/>`;
    },
    part: (d, c) => `<path d="${d}" fill="#fff" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="${d}" fill="${c}"/>`,
    frame: (img, box) => edge(box, 3, `fill="#fff"`) + img(box),
    overlay: () => `<rect width="${VW}" height="${VH}" fill="url(#dioVig)"/>` + grain(0.06, 0.7),
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
  const [base, shapes] = String(name || "paper").split("+"); // no style given: paper
  for (const n of [base, shapes].filter(Boolean))
    if (!STYLES[n]) throw new Error(`unknown style "${n}" - one of: ${STYLE_NAMES.join(", ")}`);
  return { base, shapes: shapes || base };
}

// ---------- extra layer types ----------
// Smooth path through points (Catmull-Rom to cubic Bezier).
function smooth(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
// A small readable text label (station names, card names, stamp values). Plain and outlined,
// never styled - same rule as the title. "bg" puts it on a pill instead of an outline.
function labelSvg(L) {
  const size = L.size || 7, fill = L.color || "#2b2340", rtl = L.rtl ?? isHebrew(L.label);
  const wd = L.w || size * 0.56 * [...String(L.label)].length;
  const pill = L.bg ? `<rect x="${L.x - wd / 2 - 3}" y="${L.y - size * 0.95}" width="${wd + 6}" height="${size * 1.35}" rx="${size * 0.6}" fill="${L.bg}"/>` : "";
  const outline = L.outline ?? (L.bg ? null : luma(fill) > 140 ? "#1f1a2e" : "#ffffff");
  return pill + textEl(L.label, L.x, L.y, size, `fill="${fill}"${outline ? ` stroke="${outline}" stroke-width="${(size / 5).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"` : ""}`, rtl);
}
// Decorative frames a concept is built around.
function frameSvg(L, P) {
  const { x, y, w, h } = L, c = L.color || P[0];
  switch (L.frame) {
    case "stamp": { // postage stamp with a perforated edge
      const r = 2.2, step = 6.5, holes = [];
      for (let t = x + step / 2; t < x + w; t += step) holes.push([t, y], [t, y + h]);
      for (let t = y + step / 2; t < y + h; t += step) holes.push([x, t], [x + w, t]);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fffdf6"/>` + holes.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="${r}" fill="${L.holeColor || P._bg}"/>`).join("") +
        `<rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
    }
    case "card": // collectible trading card: gold border, name bar on top, info panel below
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${L.border || "#f5c542"}"/><rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="5" fill="${c}"/>` +
        `<rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="14" rx="4" fill="#fffdf6"/><rect x="${x + 7}" y="${y + h - 30}" width="${w - 14}" height="23" rx="4" fill="#fffdf6" opacity=".92"/>`;
    case "book": { // storybook cover; the spine is on the right for a Hebrew book
      const left = L.spine === "left";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${c}"/><rect x="${left ? x : x + w - 10}" y="${y}" width="10" height="${h}" fill="${darker(c, 0.25)}"/>` +
        `<rect x="${x + 8 + (left ? 10 : 0)}" y="${y + 8}" width="${w - 26}" height="${h - 16}" rx="3" fill="none" stroke="${L.border || "#f5c542"}" stroke-width="1.6"/>`;
    }
    case "case": { // display cabinet with shelves
      const rows = L.rows || 3, sh = (h - 10) / rows;
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c}"/><rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" fill="${L.inside || lighter(c, 0.55)}"/>`;
      for (let i = 1; i <= rows; i++) s += `<rect x="${x + 5}" y="${(y + 5 + i * sh - 4).toFixed(1)}" width="${w - 10}" height="4" fill="${darker(c, 0.15)}"/>`;
      return s + `<path d="M ${x + 10} ${y + 8} L ${x + 26} ${y + 8} L ${x + 12} ${y + h - 10} L ${x + 8} ${y + h - 10} Z" fill="#fff" opacity=".22"/>`;
    }
    case "ticket": // ticket with notched sides and a tear line
      return `<path d="M ${x} ${y} H ${x + w} V ${y + h / 2 - 6} A 6 6 0 0 0 ${x + w} ${y + h / 2 + 6} V ${y + h} H ${x} V ${y + h / 2 + 6} A 6 6 0 0 0 ${x} ${y + h / 2 - 6} Z" fill="${c}"/>` +
        `<line x1="${x + 8}" y1="${y + h / 2}" x2="${x + w - 8}" y2="${y + h / 2}" stroke="#fff" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    case "scroll": { // treasure-map parchment: wobbly edges, rolled ends
      const paper = L.paper || "#f6e3b4";
      const top = Array.from({ length: 9 }, (_, i) => `L ${(x + w * i / 8).toFixed(1)} ${(y + (((i * 37) % 5) - 2) * 0.7).toFixed(1)}`).join(" ");
      const bot = Array.from({ length: 9 }, (_, i) => `L ${(x + w - w * i / 8).toFixed(1)} ${(y + h + (((i * 53) % 5) - 2) * 0.7).toFixed(1)}`).join(" ");
      return `<path d="M ${x} ${y} ${top} ${bot} Z" fill="${paper}" stroke="${darker(paper, 0.3)}" stroke-width="1"/>` +
        `<rect x="${x - 4}" y="${y - 3}" width="8" height="${h + 6}" rx="4" fill="${darker(paper, 0.2)}"/><rect x="${x + w - 4}" y="${y - 3}" width="8" height="${h + 6}" rx="4" fill="${darker(paper, 0.2)}"/>`;
    }
    case "globe": // snow globe: glass dome on a base
      return `<path d="M ${x + w * 0.15} ${y + h} H ${x + w * 0.85} L ${x + w * 0.95} ${y + h + 16} H ${x + w * 0.05} Z" fill="${darker(c, 0.2)}"/>` +
        `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}" fill="${lighter(c, 0.7)}" opacity=".55" stroke="#fff" stroke-width="2"/>`;
    case "stage": // theatre stage: curtains, pelmet and boards
      return `<rect x="${x}" y="${y + h - 14}" width="${w}" height="14" fill="#a0632e"/><path d="M ${x} ${y} H ${x + w * 0.22} C ${x + w * 0.18} ${y + h * 0.4} ${x + w * 0.2} ${y + h * 0.7} ${x + w * 0.12} ${y + h - 14} H ${x} Z" fill="${c}"/>` +
        `<path d="M ${x + w} ${y} H ${x + w * 0.78} C ${x + w * 0.82} ${y + h * 0.4} ${x + w * 0.8} ${y + h * 0.7} ${x + w * 0.88} ${y + h - 14} H ${x + w} Z" fill="${c}"/><path d="M ${x} ${y} H ${x + w} V ${y + 12} C ${x + w * 0.75} ${y + 20} ${x + w * 0.25} ${y + 20} ${x} ${y + 12} Z" fill="${darker(c, 0.2)}"/>`;
    default:
      throw new Error(`unknown frame "${L.frame}" - one of: stamp, card, book, case, ticket, scroll, globe, stage`);
  }
}
// Hand-drawn pixel sprite: rows of characters mapped through a palette, drawn as rects. In the
// pixel style use a cell that is a multiple of 160 / pixelGrid (2 for the default 80) so it
// lands on the grid and stays crisp.
function spriteSvg(L) {
  const cell = L.cell || 2, pal = L.palette || {};
  let out = "";
  L.sprite.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === "." || ch === " ") return;
    if (!pal[ch]) throw new Error(`sprite: no colour for "${ch}" in its palette`);
    out += `<rect x="${L.x + c * cell}" y="${L.y + r * cell}" width="${cell}" height="${cell}" fill="${pal[ch]}"/>`;
  }));
  return out;
}

function buildSvg(spec, pass = "all") {
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
  P._bg = bg;
  // Diorama: every layer sits at a depth (1 = back wall ... 5 = front) and casts a shadow
  // that grows with it. Layers without one go on the back wall.
  const wrapDepth = (L, from) => {
    if (!st.depth || from >= body.length) return;
    const d = Math.max(1, Math.min(5, L.depth || 1));
    body.splice(from, body.length - from, `<g filter="url(#dep${d})">${body.slice(from).join("")}</g>`);
  };
  for (const L of spec.layers || []) {
    const ls = STYLES[L.style || (L.artwork ? base : shapes)];
    // "art" pass: artwork and text labels, which the pixel style draws crisp on top;
    // "noart": everything else
    const crisp = L.artwork || L.label !== undefined;
    if (pass === "art" && !crisp) continue;
    if (pass === "noart" && crisp) continue;
    const start = body.length;
    if (L.label !== undefined) body.push(labelSvg(L));
    else if (L.frame) body.push(frameSvg(L, P));
    else if (L.dots) {
      // dotted trail (treasure map, board-game route) with optional station circles
      const c = col(L.color || "#2b2340");
      body.push(`<path d="${smooth(L.dots)}" fill="none" stroke="${c}" stroke-width="${L.width || 2}" stroke-linecap="round" stroke-dasharray="${L.dash || "0.1 5"}"/>`);
      if (L.stations !== false) body.push(L.dots.map(([a, b], i) => `<circle cx="${a}" cy="${b}" r="${L.r || 4.2}" fill="${col((L.stationColors || [])[i] || L.stationColor || "#ffd23f")}" stroke="${c}" stroke-width="1.2"/>`).join(""));
    } else if (L.tiles) {
      const sz = L.size || 12, cs = L.colors || P;
      body.push(L.tiles.map(([a, b], i) => `<rect x="${a - sz / 2}" y="${b - sz / 2}" width="${sz}" height="${sz}" rx="2" fill="${col(cs[i % cs.length])}" stroke="#fff" stroke-width="1.2"/>`).join(""));
    } else if (L.sprite) body.push(spriteSvg(L));
    if (body.length > start) { wrapDepth(L, start); continue; }
    if (L.artwork) {
      if (!existsSync(L.artwork)) throw new Error(`artwork not found: ${L.artwork}`);
      const box = { x: L.x, y: L.y, w: L.w, h: L.h, round: L.shape === "circle", r: L.r ?? 6 };
      const clip = reg(L.shape === "circle"
        ? `<clipPath id="@"><ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}"/></clipPath>`
        : `<clipPath id="@"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.r}"/></clipPath>`);
      const href = imageHref(L.artwork);
      const img = (b, extra = "") => `<image href="${href}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" ${extra}/>`;
      body.push(ls.frame(img, box, col(L.color || P[0])));
      wrapDepth(L, start);
      continue;
    }
    const c = col(L.color || P[0]);
    const tone = (t) => (t === 0 ? c : t === -1 ? darker(c, 0.3) : t === 1 ? lighter(c, 0.3) : t === "w" ? "#ffffff" : t === "k" ? (st.ink ? toInk("#3d5588") : "#3b2a20") : typeof t === "string" && t.startsWith("#") ? col(t) : c);
    if (L.motif) {
      const parts = MOTIFS[L.motif];
      if (!parts) throw new Error(`unknown motif "${L.motif}" - one of: ${Object.keys(MOTIFS).join(", ")}, or give a path`);
      const s = (L.size || 40) / 100;
      const flip = L.flip ? ` scale(-1 1) translate(-100 0)` : "";
      const rot = L.rotate ? ` rotate(${L.rotate} 50 50)` : "";
      body.push(`<g transform="translate(${L.x - (L.size || 40) / 2} ${L.y - (L.size || 40) / 2}) scale(${s})${flip}${rot}">` +
        parts.map(([d, t]) => (t === "string" ? `<path d="${d}" fill="none" stroke="${darker(c, 0.5)}" stroke-width="1.5"/>` : ls.part(d, tone(t), reg))).join("") + `</g>`);
    } else if (L.path) {
      // Hand-drawn objects: draw in your own little coordinates and place them with
      // "at": [x, y], "scale" and "rotate"; "stroke": <width> draws an outline only (spirals,
      // strings, trails), the same in every style.
      const shape = L.stroke ? `<path d="${L.path}" fill="none" stroke="${c}" stroke-width="${L.stroke}" stroke-linecap="round" stroke-linejoin="round"/>` : ls.part(L.path, c, reg);
      const tf = L.at || L.scale || L.rotate ? ` transform="translate(${(L.at || [0, 0]).join(" ")})${L.rotate ? ` rotate(${L.rotate})` : ""}${L.scale ? ` scale(${L.scale})` : ""}"` : "";
      body.push(tf ? `<g${tf}>${shape}</g>` : shape);
      if (L.opacity) body[body.length - 1] = `<g opacity="${L.opacity}">${body[body.length - 1]}</g>`;
    }
    wrapDepth(L, start);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${VW} ${VH}">
<defs>${[...used].map((n) => (STYLES[n].defs ? STYLES[n].defs(P, bg) : "")).join("")}${extraDefs.join("")}</defs>
${pass === "art" ? "" : `<rect width="${VW}" height="${VH}" fill="${bg}"/>
${st.backdrop ? st.backdrop(P, spec, bg) : ""}`}
${body.join("\n")}
${pass === "art" ? "" : st.overlay()}
</svg>`;
}

export async function render(spec) {
  const base = STYLES[parseStyle(spec.style).base];
  let img;
  const over = [];
  if (base.grid) {
    // Pixel style: render smooth, drop to a coarse grid, limit the palette, blow back up
    // without smoothing. Real artwork goes on afterwards, crisp.
    const grid = spec.pixelGrid || base.grid;
    const small = await sharp(Buffer.from(buildSvg(spec, "noart"))).resize(grid, Math.round((grid * OUT_H) / OUT_W), { kernel: "nearest" })
      .png({ palette: true, colors: spec.pixelColors || 16, dither: 0 }).toBuffer();
    img = await sharp(small).resize(OUT_W, OUT_H, { kernel: "nearest" }).png().toBuffer();
    if ((spec.layers || []).some((l) => l.artwork)) over.push({ input: await sharp(Buffer.from(buildSvg(spec, "art"))).resize(OUT_W, OUT_H).png().toBuffer() });
  } else {
    img = await sharp(Buffer.from(buildSvg(spec))).resize(OUT_W, OUT_H).png().toBuffer();
  }
  over.push({ input: Buffer.from(titleSvg(spec, spec._P, spec._bg)) });
  return sharp(img).composite(over).png().toBuffer();
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

// ---------- concepts ----------
// Starting points, not templates: `inspire` draws three at random (skipping ones used on
// recent cards) and adds a random twist; the agent then invents the actual design from the
// card's own content. Each has a composition (how the card is laid out) and the styles that
// suit it. More can be added freely.
export const CONCEPTS = [
  { id: "treasure-map", name: "מפת אוצר", idea: "A parchment map: a dotted trail winds past one stop per episode to the X, where the show's picture is the treasure.", composition: "full-card scroll, winding trail top to bottom, treasure in the middle", styles: ["paper", "crayon", "watercolour"], uses: "frame:scroll, dots with stations, xmark, labels on stops" },
  { id: "time-machine", name: "מכונת זמן", idea: "A big clock or time machine: the show's picture in the dial, episode objects sitting at the hours around it.", composition: "one big circle in the middle, objects in a ring", styles: ["clay", "isometric", "balloon"], uses: "clock motif scaled up, objects placed on a circle" },
  { id: "collector-card", name: "כרטיס אספנות", idea: "A shiny trading card: the show's picture is the portrait, the episode objects are its powers along the bottom.", composition: "card frame, portrait top half, row of small objects below", styles: ["balloon", "clay", "paper"], uses: "frame:card, labels for name and powers" },
  { id: "board-game", name: "משחק לוח", idea: "A board game: a snake of squares, an episode object on every few squares, the show's picture at the finish.", composition: "S-shaped path of tiles across the whole card", styles: ["isometric", "paper", "clay"], uses: "tiles, dots, star at finish" },
  { id: "diorama", name: "דיורמה", idea: "A paper box with 3-5 layers in depth: sky at the back, scenery in the middle, characters and the show's picture in front.", composition: "stacked depth layers, horizon low, front layer framing the picture", styles: ["diorama"], uses: "depth 1-5 on every layer" },
  { id: "pixel-world", name: "עולם פיקסלים", idea: "A complete video-game level: ground, platforms, the episode objects as sprites, the show's picture as the big screen in the sky.", composition: "side-scrolling level, ground strip, platforms at two heights", styles: ["pixel"], uses: "pixelGrid, sprite layers, groundY" },
  { id: "clay-world", name: "עולם פלסטלינה", idea: "Everything sculpted from plasticine: chunky episode characters crowding around the show's picture like a family photo.", composition: "picture centre, characters overlapping its bottom edge", styles: ["clay"], uses: "hand-drawn path characters" },
  { id: "fridge-drawing", name: "ציור על המקרר", idea: "A child's crayon drawing taped to the fridge: the show's picture taped in the middle, crayon doodles of each episode around it.", composition: "paper sheet slightly rotated, tape corners, doodles scattered", styles: ["crayon"], uses: "path doodles, tape rectangles" },
  { id: "balloon-lift", name: "בלוני הליום", idea: "The show's picture floats up carried by a bunch of balloons, each balloon carrying one episode object.", composition: "picture low-centre, balloons fanning up, strings converging", styles: ["balloon"], uses: "balloon motif, string paths" },
  { id: "floating-island", name: "אי מרחף", idea: "An isometric island floating in the sky: each episode is a little building or object on it, the picture on a flag or billboard.", composition: "diamond island in the middle, objects on top, clouds below", styles: ["isometric"], uses: "hand-drawn island path, objects" },
  { id: "postage-stamp", name: "בול דואר", idea: "A big postage stamp of the show's picture on an envelope, with small postmark stamps for the episodes.", composition: "one big stamp, two or three small ones, wavy postmark lines", styles: ["paper", "risograph"], uses: "frame:stamp, labels for stamp values" },
  { id: "sticker-album", name: "אלבום מדבקות", idea: "An album page: the show's picture is the shiny centre sticker, episode stickers stuck around it slightly crooked.", composition: "grid of sticker slots, some filled and rotated", styles: ["balloon", "paper"], uses: "white-edged shapes, rotations" },
  { id: "storybook", name: "שער ספר סיפורים", idea: "An old storybook cover: the show's picture in an ornate frame, episode objects as the corner ornaments.", composition: "book frame, centred oval picture, four corners", styles: ["watercolour", "paper"], uses: "frame:book, circle artwork" },
  { id: "display-case", name: "ארון תצוגה", idea: "A museum cabinet: shelves of episode treasures, the show's picture as the star exhibit on the middle shelf.", composition: "cabinet with 3 shelves, objects lined up", styles: ["clay", "isometric", "paper"], uses: "frame:case, labels as exhibit tags" },
  { id: "postcard", name: "גלויה", idea: "A holiday postcard from the show's world: the picture on the front, doodles and a stamp from the episodes.", composition: "landscape-ish card, picture left, doodles right", styles: ["watercolour", "crayon"], uses: "frame:stamp small, dots as a route" },
  { id: "snow-globe", name: "כדור שלג", idea: "A snow globe holding the show's picture, episode objects floating inside like snowflakes.", composition: "big circle, base below, objects inside", styles: ["balloon", "watercolour"], uses: "frame:globe, bubbles" },
  { id: "theatre", name: "במת תיאטרון", idea: "A stage: the curtains open on the show's picture as the backdrop, the episode characters are the actors.", composition: "curtains both sides, actors on the boards", styles: ["paper", "clay"], uses: "frame:stage" },
  { id: "comic-page", name: "דף קומיקס", idea: "A comic page: one panel per episode, the show's picture in the big middle panel, speech bubbles with one word each.", composition: "3-4 panels with gutters", styles: ["risograph", "crayon"], uses: "rect panels, labels as speech bubbles" },
  { id: "star-map", name: "מפת כוכבים", idea: "A night-sky map: the episode objects drawn as constellations joined by thin lines, the show's picture as the moon.", composition: "dark sky, constellations scattered, round picture top", styles: ["risograph", "watercolour"], uses: "dots with thin solid lines, stars" },
  { id: "parade-train", name: "רכבת", idea: "A little train across the card: the show's picture rides the engine, each wagon carries one episode object.", composition: "horizontal train across the middle, track below", styles: ["crayon", "isometric", "clay"], uses: "train motif, rectangles as wagons" },
  { id: "porthole", name: "חלון צוללת", idea: "Looking out of a round window: the show's picture fills the window, episode creatures and objects swim or fly past outside.", composition: "big round window centre, objects around the frame", styles: ["clay", "balloon"], uses: "circle artwork, thick ring" },
  { id: "jigsaw", name: "פאזל", idea: "A jigsaw almost finished: the show's picture is the assembled middle, loose pieces around show the episode objects.", composition: "centre block, scattered pieces", styles: ["paper", "isometric"], uses: "hand-drawn puzzle-piece paths" },
];
const TWISTS = ["seen at night, with lights", "everything tiny next to one giant object", "on a rainy day with puddles", "seen from above", "in the middle of a birthday party", "on a windy day, things flying", "in winter, with snow", "at the beach", "inside a big book", "reflected in water", "with the characters waving at the child", "in a rainbow of colours"];

// History of cover concepts, so the same idea isn't offered again on the next cards. Lives
// next to the token file, like the leftover-pieces record.
const coversPath = () => process.env.YOTO_COVERS_STATE ||
  join(dirname(process.env.YOTO_CONFIG_PATH || new URL("../server/.yoto-mcp-config.json", import.meta.url).pathname), ".yoto-covers.json");
const loadCovers = () => { try { return JSON.parse(readFileSync(coversPath(), "utf8")); } catch { return { cards: [] }; } };
const saveCovers = (h) => writeFileSync(coversPath(), JSON.stringify(h, null, 2) + "\n");
const norm = (t) => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
const RECENT = 8; // cards to look back over

export function inspire(n = 3) {
  const recent = loadCovers().cards.slice(-RECENT).flatMap((c) => c.options.map((o) => o.inspiration));
  const pool = CONCEPTS.filter((c) => !recent.includes(c.id));
  const pickFrom = pool.length >= n ? pool : CONCEPTS;
  const shuffled = [...pickFrom].sort(() => Math.random() - 0.5);
  const out = [], styles = new Set();
  for (const c of shuffled) {
    const st = [...c.styles].sort(() => Math.random() - 0.5).find((x) => !styles.has(x));
    if (!st) continue;
    styles.add(st);
    out.push({ inspiration: c.id, name: c.name, idea: c.idea, composition: c.composition, style: st, uses: c.uses, twist: TWISTS[Math.floor(Math.random() * TWISTS.length)] });
    if (out.length === n) break;
  }
  return out;
}

// The gate in front of the parent: three really different designs, built from the content.
function checkOptions(specs, { allowRepeat = false } = {}) {
  const errs = [];
  specs.forEach((s, i) => {
    const n = i + 1, c = s.concept || {};
    if (!c.name || !c.idea) errs.push(`option ${n}: needs "concept": { "name", "idea" (one sentence), "composition" }`);
    if (!c.composition) errs.push(`option ${n}: concept needs a "composition" - how this one is laid out`);
    const el = s.elements || [];
    if (el.length < 2 || el.some((e) => !e.name || !e.episode)) errs.push(`option ${n}: needs "elements": [{ "name", "episode" }, ...] - which objects on it come from which episode (at least 2)`);
    if (!(s.layers || []).some((l) => l.artwork) && !s.noArtworkReason) errs.push(`option ${n}: no artwork layer - put the show's real picture on it, or say why not in "noArtworkReason"`);
    const handDrawn = (s.layers || []).filter((l) => l.path || l.sprite).length;
    if (handDrawn < 2) errs.push(`option ${n}: only ${handDrawn} hand-drawn path/sprite layer(s) - draw the content's own objects, motifs are only fillers`);
  });
  const dup = (key, label) => {
    const seen = new Map();
    specs.forEach((s, i) => { const k = norm(key(s)); if (!k) return; if (seen.has(k)) errs.push(`options ${seen.get(k) + 1} and ${i + 1} share the same ${label} ("${key(s)}") - make them really different`); else seen.set(k, i); });
  };
  dup((s) => s.concept?.name, "concept");
  dup((s) => s.concept?.composition, "composition");
  dup((s) => s.style, "style");
  dup((s) => s.concept?.inspiration, "inspiration");
  const all = new Set(specs.flatMap((s) => (s.elements || []).map((e) => norm(e.name))));
  if (all.size < 6) errs.push(`only ${all.size} different content elements across the options - list 6-8 characters, events or objects from the episodes`);
  if (!allowRepeat) {
    const recent = loadCovers().cards.slice(-RECENT);
    for (const [i, s] of specs.entries()) {
      const hit = recent.find((c) => c.options.some((o) => norm(o.concept) === norm(s.concept?.name) || (s.concept?.inspiration && o.inspiration === s.concept.inspiration)));
      if (hit) errs.push(`option ${i + 1}: concept "${s.concept?.name}" was already used for "${hit.card}" - pick another (or --allow-repeat if the parent asked for it)`);
    }
  }
  if (errs.length) throw new Error("not three real options yet:\n- " + errs.join("\n- "));
}

// The options shown to the parent: three full designs side by side, numbered, each with its
// concept name and one-line idea under it.
export const DEFAULT_OPTIONS = ["balloon", "paper+clay", "crayon"];
const wrapText = (t, n) => { const words = String(t).split(/\s+/), lines = [""]; for (const w of words) { if ((lines.at(-1) + " " + w).trim().length > n) lines.push(w); else lines[lines.length - 1] = (lines.at(-1) + " " + w).trim(); } return lines; };

async function gallery(out, specs, { check = true, allowRepeat = false } = {}) {
  if (specs.length > 3) throw new Error("show at most 3 options");
  if (check) checkOptions(specs, { allowRepeat });
  const thumbW = 300, thumbH = 475, pad = 20, label = 118;
  const W = specs.length * thumbW + (specs.length + 1) * pad, H = thumbH + label + 2 * pad;
  const comps = [];
  for (const [i, spec] of specs.entries()) {
    const png = await render(spec);
    const x = pad + i * (thumbW + pad);
    comps.push({ input: await sharp(png).resize(thumbW, thumbH).png().toBuffer(), left: x, top: pad });
    const name = spec.concept?.name || spec.optionLabel || "";
    const idea = spec.concept?.ideaShort || spec.optionIdea || "";
    const rtlN = isHebrew(name), rtlI = isHebrew(idea);
    const ideaLines = idea ? wrapText(idea, 34).slice(0, 3) : [];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbW}" height="${label}">
<text x="${thumbW / 2}" y="28" font-size="26" font-family="Rubik" font-weight="800" text-anchor="middle" fill="#333">${i + 1}</text>
${name ? `<text x="${thumbW / 2}" y="58" font-size="20" font-family="Rubik" font-weight="800" text-anchor="middle" fill="#2b2340" direction="${rtlN ? "rtl" : "ltr"}">${rtlN ? "‏" : ""}${esc(name)}</text>` : ""}
${ideaLines.map((l, k) => `<text x="${thumbW / 2}" y="${82 + k * 18}" font-size="14" font-family="Rubik" text-anchor="middle" fill="#6a5a7a" direction="${rtlI ? "rtl" : "ltr"}">${rtlI ? "‏" : ""}${esc(l)}</text>`).join("")}
</svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: pad + thumbH + 2 });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#f1efe9" } }).composite(comps).png().toFile(out);
  if (check) {
    const h = loadCovers();
    h.cards.push({ card: specs[0].card || specs[0].title || "", at: new Date().toISOString(), chosen: null,
      options: specs.map((s) => ({ concept: s.concept.name, inspiration: s.concept.inspiration || null, style: s.style, composition: s.concept.composition })) });
    saveCovers(h);
  }
  // what to tell the parent: each option, its idea, and where every object on it comes from
  return { image: out, options: specs.map((s, i) => ({ n: i + 1, concept: s.concept?.name, idea: s.concept?.idea, style: s.style, elements: s.elements })) };
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
      let specs, check = true;
      if (files.length > 1) specs = files.map(load);
      else {
        // quick look for the agent only: one design in several styles, never shown as options
        const base = files.length ? load(files[0]) : SAMPLE;
        specs = (opt ? opt.split("=")[1].split(",") : DEFAULT_OPTIONS).map((st) => ({ ...base, style: st }));
        check = false;
      }
      console.log(JSON.stringify(await gallery(a, specs, { check, allowRepeat: process.argv.includes("--allow-repeat") }), null, 2));
    }
    else if (cmd === "inspire") {
      const nArg = process.argv.find((x) => x.startsWith("--n="));
      console.log(JSON.stringify(inspire(nArg ? Number(nArg.split("=")[1]) : 3), null, 2));
    }
    else if (cmd === "chosen") {
      // record which option the parent picked for the latest card
      const h = loadCovers(), last = h.cards.at(-1);
      if (!last) throw new Error("no gallery on record yet");
      last.chosen = Number(a);
      saveCovers(h);
      console.log(`recorded option ${a} for "${last.card}"`);
    }
    else if (cmd === "history") console.log(JSON.stringify(loadCovers().cards.slice(-RECENT), null, 2));
    else if (cmd === "motifs") console.log(Object.keys(MOTIFS).join(", "));
    else if (cmd === "palette") console.log(JSON.stringify(await palette(a), null, 2));
    else { console.error("usage: node styles.mjs list | motifs | inspire [--n=3] | render <spec.json> <out.png> | gallery <out.png> <a.json> <b.json> <c.json> [--allow-repeat] | chosen <n> | history | palette <image>"); process.exit(1); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
