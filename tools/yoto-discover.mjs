#!/usr/bin/env node
// Proactive content discovery for one child profile.
//
//   node yoto-discover.mjs <profile.json> init
//   node yoto-discover.mjs <profile.json> age
//   node yoto-discover.mjs <profile.json> scan
//   node yoto-discover.mjs <profile.json> record suggested|accepted|rejected <id> <title...>
//   node yoto-discover.mjs <profile.json> seen <feedUrl> <guid> <isoDate>
//   node yoto-discover.mjs <profile.json> track <cardId> <feedUrl> <title...>
//
// Needs Node 18+ (global fetch). No dependencies.
//
// `scan` prints JSON and decides nothing: filtering that needs judgement is
// left to the agent and the parent. It only does what is mechanical - age
// arithmetic, fetching, dropping explicit items, dropping anything already
// seen, and sorting.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "yoto-discover/1.0 (+https://github.com/KanielDatz/yoto-mcp-skill)";

// iTunes answers a throttled request with HTTP 200 and an EMPTY BODY, so an
// empty response means "try again", not "no results". Without the User-Agent
// above it does the same thing on every call.
async function getText(url, tries = 4) {
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

// ---------- profile ----------

const TEMPLATE = {
  name: "",
  birth: "",
  languages: [],
  interests: [],
  searchTerms: {},
  country: "US",
  preferredLengthMinutes: { min: null, max: null },
  // "rss" | "files" | null. null means ask the parent each time.
  delivery: null,
  avoid: [],
  notes: "",
  schedule: { frequency: "monthly", createdAt: null },
  feeds: [],
  history: { suggested: [], accepted: [], rejected: [] },
};

function load(path) {
  if (!existsSync(path)) {
    throw new Error(`no profile at ${path} - run: init`);
  }
  const p = { ...TEMPLATE, ...JSON.parse(readFileSync(path, "utf-8")) };
  p.history = { ...TEMPLATE.history, ...(p.history || {}) };
  return p;
}

function save(path, profile) {
  writeFileSync(path, JSON.stringify(profile, null, 2) + "\n");
}

// birth is "YYYY-MM" - the day is deliberately not collected, so treat it as
// the 1st. Recomputed on every run: content that was a stretch six months ago
// may fit now.
function ageAt(birth, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec((birth || "").trim());
  if (!m) throw new Error(`birth must be "YYYY-MM", got ${JSON.stringify(birth)}`);
  const [y, mo] = [Number(m[1]), Number(m[2])];
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - mo);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12, totalMonths: months };
}

// ---------- feeds ----------

function decode(s) {
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

function tag(block, names) {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m) return decode(m[1]);
  }
  return "";
}

function durationSeconds(raw) {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// Unlike the iTunes API, a feed usually declares its own language.
function parseChannel(xml) {
  const head = xml.split(/<item(?:\s|>)|<entry(?:\s|>)/i)[0];
  return {
    title: tag(head, ["title"]),
    description: tag(head, ["description", "itunes:summary", "subtitle"]).slice(0, 400),
    language: (/<language(?:\s[^>]*)?>([\s\S]*?)<\/language>/i.exec(head)?.[1] || "").trim() || null,
    author: tag(head, ["itunes:author", "managingEditor", "author"]),
    explicit: /<itunes:explicit(?:\s[^>]*)?>\s*(?:yes|true)\s*<\/itunes:explicit>/i.test(head),
  };
}

function parseFeed(xml) {
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
    };
  });
}

async function newEpisodes(feeds) {
  const out = [];
  for (const f of feeds) {
    try {
      const items = parseFeed(await getText(f.feedUrl));
      const seenGuid = f.lastSeenGuid || null;
      const seenAt = f.lastSeenDate ? new Date(f.lastSeenDate).valueOf() : null;
      const fresh = items.filter((it) => {
        if (seenGuid && it.guid === seenGuid) return false;
        if (seenAt && it.date) return new Date(it.date).valueOf() > seenAt;
        return !seenAt;
      });
      out.push({
        cardId: f.cardId || null,
        show: f.title || f.feedUrl,
        feedUrl: f.feedUrl,
        totalInFeed: items.length,
        episodes: fresh.slice(0, 25),
      });
    } catch (err) {
      out.push({ cardId: f.cardId || null, show: f.title || f.feedUrl, feedUrl: f.feedUrl, error: err.message });
    }
  }
  return out;
}

