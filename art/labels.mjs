// Printable A4 sticker sheet of Yoto card labels (cover art, rounded corners, cut guide).
//
//   node labels.mjs list                                  numbered table of your cards + cover status
//   node labels.mjs pdf <out.pdf> <item...> [options]     build the sheet
//
// An <item> is a card ID (its cover is fetched from Yoto) or a path to a local cover PNG/JPG.
// Repeat an item to print it more than once.
//
// Options:
//   --sheet=MM   print on a leftover piece MM tall (full A4 width) instead of a whole A4 sheet.
//                Only the first page; any overflow goes on whole A4 sheets.
//   --exact      exact card size, 54 x 85.6 mm (default: 52 x 83.6 mm, 1 mm inset per side)
//   --no-guide   leave out the grey cut outline around each label
//
// Labels pack from the top, left to right, 3 per row. When the unused part below the last row
// is still tall enough for another row, a dashed line is drawn across the whole sheet just
// under it, labelled with the leftover piece's size: cut there and keep the lower piece. It
// goes back through the printer later with --sheet=<its height>.
//
// Reads the token the MCP server saved after yoto-auth. Set YOTO_CONFIG_PATH if it's not
// ../server/.yoto-mcp-config.json
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFileSync, writeFileSync, existsSync } from "fs";

const MM = 72 / 25.4; // PDF points per mm
const PAGE_W = 210, PAGE_H = 297; // A4, mm
const COLS = 3;
const GAP = 5; // mm between labels
const MARGIN = 8; // mm kept clear at the top and bottom of every sheet or piece (printer margin)
const DPI = 300;
const API = "https://api.yotoplay.com";
const USAGE = "usage: node labels.mjs list | pdf <out.pdf> <cardId|image...> [--sheet=MM] [--exact] [--no-guide]";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v ?? true];
}));
const pos = args.filter((a) => !a.startsWith("--"));
const [cmd, ...rest] = pos;

function token() {
  const p = process.env.YOTO_CONFIG_PATH || new URL("../server/.yoto-mcp-config.json", import.meta.url).pathname;
  if (!existsSync(p)) throw new Error(`No Yoto token at ${p} - authenticate with yoto-auth first (or set YOTO_CONFIG_PATH)`);
  return JSON.parse(readFileSync(p, "utf8")).accessToken;
}

async function api(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" } });
  if (r.status === 401) throw new Error("Yoto token expired - call yoto-check-auth (it refreshes the token), then run this again");
  if (!r.ok) throw new Error(`Yoto API ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const coverOf = (card) => card?.metadata?.cover?.imageL || null;

async function cardCover(cardId) {
  const { card } = await api(`/content/${encodeURIComponent(cardId)}`);
  return { title: card?.title || cardId, url: coverOf(card) };
}

async function list() {
  const { cards = [] } = await api("/content/mine");
  if (!cards.length) return console.log("No MYO cards found.");
  const rows = [];
  for (const c of cards) {
    // /content/mine usually carries metadata; fall back to the full card when it doesn't
    const url = coverOf(c) ?? (c.metadata ? null : (await cardCover(c.cardId)).url);
    rows.push({ n: rows.length + 1, title: c.title, cardId: c.cardId, cover: !!url });
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function loadImage(item) {
  if (existsSync(item)) return { label: item, buf: readFileSync(item) };
  const { title, url } = await cardCover(item);
  if (!url) throw new Error(`Card ${item} (${title}) has no cover image - make one first`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Cover download for ${title} failed: ${r.status}`);
  return { label: title, buf: Buffer.from(await r.arrayBuffer()) };
}

