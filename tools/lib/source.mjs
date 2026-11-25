// Shared by yoto-discover and yoto-brief: fetching, feed parsing, and vetting URLs before
// anything is downloaded from them.
import { lookup as dnsLookup } from "node:dns/promises";

export const UA = "yoto-discover/1.0 (+https://github.com/KanielDatz/yoto-mcp-skill)";

// iTunes answers a throttled request with HTTP 200 and an EMPTY BODY, so an
// empty response means "try again", not "no results". Without the User-Agent
// above it does the same thing on every call.
export async function getText(url, tries = 4) {
  let wait = 1500;
  for (let attempt = 1; ; attempt++) {
    let detail;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "follow",
      });
      const body = await res.text();
      if (res.ok && body.trim()) return body;
      detail = `HTTP ${res.status}, ${body.length} bytes`;
    } catch (err) {
      detail = err.message;
    }
    if (attempt >= tries) throw new Error(`${url} failed: ${detail}`);
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
}

// ---------- feeds ----------

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tag(block, names) {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m) return decode(m[1]);
  }
  return "";
}

export function durationSeconds(raw) {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// Unlike the iTunes API, a feed usually declares its own language.
function imageOf(block) {
  return (
    /<itunes:image[^>]*\shref=["']([^"']+)["']/i.exec(block)?.[1] ||
    /<image(?:\s[^>]*)?>[\s\S]*?<url>\s*([^<\s]+)\s*<\/url>/i.exec(block)?.[1] ||
    /<media:thumbnail[^>]*\surl=["']([^"']+)["']/i.exec(block)?.[1] ||
    null
  )?.replace(/&amp;/g, "&");
}

export function parseChannel(xml) {
  const head = xml.split(/<item(?:\s|>)|<entry(?:\s|>)/i)[0];
  return {
    title: tag(head, ["title"]),
    description: tag(head, ["description", "itunes:summary", "subtitle"]).slice(0, 400),
    language: (/<language(?:\s[^>]*)?>([\s\S]*?)<\/language>/i.exec(head)?.[1] || "").trim() || null,
    author: tag(head, ["itunes:author", "managingEditor", "author"]),
    explicit: /<itunes:explicit(?:\s[^>]*)?>\s*(?:yes|true)\s*<\/itunes:explicit>/i.test(head),
    image: imageOf(head),
  };
}

export function parseFeed(xml) {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  return blocks.map((b) => {
    const enclosure =
      /<enclosure[^>]*\surl=["']([^"']+)["']/i.exec(b)?.[1] ||
      /<link[^>]*rel=["']enclosure["'][^>]*href=["']([^"']+)["']/i.exec(b)?.[1] ||
      null;
    const dateRaw = tag(b, ["pubDate", "published", "updated", "dc:date"]);
    const parsed = dateRaw ? new Date(dateRaw) : null;
    return {
      guid: tag(b, ["guid", "id"]) || enclosure || tag(b, ["title"]),
      title: tag(b, ["title"]),
      description: tag(b, ["description", "itunes:summary", "summary", "content"]).slice(0, 400),
      date: parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : null,
      durationSeconds: durationSeconds(tag(b, ["itunes:duration"])),
      audioUrl: enclosure,
      image: imageOf(b),
      // Podcasting 2.0 tags: a transcript and a chapters file, when the show publishes them
      transcriptUrl: /<podcast:transcript[^>]*\surl=["']([^"']+)["']/i.exec(b)?.[1] || null,
      chaptersUrl: /<podcast:chapters[^>]*\surl=["']([^"']+)["']/i.exec(b)?.[1] || null,
    };
  });
}

// ---------- vetting downloads ----------

// Audio URLs come from feeds nobody here controls, so nothing is downloaded
// before it is checked. Signatures are read from the first bytes rather than
// trusting Content-Type, which the server chooses.
export const AUDIO_MAGIC = [
  { name: "mp3", test: (b) => b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 },
  { name: "mp3", test: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0 },
  { name: "mp4/m4a", test: (b) => b.slice(4, 8).toString("latin1") === "ftyp" },
  { name: "ogg/opus", test: (b) => b.slice(0, 4).toString("latin1") === "OggS" },
  { name: "flac", test: (b) => b.slice(0, 4).toString("latin1") === "fLaC" },
  {
    name: "wav",
    test: (b) =>
      b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WAVE",
  },
  { name: "wma/asf", test: (b) => b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75 },
];

// Things that must never be downloaded and handed to ffmpeg, a shell, or Yoto.
export const IMAGE_MAGIC = [
  { name: "png", test: (b) => b[0] === 0x89 && b.slice(1, 4).toString("latin1") === "PNG" },
  { name: "jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: "webp", test: (b) => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP" },
  { name: "gif", test: (b) => b.slice(0, 4).toString("latin1") === "GIF8" },
];

export const HOSTILE_MAGIC = [
  { name: "Windows executable", test: (b) => b[0] === 0x4d && b[1] === 0x5a },
  { name: "Linux executable", test: (b) => b.slice(0, 4).toString("latin1") === "\x7fELF" },
  { name: "Mach-O / Java class", test: (b) => b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe },
  { name: "zip archive (also jar/apk/office)", test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) },
  { name: "rar archive", test: (b) => b.slice(0, 4).toString("latin1") === "Rar!" },
  { name: "7z archive", test: (b) => b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf },
  { name: "gzip archive", test: (b) => b[0] === 0x1f && b[1] === 0x8b },
  { name: "shell script", test: (b) => b[0] === 0x23 && b[1] === 0x21 },
  { name: "PDF", test: (b) => b.slice(0, 5).toString("latin1") === "%PDF-" },
];

export function looksLikeMarkup(b) {
  const head = b.slice(0, 200).toString("latin1").trim().toLowerCase();
  return head.startsWith("<!do") || head.startsWith("<htm") || head.startsWith("<?xml") || head.startsWith("<rss");
}

export function isPrivateIp(ip) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (/^f[cd]/.test(v) || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb"))
      return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(v);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||            // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)     // CGNAT
  );
}

// Never trust a server-supplied name: it reaches the filesystem.
export function safeFilename(urlStr, format) {
  let base = "";
  try {
    base = decodeURIComponent(new URL(urlStr).pathname.split("/").pop() || "");
  } catch {}
  base = base.replace(/[\x00-\x1f\x7f]/g, "").replace(/[/\\]/g, "").replace(/^[.\-\s]+/, "");
  base = base.replace(/[^\p{L}\p{N}._\- ]/gu, "_").trim();
  if (!base || base === "." || base === "..") base = "audio";
  if (base.length > 80) base = base.slice(0, 80);
  const ext = (format.split("/")[0] || "bin").replace(/[^a-z0-9]/g, "");
  return /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.${ext}`;
}

// kind: "audio" (episodes), "image" (cover art, thumbnails) or "text" (transcripts, which
// may legitimately be HTML). Both get the same scheme,
// private-address and hostile-content checks; only the expected signature differs.
export async function vet(urlStr, maxBytes, kind = "audio") {
  const MAGIC = kind === "image" ? IMAGE_MAGIC : kind === "text" ? [{ name: "text", test: () => true }] : AUDIO_MAGIC;
  const reasons = [];
  const chain = [];
  let current = urlStr;
  let res = null;

  for (let hop = 0; hop < 6; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      return { url: urlStr, verdict: "dangerous", reasons: ["not a valid URL"] };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { url: urlStr, verdict: "dangerous", reasons: [`refusing scheme ${u.protocol}`], redirectChain: chain };
    }
    if (u.protocol === "http:") reasons.push("plain http, not https");

    try {
      const addrs = await dnsLookup(u.hostname, { all: true });
      const bad = addrs.filter((a) => isPrivateIp(a.address));
      if (bad.length) {
        return {
          url: urlStr,
          verdict: "dangerous",
          reasons: [`${u.hostname} resolves to a private address (${bad.map((b) => b.address).join(", ")})`],
          redirectChain: chain,
        };
      }
    } catch {
      // Behind an egress proxy local DNS may not resolve; the byte checks below
      // still apply, so note it rather than blocking.
      reasons.push(`could not resolve ${u.hostname} locally to check for a private address`);
    }

    chain.push(current);
    res = await fetch(current, {
      headers: { "User-Agent": UA, Accept: "*/*", Range: "bytes=0-2047" },
      redirect: "manual",
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      try { res.body?.cancel(); } catch {}
      current = new URL(loc, current).toString();
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    return { url: urlStr, verdict: "suspicious", reasons: [`HTTP ${res ? res.status : "no response"}`], redirectChain: chain };
  }

  const declaredType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const rangeTotal = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "")?.[1];
  const contentLength = Number(rangeTotal ?? res.headers.get("content-length") ?? NaN);

  // Read only the head, then stop: an oversized or hostile body is never pulled down.
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < 2048) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    got += value.length;
  }
  try { await reader.cancel(); } catch {}
  const head = Buffer.concat(chunks);

  const hostile = HOSTILE_MAGIC.find((m) => m.test(head));
  if (hostile) {
    return {
      url: urlStr, finalUrl: current, verdict: "dangerous",
      reasons: [`content is a ${hostile.name}, not ${kind}`],
      declaredType, contentLength, redirectChain: chain,
    };
  }
  if (kind !== "text" && looksLikeMarkup(head)) {
    return {
      url: urlStr, finalUrl: current, verdict: "dangerous",
      reasons: [`content is HTML/XML, not ${kind} - usually an error, login or paywall page`],
      declaredType, contentLength, redirectChain: chain,
    };
  }

  const match = MAGIC.find((m) => m.test(head));
  const detectedFormat = match ? match.name : null;
  if (!detectedFormat) reasons.push(`no recognised ${kind} signature in the first bytes`);
  if (kind !== "text" && declaredType && !declaredType.startsWith(`${kind}/`) && declaredType !== "application/octet-stream")
    reasons.push(`server declared ${declaredType}, not an ${kind} type`);
  if (kind !== "text" && detectedFormat && declaredType.startsWith(`${kind}/`) === false && declaredType)
    reasons.push(`declared type ${declaredType} disagrees with detected ${detectedFormat}`);
  if (Number.isFinite(contentLength)) {
    if (contentLength > maxBytes)
      reasons.push(`${(contentLength / 1048576).toFixed(0)} MB exceeds the ${(maxBytes / 1048576).toFixed(0)} MB cap`);
    if (kind !== "text" && contentLength < (kind === "image" ? 500 : 10000))
      reasons.push(`only ${contentLength} bytes - too small to be ${kind === "image" ? "an image" : "an episode"}`);
  } else {
    reasons.push("server gave no size");
  }

  const verdict = !detectedFormat || reasons.some((r) => /exceeds|too small/.test(r)) ? "suspicious" : reasons.length ? "safe" : "safe";
  return {
    url: urlStr, finalUrl: current, verdict,
    reasons, declaredType, contentLength: Number.isFinite(contentLength) ? contentLength : null,
    detectedFormat, redirectChain: chain,
    suggestedFilename: safeFilename(current, detectedFormat || "bin"),
  };
}
