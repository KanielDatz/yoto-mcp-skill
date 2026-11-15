// Pixel-art generator for Yoto icons (16x16) and covers. Usage: node make.mjs [outdir]
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";

const P = {
  ".": null, k: [24, 20, 37], w: [255, 255, 255], g: [110, 200, 70], G: [50, 130, 50],
  l: [190, 235, 90], y: [250, 220, 60], Y: [200, 160, 30], b: [150, 95, 50], B: [90, 55, 30],
  c: [90, 190, 240], C: [40, 100, 190], r: [230, 60, 60], p: [250, 150, 170], o: [250, 150, 50],
  s: [170, 175, 185], S: [100, 105, 120],
};

// 16x16 icons, one per episode. Eyes "wk" = white+pupil.
const ICONS = {
  snot: [
    "................",
    ".......gg.......",
    "......gggg......",
    ".....gggggg.....",
    "....gggggggg....",
    "...gggggggggg...",
    "...ggwkggwkgg...",
    "..gggwkggwkggg..",
    "..gggggggggggg..",
    "..gggggkkgggggg.",
    "..ggggkggkggggg.",
    "..gggggggggggg..",
    "...gGgggggGggg..",
    "....gggggggg....",
    ".....GGGGGG.....",
    "................",
  ],
  fart: [
    "................",
    "................",
    "....ssss........",
    "...ssssssss.ss..",
    "..sssssssssssss.",
    ".ssswkssswkssss.",
    ".ssswkssswkssss.",
    ".sssssssssssss..",
    "..ssskkkksssss..",
    "...sssssssss....",
    "..sS.ssss.Ss....",
    ".sS...SS...Ss...",
    "........bb.bb...",
    ".......bbbbbbb..",
    "................",
    "................",
  ],
  mold: [
    "................",
    "..yyyyyyyyyyyy..",
    ".yyyyyyyyyyyyyy.",
    ".bbbbbbbbbbbbbb.",
    ".gGgbbbbbbGgGbb.",
    ".GGgGbbbbGgGGgb.",
    ".bgGGbbbbbbgGbb.",
    ".bbbbbbbGgbbbbb.",
    ".bbbgGbbGGgbbbb.",
    ".bbGGGgbbbbbGgb.",
    ".yyyyyyyyyyyyyy.",
    ".yyyyyyyyyyyyyy.",
    "..yyyyyyyyyyyy..",
    "................",
    "................",
    "................",
  ],
  roach: [
    "................",
    "..k..........k..",
    "...k...kk...k...",
    "....k.kkkk.k....",
    ".....kkkkkk.....",
    "....kBBBBBBk....",
    "...kBbBBBBbBk...",
    "k.kBbBBBBBBbBk.k",
    ".kkBbBBBBBBbBkk.",
    "k.kBbBBBBBBbBk.k",
    ".kkBbBBBBBBbBkk.",
    "k..kBbBBBBbBk..k",
    "....kBBBBBBk....",
    ".....kkkkkk.....",
    "................",
    "................",
  ],
  sweat: [
    "................",
    ".......cc.......",
    "......cccc......",
    "......cwcc......",
    ".....ccwccc.....",
    ".....cwcccc.....",
    "....ccwccccc....",
    "....cwcccccc....",
    "...ccwcccccCc...",
    "...cccccccCCc...",
    "...ccccccCCCc...",
    "....cccCCCCc....",
    ".....ccCCCc.....",
    "......cccc......",
    "................",
    "................",
  ],
  ew: [
    "................",
    "....gggggggg....",
    "..gggggggggggg..",
    ".ggggggggggggggg"[0] + "ggggggggggggggg",
    ".ggkkgggggggkkg.",
    ".gggkkggggkkggg.",
    ".gggkkgggkkgggg.",
    ".ggggggggggggg..",
    ".gggkkkkkkkkgg..",
    ".ggkgggggggkgg..",
    ".ggggkkkkkggggg.",
    "..gggggGgggggg..",
    "...gggggggggg...",
    ".....GGGGGG.....",
    "................",
    "................",
  ],
  spit: [
    "................",
    "........cc......",
    ".......cwcc.....",
    "..cc...cccc.....",
    ".cwcc...cc......",
    ".cccc...........",
    "..cc.....pppp...",
    "........pppppp..",
    ".......pkkkkkkp.",
    ".......pkwwwwkp.",
    ".......pkrrrrkp.",
    "........pkkkkp..",
    "................",
    "................",
    "................",
    "................",
  ],
  pee: [
    "................",
    "......yy........",
    ".....yyyy.......",
    ".....yyyy.......",
    "....yyYYyy......",
    "....yyyYyy......",
    "...yyyyyYyy.....",
    "...yyyyyyYy.....",
    "...yyyyyYYy.....",
    "....yyyYYy......",
    ".....yyyy.......",
    "................",
    "..yy..yy..yy....",
    "................",
    "................",
    "................",
  ],
  tooth: [
    "................",
    "...wwww..wwww...",
    "..wwwwwwwwwwww..",
    ".wwwwwwwwwwwwww.",
    ".wwwwkkkwwwwwww.",
    ".wwwkkkkkwwwwww.",
    ".wwwwkkkwwwwwww.",
    ".wwwwwwwwwwwwww.",
    ".wwwwwwwwwwwwww.",
    "..wwwwwwwwwwww..",
    "..wwwww..wwwww..",
    "..wwww....wwww..",
    "..wwww....wwww..",
    "...ww......ww...",
    "................",
    "................",
  ],
  vomit: [
    "................",
    "..ppppp.........",
    ".pppppppp.......",
    ".pkpkpppp.......",
    ".ppppppppp.l.l..",
    ".pkkkkpppppllll.",
    "..pkkkpppllylll.",
    "...pppppplllll..",
    "....ppp..lylll..",
    "..........lll...",
    ".........lyll...",
    "........lllll...",
    ".......lllyl....",
    "................",
    "................",
    "................",
  ],
  sewer: [
    "................",
    "....SSSSSSSS....",
    "..SSssssssssSS..",
    ".SsskkkkkkkkssS.",
    ".SskkkkkkkkkkS..",
    "SsskkkkkkkkkksS.",
    "Sskkkkkkkkkkksss"[0] + "skkkkkkkkkkkSs.",
    "Sskkkkkkkkkkksss"[0] + "skkkkkkkkkkkSs.",
    "SsskkGGGGGGkksS.",
    ".SsGGgGGgGGGsS..",
    ".SSGgGGGGgGGSS..",
    "..SSSSSSSSSSS...",
    "................",
    "................",
    "................",
    "................",
  ],
  poop: [
    "................",
    ".......bb.......",
    "......bbbb......",
    ".....bbbbbb.....",
    "......bbbb......",
    "....bbbbbbbb....",
    "...bbwkbwkbbb...",
    "...bbwkbwkbbb...",
    "...bbbbbbbbbb...",
    "..bbbbkkkkbbbb..",
    "..bBbbbbbbbbBb..",
    ".bbbbbbbbbbbbbb.",
    ".bBbbbbbbbbbbBb.",
    ".BBBBBBBBBBBBBB.",
    "................",
    "................",
  ],
};

