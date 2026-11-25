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
import { UA, getText, parseChannel, parseFeed, vet } from "./lib/source.mjs";

// Yoto Make Your Own limits, per Yoto support. Reported by `scan` so capacity
// is checked before anything is uploaded, not after.
const CARD_LIMITS = {
  maxTracks: 100,
  maxCardSeconds: 5 * 3600,
  maxCardBytes: 500 * 1024 * 1024,
  maxTrackSeconds: 60 * 60,
  maxTrackBytes: 100 * 1024 * 1024,
};

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
  // Cover style. null means offer options each time; set only after the parent agrees.
  style: null,
  styleChoices: [],
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
      const picked = fresh.slice(0, 25).map((e) => ({
        ...e,
        // A single track cannot exceed the per-track limit, so this one needs
        // splitting or skipping - never silently dropping.
        tooLongForTrack:
          e.durationSeconds != null && e.durationSeconds > CARD_LIMITS.maxTrackSeconds,
      }));
      out.push({
        cardId: f.cardId || null,
        show: f.title || f.feedUrl,
        feedUrl: f.feedUrl,
        autoAdd: f.autoAdd === true,
        totalInFeed: items.length,
        newTotalDurationSeconds: picked.reduce((s, e) => s + (e.durationSeconds || 0), 0),
        episodes: picked,
      });
    } catch (err) {
      out.push({
        cardId: f.cardId || null,
        show: f.title || f.feedUrl,
        feedUrl: f.feedUrl,
        autoAdd: f.autoAdd === true,
        error: err.message,
      });
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
      "  vet <url...> [--max-mb=N]                  check audio URLs BEFORE downloading",
      "  record suggested|accepted|rejected <id> <title...>",
      "  seen <feedUrl> <guid> <isoDate>            advance a feed's pointer",
      "  track <cardId> <feedUrl> [--auto] <title...>  follow a feed for a card",
      "  autoadd <feedUrl> on|off                   auto-add new episodes to that card",
      "  stylepick <style> [cardTitle...]           record the cover style the parent chose",
      "  styledefault <style>|off|declined <style>  set/clear the default, or note a no",
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
          cardLimits: CARD_LIMITS,
          delivery: profile.delivery,
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
  // Run before downloading anything. Reads only the first bytes.
  case "vet": {
    const urls = rest.filter((r) => !r.startsWith("--"));
    const capArg = rest.find((r) => r.startsWith("--max-mb="));
    const maxBytes = capArg ? Number(capArg.split("=")[1]) * 1048576 : CARD_LIMITS.maxTrackBytes * 2;
    if (!urls.length) {
      console.error("usage: vet <url...> [--max-mb=N]");
      process.exit(1);
    }
    const results = [];
    for (const u of urls) {
      try {
        results.push(await vet(u, maxBytes));
      } catch (err) {
        results.push({ url: u, verdict: "suspicious", reasons: [`check failed: ${err.message}`] });
      }
    }
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    if (results.some((r) => r.verdict === "dangerous")) process.exit(2);
    break;
  }

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
    const auto = rest.includes("--auto");
    const [cardId, feedUrl, ...title] = rest.filter((a) => a !== "--auto");
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
      autoAdd: auto,
      lastSeenGuid: null,
      lastSeenDate: new Date().toISOString(),
    });
    save(profilePath, profile);
    console.log(`tracking ${feedUrl} for card ${cardId}${auto ? " (auto-add on)" : ""}`);
    break;
  }

  // Opt in per show. Off unless the parent asked for it on that show.
  case "autoadd": {
    const [feedUrl, state] = rest;
    if (!feedUrl || !["on", "off"].includes(state)) {
      console.error("usage: autoadd <feedUrl> on|off");
      process.exit(1);
    }
    const f = (profile.feeds || []).find((x) => x.feedUrl === feedUrl);
    if (!f) {
      console.error(`not tracking ${feedUrl}`);
      process.exit(1);
    }
    f.autoAdd = state === "on";
    save(profilePath, profile);
    console.log(`auto-add ${state} for ${f.title || feedUrl}`);
    break;
  }

  // Which cover style the parent picked, card by card. Once a style has won at least three of
  // the last four picks and there is no default yet, the output says so - the agent then asks
  // the parent whether to make it the default. It never sets one on its own.
  case "stylepick": {
    const [style, ...title] = rest;
    if (!style) {
      console.error("usage: stylepick <style> [cardTitle...]");
      process.exit(1);
    }
    profile.styleChoices = profile.styleChoices || [];
    profile.styleChoices.push({ style, card: title.join(" "), at: new Date().toISOString() });
    save(profilePath, profile);
    const recent = profile.styleChoices.slice(-4).map((c) => c.style);
    const counts = recent.reduce((m, st) => ({ ...m, [st]: (m[st] || 0) + 1 }), {});
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const askDefault = !profile.style && !profile.styleDeclined?.includes(top) && n >= 3 ? top : null;
    console.log(JSON.stringify({ recorded: style, recent, default: profile.style || null, askDefault }, null, 2));
    break;
  }

  case "styledefault": {
    const [style] = rest;
    if (!style) {
      console.error("usage: styledefault <style>|off|declined <style>");
      process.exit(1);
    }
    if (style === "declined") {
      // the parent said no: don't ask about this style again
      profile.styleDeclined = [...new Set([...(profile.styleDeclined || []), rest[1]])];
    } else {
      profile.style = style === "off" ? null : style;
    }
    save(profilePath, profile);
    console.log(`default style: ${profile.style || "none (offer options each time)"}`);
    break;
  }

  default:
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}