// Rounded rectangle as an SVG path (origin top-left, y down), units as given.
const roundRect = (w, h, r) =>
  `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} ` +
  `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;

async function pdf(out, items) {
  if (!out || !items.length) throw new Error(USAGE);
  const exact = !!flags.exact;
  const W = exact ? 54 : 52, H = exact ? 85.6 : 83.6, R = exact ? 3.2 : 3; // mm
  const rowsFit = (h) => Math.max(0, Math.floor((h - 2 * MARGIN + GAP) / (H + GAP)));
  const firstH = flags.sheet ? Number(flags.sheet) : PAGE_H;
  if (!(firstH > 0 && firstH <= PAGE_H)) throw new Error(`--sheet must be a height in mm, up to ${PAGE_H}`);
  if (!rowsFit(firstH)) throw new Error(`A ${firstH} mm piece is too short for a label (needs ${Math.ceil(H + 2 * MARGIN)} mm)`);

  const left = (PAGE_W - (COLS * W + (COLS - 1) * GAP)) / 2;
  // slot s (0-based) -> top-left corner in mm: top row first, left to right
  const slotXY = (s) => [left + (s % COLS) * (W + GAP), MARGIN + Math.floor(s / COLS) * (H + GAP)];

  const pxW = Math.round((W / 25.4) * DPI), pxH = Math.round((H / 25.4) * DPI), pxR = Math.round((R / 25.4) * DPI);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}"><path d="${roundRect(pxW, pxH, pxR)}" fill="#fff"/></svg>`);

  const doc = await PDFDocument.create();
  doc.setTitle("Yoto card labels");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cache = new Map();
  let page, pageH, cap, slot = 0;
  const placed = [];
  for (const item of items) {
    if (!cache.has(item)) {
      const { label, buf } = await loadImage(item);
      const png = await sharp(buf).resize(pxW, pxH, { fit: "cover" })
        .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      cache.set(item, { label, img: await doc.embedPng(png) });
    }
    if (!page || slot === cap) {
      pageH = page ? PAGE_H : firstH;
      cap = rowsFit(pageH) * COLS;
      slot = 0;
      page = doc.addPage([PAGE_W * MM, pageH * MM]);
    }
    const [x, y] = slotXY(slot);
    const { label, img } = cache.get(item);
    page.drawImage(img, { x: x * MM, y: (pageH - y - H) * MM, width: W * MM, height: H * MM });
    if (!flags["no-guide"]) {
      page.drawSvgPath(roundRect(W * MM, H * MM, R * MM), {
        x: x * MM, y: (pageH - y) * MM, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.35,
      });
    }
    placed.push({ label, page: doc.getPageCount(), row: Math.floor(slot / COLS) + 1 });
    slot++;
  }

  // Cut line under the last row, if what is left below can still take a row of labels.
  const cutY = MARGIN + Math.ceil(slot / COLS) * (H + GAP) - GAP / 2;
  const leftoverH = Math.floor(pageH - cutY); // round down: never claim more than is there
  let leftover = null;
  if (rowsFit(leftoverH)) {
    const yPt = (pageH - cutY) * MM;
    page.drawLine({
      start: { x: 0, y: yPt }, end: { x: PAGE_W * MM, y: yPt },
      thickness: 0.6, color: rgb(0.3, 0.3, 0.3), dashArray: [6, 4],
    });
    const note = `cut  -  keep this piece: ${PAGE_W} x ${leftoverH} mm`;
    page.drawText(note, {
      x: (PAGE_W * MM - font.widthOfTextAtSize(note, 7)) / 2, y: yPt - 9,
      size: 7, font, color: rgb(0.45, 0.45, 0.45),
    });
    leftover = { widthMm: PAGE_W, heightMm: leftoverH, labelsFit: rowsFit(leftoverH) * COLS, nextFlag: `--sheet=${leftoverH}` };
  }

  writeFileSync(out, await doc.save());
  console.log(JSON.stringify({
    pdf: out, labels: placed.length, pages: doc.getPageCount(),
    labelSizeMm: [W, H], firstSheetMm: [PAGE_W, firstH], perFullA4: rowsFit(PAGE_H) * COLS,
    emptySpotsInLastRow: (COLS - (slot % COLS)) % COLS,
    leftover, placed,
  }, null, 2));
}

try {
  if (cmd === "list") await list();
  else if (cmd === "pdf") await pdf(rest[0], rest.slice(1));
  else {
    console.error(USAGE);
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
