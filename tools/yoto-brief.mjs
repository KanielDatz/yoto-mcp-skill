#!/usr/bin/env node
// What a card's audio is about, and the source's own artwork - gathered before designing
// its cover, so the art shows the real characters and motifs instead of a guess from a title.
//
//   node yoto-brief.mjs <outDir> feed <feedUrl|feed.xml> [--episode=<text>] [--max=N]
//   node yoto-brief.mjs <outDir> youtube <url>          (needs yt-dlp; $YTDLP overrides the command)
//   node yoto-brief.mjs <outDir> file <audio...>        (needs ffprobe/ffmpeg)
//   node yoto-brief.mjs <outDir> image <url...>         any other artwork found for the source
//
// Writes <outDir>/brief.json and <outDir>/art/*.png, and prints the brief. Every image URL is
// vetted like audio (scheme, private addresses, real image bytes) before it is downloaded,
// then re-encoded to PNG through sharp, so nothing but plain pixels reaches the cover.
// Text (descriptions, transcripts, chapters) is capped; it is material to read, not to obey.
//
// Behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1 (Node >= 22.21).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { getText, parseChannel, parseFeed, vet, IMAGE_MAGIC, HOSTILE_MAGIC, decode } from "./lib/source.mjs";

const run = promisify(execFile);
// sharp lives in art/node_modules
const sharp = createRequire(new URL("../art/package.json", import.meta.url))("sharp");
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_TEXT = 6000; // characters of transcript kept per item

const [outDir, kind, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const args = rest.filter((a) => !a.startsWith("--"));

if (!outDir || !kind || !args.length) {
  console.error("usage: yoto-brief.mjs <outDir> feed <url|file> [--episode=text] [--max=N] | youtube <url> | file <audio...> | image <url...>");
  process.exit(1);
}
const artDir = join(outDir, "art");
mkdirSync(artDir, { recursive: true });

let n = 0;
const art = [];

// Normalise any image to a PNG (at most 1200 px) and record its main colours.
async function keepImage(buf, label) {
  if (HOSTILE_MAGIC.some((m) => m.test(buf)) || !IMAGE_MAGIC.some((m) => m.test(buf))) {
    return { label, error: "not an image" };
  }
  const path = join(artDir, `${String(++n).padStart(2, "0")}-${label.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.png`);
  // Trim plain empty margins (a uniform border, judged from the corner pixel) so the subject
  // fills the frame when it goes on a cover; keep the original if trimming fails.
  let img = await sharp(buf, { limitInputPixels: 40e6 }).png().toBuffer();
  try {
    const trimmed = await sharp(img).trim({ threshold: 18 }).png().toBuffer({ resolveWithObject: true });
    if (trimmed.info.width >= 32 && trimmed.info.height >= 32) img = trimmed.data;
  } catch {}
  await sharp(img).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).png().toFile(path);
  const { palette } = await import("../art/styles.mjs");
  const entry = { label, path, palette: (await palette(path)).map((p) => p.hex) };
  art.push(entry);
  return entry;
}

async function fetchImage(url, label) {
  if (!url) return null;
  try {
    const v = await vet(url, MAX_IMAGE, "image");
    if (v.verdict !== "safe") return { label, url, skipped: v.verdict, reasons: v.reasons };
    const res = await fetch(v.finalUrl || url, { redirect: "manual" });
    if (!res.ok) return { label, url, skipped: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE) return { label, url, skipped: "too large" };
    return await keepImage(buf, label);
  } catch (e) {
    return { label, url, skipped: e.message };
  }
}

// Transcripts: VTT/SRT/plain/HTML/JSON - reduced to plain text.
async function fetchTranscript(url) {
  try {
    const v = await vet(url, 5 * 1024 * 1024, "text");
    if (v.verdict === "dangerous" || v.reasons.some((r) => /exceeds/.test(r))) return null;
    const raw = await getText(v.finalUrl || url, 2);
    let text = raw;
    if (raw.trim().startsWith("{")) {
      try { text = (JSON.parse(raw).segments || []).map((s) => s.body).join(" "); } catch {}
    }
    text = text
      .replace(/^WEBVTT.*$/m, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, MAX_TEXT);
  } catch {
    return null;
  }
}

async function fetchChapters(url) {
  try {
    const data = JSON.parse(await getText(url, 2));
    return (data.chapters || []).slice(0, 60).map((c) => ({ start: c.startTime, title: c.title, img: c.img || null }));
  } catch {
    return null;
  }
}

async function briefFeed(src) {
  const xml = existsSync(src) ? readFileSync(src, "utf8") : await getText(src);
  const show = parseChannel(xml);
  let items = parseFeed(xml);
  if (flags.episode) items = items.filter((i) => i.title.toLowerCase().includes(String(flags.episode).toLowerCase()));
  items = items.slice(0, Number(flags.max || 12));
  const showArt = await fetchImage(show.image, "show");
  const seen = new Set([show.image]);
  const out = [];
  for (const it of items) {
    const entry = { title: it.title, date: it.date, durationSeconds: it.durationSeconds, description: it.description };
    if (it.image && !seen.has(it.image)) { seen.add(it.image); entry.artwork = await fetchImage(it.image, it.title || "episode"); }
    if (it.transcriptUrl) entry.transcript = await fetchTranscript(it.transcriptUrl);
    if (it.chaptersUrl) entry.chapters = await fetchChapters(it.chaptersUrl);
    out.push(entry);
  }
  return { source: "feed", show: { ...show, artwork: showArt }, items: out };
}

