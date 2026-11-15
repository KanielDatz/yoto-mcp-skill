// Usage: node yoto-chapters.mjs <cardId> list
//        node yoto-chapters.mjs <cardId> remove <n>        (renumbers the rest)
//        node yoto-chapters.mjs <cardId> rename <n> <title>
// Reads the token the MCP server saved after yoto-auth. Set YOTO_CONFIG_PATH if it's not ../server/.yoto-mcp-config.json
import { readFileSync } from "fs";
const cfgPath = process.env.YOTO_CONFIG_PATH || new URL("../server/.yoto-mcp-config.json", import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const H = { Authorization: `Bearer ${cfg.accessToken}`, Accept: "application/json" };
const [id, cmd, a, ...rest] = process.argv.slice(2);
const { card } = await (await fetch(`https://api.yotoplay.com/content/${id}`, { headers: H })).json();
let ch = card.content.chapters;
const num = (c, i) => { const k = String(i + 1).padStart(2, "0"); return { ...c, key: k, overlayLabel: String(i + 1), tracks: c.tracks.map(x => ({ ...x, key: k, overlayLabel: String(i + 1) })) }; };
if (cmd === "list" || !cmd) { console.log(ch.map((c, i) => `${i + 1}  ${c.title}  ${c.tracks?.[0]?.duration}s`).join("\n")); process.exit(); }
const n = Number(a);
if (cmd === "remove") ch = ch.filter((_, i) => i !== n - 1).map(num);
else if (cmd === "rename") { const t = rest.join(" "); ch = ch.map((c, i) => i === n - 1 ? { ...c, title: t, tracks: c.tracks.map(x => ({ ...x, title: t })) } : c); }
else throw new Error("unknown command");
const u = await fetch("https://api.yotoplay.com/content", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ cardId: id, title: card.title, content: { ...card.content, chapters: ch } }) });
console.log(u.status);
