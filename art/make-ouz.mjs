// Pixel-art icons + cover for the "עוץ לי גוץ לי" Yoto card. Usage: node make-ouz.mjs [outdir]
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";

const P = {
  ".": null, k: [24, 20, 37], w: [255, 255, 255], g: [110, 200, 70], G: [50, 130, 50],
  y: [250, 220, 60], Y: [200, 160, 30], b: [150, 95, 50], B: [90, 55, 30],
  c: [90, 190, 240], r: [230, 60, 60], p: [250, 150, 170], o: [250, 150, 50],
  s: [170, 175, 185], S: [100, 105, 120], t: [225, 195, 140], m: [250, 205, 165],
};
const E = "................";
const ICONS = {
  "01-sun": [E, ".......y........", "..y....y....y...", "...y.......y....", "......yyyy......", "y...yyyyyyyy...y", "...yyyyyyyyyy...", "..yyyyyyyyyyyy..", "..yyyyyyyyyyyy..", "gggggggggggggggg", "GGGGGGGGGGGGGGGG", "GGGGGGGGGGGGGGGG", "GGGGGGGGGGGGGGGG", "GGGGGGGGGGGGGGGG", "GGGGGGGGGGGGGGGG", "GGGGGGGGGGGGGGGG"],
  "02-mill": ["s..............s", ".s............s.", "..s..........s..", "...s........s...", "....s......s....", ".....s....s.....", "......kkkk......", "......kkkk......", "....s......s....", ".....tttttt.....", "....tttttttt....", "....tttbbttt....", "...ttttbbtttt...", "...ttttbbtttt...", "..tttttbbttttt..", "..tttttbbttttt.."],
  "03-finger": ["......mm........", ".....mmmm.......", ".....mmmm.......", ".....mmmm.......", ".....mmmm.mm....", ".....mmmmmmmm...", ".....mmmmmmmmm..", ".mm..mmmmmmmmm..", ".mmmmmmmmmmmmm..", "..mmmmmmmmmmmm..", "..mmmmmmmmmmmm..", "...mmmmmmmmmm...", "....mmmmmmmm....", "....mmmmmmmm....", "....rrrrrrrr....", "....rrrrrrrr...."],
  "04-crown": [E, "..y....y....y...", "..yy..yyy..yy...", "..yy..yyy..yy...", "..yyy.yyy.yyy...", "..yyyyyyyyyyy...", "..yyyyyyyyyyy...", "..yyryyyryyyry..", "..yyyyyyyyyyy...", "..YYYYYYYYYYY...", "..YYYYYYYYYYY..."],
  "05-wheel": [E, ".....bbbbbb.....", "...bbb.bb.bbb...", "..bb...bb...bb..", "..b....bb....b..", ".b.....bb.....b.", ".b.....bb.....b.", ".bbbbbbYYbbbbbb.", ".b.....bb.....b.", ".b.....bb.....b.", "..b....bb....b..", "..bb...bb...bb..", "...bbb.bb.bbb...", ".....bbbbbb.....", "..yy.yyyyy.yy...", ".yyyyyyyyyyyyy.."],
  "06-mirror": ["....YYYYYY......", "...YccccccY...w.", "..YccwcccccY.www", "..YcwwcccccY..w.", "..YcwccccccY....", "..YccccccccY....", "..YccccccccY....", "...YccccccY.....", "....YccccY......", ".....YccY.......", ".....YYYY.......", "......YY........", "......YY........", "......YY........", "......YY........", ".....YYYY......."],
  "07-gold": ["......tttt......", ".......rr.......", "......rrrr......", ".....tttttt.....", "....tttttttt....", "...ttttyyttttt..", "..tttttyyttttttt", "..ttttyyyyttttt.", "..tttttyyttttttt", "..tttttttttttttt", "..tttttttttttttt", "...tttttttttttt.", "....tttttttttt..", ".yyyy.tttttt.yy.", "yyyYyyyyyyYyyyy.", ".YYYYYYYYYYYYYY."],
  "08-horseshoe": [E, ".sss........sss.", ".sks........sks.", ".sss........sss.", ".ss..........ss.", ".sk..........ks.", ".ss..........ss.", ".sss........sss.", "..sss......sss..", "..sks......sks..", "...ssss..ssss...", "....ssssssss....", ".....ssssss....."],
  "09-moon": [E, "...yyyyy......w.", "..yyyyyy........", ".yyyyy..........", ".yyyy........w..", ".yyyy...........", ".yyyy...........", ".yyyyy.......w..", "..yyyyyy........", "...yyyyyyy......", E, "..........w.....", ".........www....", "..........w....."],
  "10-flower": [E, ".....rr..rr.....", "....rrrrrrrr....", "....rrryyrrr....", "...rrryyyyrrr...", "....rrryyrrr....", "....rrrrrrrr....", ".....rr..rr.....", ".......gg.......", "..gg...gg.......", "...ggg.gg.......", ".....gggg.......", ".......gg.......", ".......gg.......", ".......gg.......", "......gggg......"],
  "11-bulb": ["..y....y....y...", ".....yyyyyy.....", "...yyyyyyyyyy...", "..yyyywwyyyyyy..", "..yyywwyyyyyyy..", "..yyyyyyyyyyyy..", "..yyyyyyyyyyyy..", "...yyyyyyyyyy...", "....yyyyyyyy....", ".....yyyyyy.....", ".....ssssss.....", ".....SSSSSS.....", ".....ssssss.....", "......SSSS......", ".......ss......."],
  "12-dwarf": [".......rr.......", "......rrrr......", ".....rrrrrr.....", "....rrrrrrrr....", "...rrrrrrrrrr...", "..rrrrrrrrrrrr..", "...mmmmmmmmmm...", "...mmkmmmmkmm...", "...mmmmppmmmm...", "..wwwwwwwwwwww..", "..wwwwwwwwwwww..", "...wwwwwwwwww...", "....wwwwwwww....", ".....wwwwww.....", "......wwww......"],
  "13-rings": [E, E, E, E, "...yyyy..YYYY...", "..y....yY....Y..", ".y.....Yy.....Y.", ".y.....Yy.....Y.", ".y.....Yy.....Y.", ".y.....Yy.....Y.", "..y....yY....Y..", "...yyyy..YYYY..."],
  "14-star": ["..........www...", "...........w....", "..........www...", E, ".......yy.......", ".......yy.......", "......yyyy......", "yyyyyyyyyyyyyyyy", ".yyyyyyyyyyyyyy.", "..yyyyyyyyyyyy..", "...yyyyyyyyyy...", "....yyyyyyyy....", "...yyyyyyyyyy...", "...yyy....yyy...", "..yyy......yyy..", "..yy........yy.."],
  "15-wave": ["..mm.mm.mm.mm...", "..mm.mm.mm.mm...", "..mm.mm.mm.mm...", "..mm.mm.mm.mm...", "..mmmmmmmmmmmm..", "mmmmmmmmmmmmmm..", "mmmmmmmmmmmmmm..", ".mmmmmmmmmmmmm..", "..mmmmmmmmmmm...", "..mmmmmmmmmmm...", "...mmmmmmmmm....", "....mmmmmmm.....", "....rrrrrrr.....", "....rrrrrrr....."],
};
const fix = r => { const x = r.map(s => s.padEnd(16, ".").slice(0, 16)); while (x.length < 16) x.push(E); if (x.length !== 16) throw new Error("rows"); return x; };