// ---------- new shows ----------

// iTunes exposes no language field, so language comes from the search TERMS
// plus `country`. Hence searchTerms: the interests written out in each of the
// child's languages. Falls back to `interests` when it is empty.
function termsFor(profile) {
  const pairs = [];
  const byLang = profile.searchTerms || {};
  for (const lang of Object.keys(byLang)) {
    for (const t of byLang[lang] || []) pairs.push({ lang, term: t });
  }
  if (!pairs.length) {
    for (const t of profile.interests || []) pairs.push({ lang: null, term: t });
  }
  return pairs;
}

async function findShows(profile) {
  const known = new Set();
  for (const f of profile.feeds || []) if (f.feedUrl) known.add(f.feedUrl);
  for (const key of ["suggested", "accepted", "rejected"]) {
    for (const h of profile.history[key] || []) known.add(String(h.id));
  }

  const found = new Map();
  for (const { lang, term } of termsFor(profile)) {
    for (const media of ["podcast", "music"]) {
      const url =
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
        `&media=${media}&country=${encodeURIComponent(profile.country || "US")}&limit=25`;
      let data;
      try {
        data = JSON.parse(await getText(url));
      } catch (err) {
        found.set(`error:${media}:${term}`, { error: err.message, term, media });
        continue;
      }
      for (const r of data.results || []) {
        const id = String(r.collectionId || r.trackId || "");
        if (!id || known.has(id) || (r.feedUrl && known.has(r.feedUrl))) continue;
        if (r.trackExplicitness === "explicit" || r.collectionExplicitness === "explicit") continue;
        if (found.has(id)) {
          if (lang && !found.get(id).matchedLanguages.includes(lang)) found.get(id).matchedLanguages.push(lang);
          continue;
        }
        found.set(id, {
          id,
          media,
          title: r.collectionName || r.trackName,
          artist: r.artistName,
          feedUrl: r.feedUrl || null,
          episodeCount: r.trackCount ?? null,
          latestRelease: r.releaseDate || null,
          genres: r.genres || [],
          artwork: r.artworkUrl600 || r.artworkUrl100 || null,
          url: r.collectionViewUrl || r.trackViewUrl || null,
          matchedTerm: term,
          matchedLanguages: lang ? [lang] : [],
        });
      }
    }
  }

  const months = (iso) =>
    iso ? (Date.now() - new Date(iso).valueOf()) / (1000 * 60 * 60 * 24 * 30.44) : null;

  return [...found.values()]
    .filter((s) => !s.error)
    .map((s) => ({ ...s, monthsSinceLatest: months(s.latestRelease) }))
    .sort((a, b) => (a.monthsSinceLatest ?? 999) - (b.monthsSinceLatest ?? 999));
}

// ---------- commands ----------

const [, , profilePath, cmd, ...rest] = process.argv;

if (!profilePath || !cmd) {
  console.error(
    [
      "usage: yoto-discover.mjs <profile.json> <command>",
      "  init                                       write a blank profile",
      "  age                                        age today, from birth",
      "  scan                                       JSON: new episodes + new shows",
      "  probe <feedUrl>                            inspect any feed found elsewhere",
      "  record suggested|accepted|rejected <id> <title...>",
      "  seen <feedUrl> <guid> <isoDate>            advance a feed's pointer",
      "  track <cardId> <feedUrl> <title...>        follow a feed for a card",
    ].join("\n")
  );
  process.exit(1);
}

if (cmd === "init") {
  if (existsSync(profilePath)) {
    console.error(`${profilePath} already exists - refusing to overwrite`);
    process.exit(1);
  }
  save(profilePath, TEMPLATE);
  console.log(`wrote blank profile to ${profilePath}`);
  console.log('fill in: name, birth ("YYYY-MM"), languages, interests, searchTerms, country');
  process.exit(0);
}