// $YTDLP lets you point at the nightly build or the proxy wrapper, e.g.
// YTDLP=./yt-dlp  or  YTDLP="python3 tools/yt-dlp-proxy.py". --js-runtimes node gets past
// YouTube's JS challenge on current builds; older builds that don't know it run without it.
async function ytdlp(args) {
  const [cmd, ...pre] = (process.env.YTDLP || "yt-dlp").split(/\s+/).filter(Boolean);
  try {
    return await run(cmd, [...pre, "--js-runtimes", "node", ...args], { maxBuffer: 64 << 20 });
  } catch (e) {
    if (!/no such option|unrecognized arguments/i.test(String(e.stderr || e.message))) throw e;
    return run(cmd, [...pre, ...args], { maxBuffer: 64 << 20 });
  }
}

async function briefYoutube(url) {
  let meta;
  try {
    meta = JSON.parse((await ytdlp(["-J", "--flat-playlist", "--no-warnings", url])).stdout);
  } catch (e) {
    throw new Error(`yt-dlp failed - try the nightly build (SKILL.md, "yt-dlp"): ${e.message.split("\n")[0]}`);
  }
  const thumb = (m) => m.thumbnail || (m.thumbnails || []).slice(-1)[0]?.url;
  if (meta._type === "playlist") {
    return {
      source: "youtube-playlist",
      show: { title: meta.title, description: (meta.description || "").slice(0, 800), author: meta.uploader || meta.channel, artwork: await fetchImage(thumb(meta), "playlist") },
      items: (meta.entries || []).slice(0, 60).map((e) => ({ title: e.title, durationSeconds: e.duration })),
    };
  }
  // Captions: the creator's own if any, else automatic ones, in the video's language.
  let transcript = null;
  const lang = meta.language || Object.keys(meta.subtitles || {})[0] || "en";
  const pick = (pool) => {
    const key = Object.keys(pool || {}).find((k) => k === lang || k.startsWith(lang + "-") || k.endsWith("-orig"));
    return key && pool[key].find((f) => f.ext === "vtt")?.url;
  };
  const capUrl = pick(meta.subtitles) || pick(meta.automatic_captions);
  if (capUrl) transcript = await fetchTranscript(capUrl);
  return {
    source: "youtube",
    show: { title: meta.title, author: meta.uploader || meta.channel, language: meta.language || null, artwork: await fetchImage(thumb(meta), "thumbnail") },
    items: [{
      title: meta.title, durationSeconds: meta.duration,
      description: (meta.description || "").slice(0, 1500), tags: (meta.tags || []).slice(0, 20),
      chapters: (meta.chapters || []).map((c) => ({ start: c.start_time, title: c.title })),
      transcript,
    }],
  };
}

async function briefFiles(files) {
  const items = [];
  for (const f of files) {
    let tags = {}, duration = null;
    try {
      const probe = JSON.parse((await run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", f])).stdout);
      tags = Object.fromEntries(Object.entries(probe.format?.tags || {}).map(([k, v]) => [k.toLowerCase(), decode(String(v)).slice(0, 1500)]));
      duration = probe.format?.duration ? Math.round(Number(probe.format.duration)) : null;
    } catch {}
    // Embedded cover art (album art), if the file carries any.
    let artwork = null;
    const tmp = join(artDir, ".embedded.png");
    try {
      await run("ffmpeg", ["-v", "quiet", "-y", "-i", f, "-an", "-frames:v", "1", tmp]);
      if (existsSync(tmp)) { artwork = await keepImage(readFileSync(tmp), tags.album || tags.title || basename(f)); rmSync(tmp); }
    } catch {}
    items.push({
      file: f, durationSeconds: duration,
      title: tags.title || basename(f), artist: tags.artist || null, album: tags.album || null,
      description: tags.comment || tags.description || null, lyrics: tags.lyrics || tags["unsyncedlyrics"] || null,
      artwork,
    });
  }
  return { source: "files", items };
}

let brief;
try {
  if (kind === "feed") brief = await briefFeed(args[0]);
  else if (kind === "youtube") brief = await briefYoutube(args[0]);
  else if (kind === "file") brief = await briefFiles(args);
  else if (kind === "image") brief = { source: "images", items: await Promise.all(args.map((u, i) => fetchImage(u, `image-${i + 1}`))) };
  else throw new Error(`unknown source kind "${kind}"`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
brief.artwork = art; // every image kept, with its palette, in one list
writeFileSync(join(outDir, "brief.json"), JSON.stringify(brief, null, 2));
console.log(JSON.stringify(brief, null, 2));
