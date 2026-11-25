// Printable A4 sticker sheet of Yoto card labels (cover art, rounded corners, cut guide).
//
//   node labels.mjs list                                  numbered table of your cards + cover status
//   node labels.mjs pdf <out.pdf> <item...> [options]     build the sheet
//
// An <item> is a card ID (its cover is fetched from Yoto) or a path to a local cover PNG/JPG.
// Repeat an item to print it more than once.
//
// Options:
//   --skip=N     slots already used on a part-used sheet: start at slot N+1 (first page only)
//   --exact      exact card size, 54 x 85.6 mm (default: 52 x 83.6 mm, 1 mm inset per side)
//   --no-guide   leave out the grey cut outline
//
// The grid is fixed: every slot is always in the same place on the page, so a sheet that went
// through the printer once can go through again and the new labels land in the free slots.
// Slots fill from the BOTTOM row up, left to right within a row.
// That keeps the top edge of the sheet - the edge the printer pulls in first - whole for as
// long as possible, which is what lets a part-used sheet feed again.
//
// Reads the token the MCP server saved after yoto-auth. Set YOTO_CONFIG_PATH if it's not
// ../server/.yoto-mcp-config.json
import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";
import { readFileSync, writeFileSync, existsSync } from "fs";

const MM = 72 / 25.4; // PDF points per mm
const PAGE_W = 210, PAGE_H = 297; // A4, mm
const COLS = 3, ROWS = 3, PER_PAGE = COLS * ROWS;
const GAP = 5; // mm between labels
const DPI = 300;
const API = "https://api.yotoplay.com";

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
  if (!out || !items.length) throw new Error("usage: node labels.mjs pdf <out.pdf> <cardId|image...> [--skip=N] [--exact] [--no-guide]");
  const exact = !!flags.exact;
  const W = exact ? 54 : 52, H = exact ? 85.6 : 83.6, R = exact ? 3.2 : 3; // mm
  const skip = Math.max(0, Number(flags.skip || 0));
  if (!Number.isInteger(skip) || skip >= PER_PAGE) throw new Error(`--skip must be 0..${PER_PAGE - 1}`);

  const gridW = COLS * W + (COLS - 1) * GAP, gridH = ROWS * H + (ROWS - 1) * GAP;
  const left = (PAGE_W - gridW) / 2, top = (PAGE_H - gridH) / 2;
  // slot s (0-based) -> top-left corner in mm, filling the bottom row first, left to right
  const slotXY = (s) => {
    const row = ROWS - 1 - Math.floor(s / COLS), col = s % COLS;
    return [left + col * (W + GAP), top + row * (H + GAP)];
  };

  const pxW = Math.round((W / 25.4) * DPI), pxH = Math.round((H / 25.4) * DPI), pxR = Math.round((R / 25.4) * DPI);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}"><path d="${roundRect(pxW, pxH, pxR)}" fill="#fff"/></svg>`);

  const doc = await PDFDocument.create();
  doc.setTitle("Yoto card labels");
  const cache = new Map();
  let page, slot = skip;
  const placed = [];
  for (const item of items) {
    if (!cache.has(item)) {
      const { label, buf } = await loadImage(item);
      const png = await sharp(buf).resize(pxW, pxH, { fit: "cover" })
        .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      cache.set(item, { label, img: await doc.embedPng(png) });
    }
    if (!page || slot === PER_PAGE) {
      if (page) slot = 0;
      page = doc.addPage([PAGE_W * MM, PAGE_H * MM]);
    }
    const [x, y] = slotXY(slot);
    const { label, img } = cache.get(item);
    page.drawImage(img, { x: x * MM, y: (PAGE_H - y - H) * MM, width: W * MM, height: H * MM });
    if (!flags["no-guide"]) {
      page.drawSvgPath(roundRect(W * MM, H * MM, R * MM), {
        x: x * MM, y: (PAGE_H - y) * MM, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.35,
      });
    }
    placed.push({ label, page: doc.getPageCount(), slot: slot + 1 });
    slot++;
  }
  writeFileSync(out, await doc.save());
  const lastUsed = slot, free = PER_PAGE - lastUsed;
  console.log(JSON.stringify({
    pdf: out, labels: placed.length, pages: doc.getPageCount(),
    labelSizeMm: [W, H], perSheet: PER_PAGE,
    lastSheet: { slotsUsed: lastUsed, slotsFree: free, nextSkip: free ? lastUsed : null },
    placed,
  }, null, 2));
}

try {
  if (cmd === "list") await list();
  else if (cmd === "pdf") await pdf(rest[0], rest.slice(1));
  else {
    console.error("usage: node labels.mjs list | pdf <out.pdf> <cardId|image...> [--skip=N] [--exact] [--no-guide]");
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