const profile = load(profilePath);

switch (cmd) {
  case "age": {
    const a = ageAt(profile.birth);
    console.log(`${profile.name || "child"}: ${a.years}y ${a.months}m (${a.totalMonths} months)`);
    break;
  }

  case "scan": {
    const a = ageAt(profile.birth);
    const [episodes, shows] = await Promise.all([newEpisodes(profile.feeds || []), findShows(profile)]);
    const withNew = episodes.filter((f) => (f.episodes || []).length);
    console.log(
      JSON.stringify(
        {
          child: profile.name,
          scannedAt: new Date().toISOString(),
          age: a,
          languages: profile.languages,
          avoid: profile.avoid,
          preferredLengthMinutes: profile.preferredLengthMinutes,
          nothingNew: !withNew.length && !shows.length,
          newEpisodes: episodes,
          newShows: shows,
        },
        null,
        2
      )
    );
    break;
  }

  // Brings a feed found anywhere - web search, Spotify, a station's own site -
  // into the same pipeline, without tracking it first.
  case "probe": {
    const [feedUrl] = rest;
    if (!feedUrl) {
      console.error("usage: probe <feedUrl>");
      process.exit(1);
    }
    const xml = await getText(feedUrl);
    const items = parseFeed(xml);
    const dated = items.filter((i) => i.date).sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = dated[0]?.date || null;
    const withAudio = items.filter((i) => i.audioUrl).length;
    const durations = items.map((i) => i.durationSeconds).filter((d) => d);
    console.log(
      JSON.stringify(
        {
          feedUrl,
          ...parseChannel(xml),
          episodeCount: items.length,
          episodesWithAudio: withAudio,
          downloadable: withAudio > 0,
          latestRelease: latest,
          monthsSinceLatest: latest
            ? (Date.now() - new Date(latest).valueOf()) / (1000 * 60 * 60 * 24 * 30.44)
            : null,
          medianDurationMinutes: durations.length
            ? Math.round(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] / 60)
            : null,
          recentEpisodes: (dated.length ? dated : items).slice(0, 10),
        },
        null,
        2
      )
    );
    break;
  }

  case "record": {
    const [bucket, id, ...title] = rest;
    if (!["suggested", "accepted", "rejected"].includes(bucket) || !id) {
      console.error("usage: record suggested|accepted|rejected <id> <title...>");
      process.exit(1);
    }
    profile.history[bucket].push({ id: String(id), title: title.join(" "), at: new Date().toISOString() });
    save(profilePath, profile);
    console.log(`recorded ${bucket}: ${id}`);
    break;
  }

  case "seen": {
    const [feedUrl, guid, isoDate] = rest;
    const f = (profile.feeds || []).find((x) => x.feedUrl === feedUrl);
    if (!f) {
      console.error(`not tracking ${feedUrl}`);
      process.exit(1);
    }
    f.lastSeenGuid = guid || f.lastSeenGuid;
    f.lastSeenDate = isoDate || new Date().toISOString();
    save(profilePath, profile);
    console.log(`${feedUrl} -> ${f.lastSeenDate}`);
    break;
  }

  case "track": {
    const [cardId, feedUrl, ...title] = rest;
    if (!cardId || !feedUrl) {
      console.error("usage: track <cardId> <feedUrl> <title...>");
      process.exit(1);
    }
    profile.feeds = profile.feeds || [];
    if (profile.feeds.some((f) => f.feedUrl === feedUrl)) {
      console.error(`already tracking ${feedUrl}`);
      process.exit(1);
    }
    profile.feeds.push({
      cardId,
      feedUrl,
      title: title.join(" "),
      lastSeenGuid: null,
      lastSeenDate: new Date().toISOString(),
    });
    save(profilePath, profile);
    console.log(`tracking ${feedUrl} for card ${cardId}`);
    break;
  }

  default:
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}