function pngFromGrid(rows, scale = 1) {
  const h = rows.length, w = rows[0].length;
  const buf = Buffer.alloc(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = P[ch];
    if (c === undefined) throw new Error(`bad char ${ch}`);
    const i = (y * w + x) * 4;
    if (c) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
  }));
  let img = sharp(buf, { raw: { width: w, height: h, channels: 4 } });
  if (scale > 1) img = img.resize(w * scale, h * scale, { kernel: "nearest" });
  return img.png().toBuffer();
}

const out = process.argv[2] || "./out";
mkdirSync(out, { recursive: true });
const names = Object.keys(ICONS);
for (const n of names) {
  const rows = ICONS[n].map(r => r.padEnd(16, ".").slice(0, 16));
  if (rows.length !== 16) throw new Error(`${n}: ${rows.length} rows`);
  writeFileSync(`${out}/icon-${n}.png`, await pngFromGrid(rows));
}
// contact sheet (8x) for eyeballing
const tiles = await Promise.all(names.map(async n => ({ input: await pngFromGrid(ICONS[n].map(r => r.padEnd(16, ".").slice(0, 16)), 8), }))); 
const cols = 4, cell = 136;
await sharp({ create: { width: cols * cell, height: Math.ceil(names.length / cols) * cell, channels: 4, background: [200, 230, 255, 255] } })
  .composite(tiles.map((t, i) => ({ ...t, left: (i % cols) * cell + 4, top: Math.floor(i / cols) * cell + 4 })))
  .png().toFile(`${out}/sheet.png`);
console.log(names.join(" "));

// ---- cover: 160x253 logical, upscaled 4x nearest to ~638x1011 ----
const W = 160, H = 253;
const bandColors = ["#1d3b2a", "#21452f", "#255034", "#2a5a3a"];
let bg = "";
for (let y = 0; y < H; y += 8) bg += `<rect x="0" y="${y}" width="${W}" height="8" fill="${bandColors[Math.floor((y / H) * 4)]}"/>`;
let drips = "";
[[8, 22], [30, 14], [52, 30], [78, 12], [100, 26], [124, 18], [146, 32]].forEach(([x, h]) => {
  drips += `<rect x="${x}" y="0" width="8" height="${h}" fill="#7bd23c"/><rect x="${x + 1}" y="${h}" width="6" height="2" fill="#7bd23c"/><rect x="${x + 2}" y="${h + 2}" width="4" height="2" fill="#7bd23c"/>`;
});
drips += `<rect x="0" y="0" width="${W}" height="8" fill="#7bd23c"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}${drips}
<g font-family="Rubik ExtraBold, Rubik" text-anchor="middle" direction="rtl">
<text x="82" y="62" font-size="30" fill="#1d1425" stroke="#1d1425" stroke-width="3">מדעאיכס</text>
<text x="80" y="60" font-size="30" fill="#ffe14a" stroke="#c89c1e" stroke-width="0.6">מדעאיכס</text>
<text x="80" y="243" font-size="12" fill="#d8f5b0" font-family="Rubik ExtraBold, Rubik" direction="ltr">Science, Yuck!</text>
</g></svg>`;
const base = await sharp(Buffer.from(svg)).png().toBuffer();
const big = await pngFromGrid(ICONS.ew.map(r => r.padEnd(16, ".").slice(0, 16)), 7);
const row = ["snot", "roach", "poop", "sweat", "tooth"];
const small = await Promise.all(row.map(async n => pngFromGrid(ICONS[n].map(r => r.padEnd(16, ".").slice(0, 16)), 2)));
const comp = [{ input: big, left: 24, top: 78 }, ...small.map((input, i) => ({ input, left: 12 + i * 29, top: 190 }))];
const composed = await sharp(base).composite(comp).png().toBuffer();
const cover = await sharp(composed).resize(640, 1012, { kernel: "nearest" }).resize(638, 1011, { kernel: "nearest" }).png().toBuffer();
writeFileSync(`${out}/cover.png`, cover);