function pngFromGrid(rows, scale = 1) {
  const h = rows.length, w = rows[0].length, buf = Buffer.alloc(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = P[ch]; if (c === undefined) throw new Error(`bad char ${ch}`);
    const i = (y * w + x) * 4; if (c) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
  }));
  let img = sharp(buf, { raw: { width: w, height: h, channels: 4 } });
  if (scale > 1) img = img.resize(w * scale, h * scale, { kernel: "nearest" });
  return img.png().toBuffer();
}
const out = process.argv[2] || "./out-ouz";
mkdirSync(out, { recursive: true });
const names = Object.keys(ICONS);
for (const n of names) writeFileSync(`${out}/icon-${n}.png`, await pngFromGrid(fix(ICONS[n])));
const tiles = await Promise.all(names.map(async n => ({ input: await pngFromGrid(fix(ICONS[n]), 8) })));
const cols = 5, cell = 136;
await sharp({ create: { width: cols * cell, height: Math.ceil(names.length / cols) * cell, channels: 4, background: [200, 230, 255, 255] } })
  .composite(tiles.map((t, i) => ({ ...t, left: (i % cols) * cell + 4, top: Math.floor(i / cols) * cell + 4 }))).png().toFile(`${out}/sheet.png`);

const W = 160, H = 253;
const bands = ["#2b1b4a", "#4a2a63", "#7a3a6a", "#b0525a", "#e8844a"];
let bg = ""; for (let y = 0; y < H; y += 8) bg += `<rect x="0" y="${y}" width="${W}" height="8" fill="${bands[Math.min(4, Math.floor((y / H) * 5))]}"/>`;
let stars = ""; [[12,10],[40,22],[70,8],[110,18],[140,10],[25,36],[130,40]].forEach(([x,y]) => stars += `<rect x="${x}" y="${y}" width="2" height="2" fill="#fff6c0"/>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}${stars}
<g font-family="Rubik ExtraBold, Rubik" text-anchor="middle" direction="rtl">
<text x="82" y="62" font-size="24" fill="#1d1425" stroke="#1d1425" stroke-width="3">עוץ לי גוץ לי</text>
<text x="80" y="60" font-size="24" fill="#ffe14a" stroke="#c89c1e" stroke-width="0.6">עוץ לי גוץ לי</text>
<text x="80" y="243" font-size="11" fill="#ffe9c0" direction="ltr">Rumpelstiltskin</text>
</g></svg>`;
const base = await sharp(Buffer.from(svg)).png().toBuffer();
const big = await pngFromGrid(fix(ICONS["12-dwarf"]), 7);
const row = ["02-mill", "04-crown", "07-gold", "09-moon", "11-bulb"];
const small = await Promise.all(row.map(n => pngFromGrid(fix(ICONS[n]), 2)));
const comp = [{ input: big, left: 24, top: 78 }, ...small.map((input, i) => ({ input, left: 12 + i * 29, top: 190 }))];
const composed = await sharp(base).composite(comp).png().toBuffer();
writeFileSync(`${out}/cover.png`, await sharp(composed).resize(640, 1012, { kernel: "nearest" }).resize(638, 1011, { kernel: "nearest" }).png().toBuffer());
console.log(names.join(" "));
