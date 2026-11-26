#!/usr/bin/env node
// Save a card's current cover and track icons before new art is applied, so it can be put back.
//
//   node yoto-cover-backup.mjs <cardId> [backupDir]
//
// Writes <backupDir>/<cardId>-<timestamp>/ with cover.png (if the card has a cover),
// icon-<track>.png for every track icon that is a downloadable image, and card.json (the
// card's metadata and chapter display data). Prints the restore call to make.
// Default backupDir: "cover-backups" next to the token file (persistent storage).
// Reads the token the MCP server saved after yoto-auth; set YOTO_CONFIG_PATH if it's not
// ../server/.yoto-mcp-config.json. Behind a proxy run Node with NODE_USE_ENV_PROXY=1.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const [cardId, dirArg] = process.argv.slice(2);
if (!cardId) {
  console.error("usage: yoto-cover-backup.mjs <cardId> [backupDir]");
  process.exit(1);
}
const cfgPath = process.env.YOTO_CONFIG_PATH || new URL("../server/.yoto-mcp-config.json", import.meta.url).pathname;
if (!existsSync(cfgPath)) {
  console.error(`No Yoto token at ${cfgPath} - authenticate with yoto-auth first (or set YOTO_CONFIG_PATH)`);
  process.exit(1);
}
const { accessToken } = JSON.parse(readFileSync(cfgPath, "utf8"));
const H = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

const res = await fetch(`https://api.yotoplay.com/content/${encodeURIComponent(cardId)}`, { headers: H });
if (res.status === 401) { console.error("Yoto token expired - call yoto-check-auth (it refreshes the token), then run this again"); process.exit(1); }
if (!res.ok) { console.error(`Could not read card ${cardId}: HTTP ${res.status}`); process.exit(1); }
const { card } = await res.json();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(dirArg || join(dirname(cfgPath), "cover-backups"), `${cardId}-${stamp}`);
mkdirSync(dir, { recursive: true });

// Only plain https images are downloaded (Yoto's own media URLs); anything else is recorded
// in card.json but not fetched.
async function save(url, file) {
  if (!/^https:\/\//.test(url || "")) return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const isImage = (buf[0] === 0x89 && buf.slice(1, 4).toString("latin1") === "PNG") || (buf[0] === 0xff && buf[1] === 0xd8);
  if (!isImage) return null;
  writeFileSync(join(dir, file), buf);
  return file;
}

const cover = await save(card?.metadata?.cover?.imageL, "cover.png");
const icons = [];
for (const [i, ch] of (card?.content?.chapters || []).entries()) {
  const url = ch?.display?.icon16x16;
  const file = await save(url, `icon-${i + 1}.png`);
  icons.push({ track: i + 1, title: ch.title, icon: url || null, saved: file });
}
writeFileSync(join(dir, "card.json"), JSON.stringify({ cardId, title: card?.title, savedAt: new Date().toISOString(), metadata: card?.metadata, icons }, null, 2));

const restoreIcons = icons.filter((i) => i.saved).map((i) => ({ track: i.track, iconPath: join(dir, i.saved) }));
console.log(JSON.stringify({
  backup: dir,
  cover: cover ? join(dir, cover) : null,
  iconsSaved: restoreIcons.length,
  restore: { tool: "yoto-set-card-art", cardId, coverPath: cover ? join(dir, cover) : undefined, icons: restoreIcons },
}, null, 2));
