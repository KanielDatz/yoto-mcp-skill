---
name: yoto
description: Create and manage Yoto MYO cards from chat — upload audio, add tracks, and (by default) generate and apply pixel-art icons + cover. Use when asked to make or change a Yoto card, add songs/stories to a card, or give a card art. Also covers first-run setup: connecting the MCP server, registering a Yoto client ID, and authenticating.
---

# Yoto cards

Tools come from the `yoto` MCP server (`server/`, setup in README.md): `yoto-auth`, `yoto-auth-complete`, `yoto-check-auth`, `yoto-list-cards`, `yoto-get-card`, `yoto-upload-audio` (creates a card with track 1), `yoto-add-track`, `yoto-set-card-art`.

## First run: get the user set up before anything else

**Work out what is already done before you ask or change anything.** Anyone past their
first card has some of this set up already, possibly months ago. Check all of it, in this
order, and never ask the user something you can establish by looking:

1. Are the `yoto-*` tools in your tool list? If not, the MCP server isn't connected —
   nothing else can be checked until it is.
2. `yoto-check-auth`. One call separates two states: a missing `YOTO_CLIENT_ID` comes back
   as that error, anything else means the ID is fine and only the token is missing.
3. Does `art/node_modules/` exist, and does the `<dir>` in `art/fonts.conf` point at a
   directory that is actually there? Read the file and look; don't ask.

Then fix only the gaps and go straight on to what the user actually asked for. If
everything checks out, say nothing about setup at all — skip to the pipeline. Announcing
that you verified a setup the user completed months ago is noise.

Throughout: assume no terminal experience unless the user shows otherwise. Run the commands
yourself wherever you can instead of dictating them, ask one question at a time, and check
each step worked before moving to the next. Never paste the README at the user — walk them
through it.

**No `yoto-*` tools in your tool list.** The MCP server isn't connected. Ask which client
they use (Claude Code, Claude Desktop, NanoClaw, other) — the config location differs. Build
it for them (`cd server && npm install && npm run build`), then hand them the exact JSON
block for that client, `env.YOTO_CLIENT_ID` included, and say plainly that the client must
be fully restarted before the tools show up. Expect to be asked "is it working yet?" before
the restart.

**An auth tool returns `YOTO_CLIENT_ID is not set`.** Send them to https://yoto.dev to create
an app and copy its client ID. Tell them it's free and takes about a minute, and that this
ID is not a secret (it's a public PKCE client ID) — people reasonably hesitate before
pasting anything credential-shaped into a chat. It goes in the `env` block of the server's
MCP config, then the client restarts again.

**Not authenticated.** Call `yoto-auth` and give them the link. *Before* they click it, warn
them that once they approve, the browser will show an error page at `127.0.0.1:8787` — that
is expected, nothing is listening there, and it does not mean anything broke. Without that
warning most people stop and report a failure. Ask them to copy the `code=...` value from
the address bar, pass it to `yoto-auth-complete`, and confirm with `yoto-check-auth`.

**Art tooling not ready.** `cd art && npm install` (sharp), and set `<dir>` in
`art/fonts.conf` to the absolute path of `art/fonts`. Make that edit yourself; don't ask.

If the token file sits somewhere ephemeral (a container's `$HOME`), say once that
`YOTO_CONFIG_PATH` should point at persistent storage, or they re-authenticate every restart.

## Pipeline for a new card (art is a default step, not optional)

1. **Find / prepare the audio** (yt-dlp, RSS, files). Latest yt-dlp is required — old builds fail with "Requested format is not available". If a feed exists, this is where you settle RSS vs downloaded files — see "RSS or downloaded files" below.
2. **Show a table and wait for approval before touching Yoto**: track #, title, duration, source. If unsure whether content is one long recording or separate songs, ask. One song per track is the usual wish.
3. **Create the card**: `yoto-upload-audio` with track 1 (title = card title), then `yoto-add-track` for each remaining track *sequentially, in order*. Fix track 1's title afterwards: `node tools/yoto-chapters.mjs <cardId> rename 1 "<title>"`.
4. **Art — carry straight on; this needs no second approval.** Approving the card covers its art. Read each track's actual content (description / summary / lyrics / audio), not just the title, then design one icon per track plus a cover.
5. **Generate**: copy `art/make-ouz.mjs` as the template (16x16 grids using the palette in the file; cover is a 160x253 SVG upscaled to 638x1011). Run with `FONTCONFIG_FILE=<art/fonts.conf> node make-xyz.mjs`, open `sheet.png` and `cover.png` to eyeball before applying (check symmetry and stray gaps).
6. **Apply**: `yoto-set-card-art` with `coverPath` and `icons: [{track, iconPath}, ...]`.
7. Tell the user to re-sync the player to see changes.

## Proactive discovery by child profile

Finds content that fits one specific child and proposes it. `tools/yoto-discover.mjs` does
the mechanical part; every judgement call, and every write to Yoto, stays with the parent.

**Downloading podcast audio is for personal use only.** Say so once while setting this up,
and don't help turn a card into anything shared or distributed.

### 1. The profile

One file per child, somewhere that survives restarts (next to `.yoto-mcp-config.json`, not
in a container's `$HOME`). `node tools/yoto-discover.mjs <path> init` writes the skeleton.
Never commit these files — they describe a child.

- `name`
- `birth` — **`"YYYY-MM"`, never an age.** Month and year; the day is not collected. Age is
  recomputed from it on every run, so the profile cannot go stale.
- `languages` — e.g. `["he", "en"]`
- `interests` — animals, the human body, history, stories, music…
- `searchTerms` — the interests written out per language, e.g.
  `{"he": ["חיות", "גוף האדם"], "en": ["animal facts kids"]}`. iTunes exposes no language
  field at all, so language comes from the search terms plus `country`: without terms in
  Hebrew, a Hebrew-speaking child gets English results only.
- `country` — iTunes storefront, e.g. `IL`
- optional: `preferredLengthMinutes`, `avoid` (unwanted content), `notes`, `delivery`
  (the RSS-or-files default — see below)

If there is no profile, offer to build one and ask for all of it **in one short
conversation**, not one question per turn. Then invite the parent to add anything else
about the child in their own words and put it in `notes`. "Obsessed with sharks since the
summer", "won't sit still for anything over ten minutes" is what makes a later suggestion
land.

### 2. The scheduled scan

Ask how often (default: **monthly**) and create a scheduled task with whatever the host
offers. Record the answer in `schedule`.

Each run is `node tools/yoto-discover.mjs <profile> scan`, which prints JSON and:

- recomputes the age — widen what you consider accordingly, since something that was a
  stretch six months ago may fit now;
- re-reads every feed in `feeds` and returns only episodes past that feed's pointer, which
  is how new episodes of podcasts that are already cards get found;
- searches iTunes per search term × language × {podcast, music}, with `country`;
- drops explicit items, and anything already in `feeds` or `history`.

#### Looking past iTunes

`scan` covers iTunes and the feeds already tracked. That is the mechanical half — the rest
is yours, with web search:

- **iTunes handles Hebrew better than it looks.** Hebrew terms with `country=IL` return
  Israeli shows along with their real feed URLs (Spreaker, Omny and the like). Start there
  before going further afield.
- **For what it misses, search the web directly**: כאן הסכתים, Podbean, Spreaker, Omny,
  shows that publish only on their own site. Also just ask the parent where they get
  podcasts — they usually know the local landscape better than any index.
- **Spotify is for finding out what exists, not for sourcing.** Spotify-exclusive shows and
  streamed music have no downloadable audio and no feed, so they cannot become a card.
  Don't propose something that can't be delivered.

Run `probe <feedUrl>` on anything you find before proposing it. It pulls any feed into the
same pipeline and answers what actually matters:

- `language` — feeds declare their own, unlike the iTunes API, so this is the one reliable
  language signal available
- `downloadable` / `episodesWithAudio` — whether there is real audio to put on a card
- `monthsSinceLatest`, `episodeCount` — whether the show is alive or abandoned
- `medianDurationMinutes` — against the child's preferred length

Then **you** apply the filters that need judgement: age fit, language, `avoid`, and
quality. For quality use `episodeCount` and `monthsSinceLatest`: a show last touched two
years ago is probably dead, and a "show" with one episode is probably not a show. `genres`
is a hint, not proof.

### 3. Proposing — never act alone

Send a table: name, one-line description, length, **why it fits this child in particular**,
and a recommendation (new card, or add to an existing one). "She likes animals" is not a
reason; "ten-minute animal quizzes, and she has been asking about predators" is.

Then wait for approval. Before creating anything, always ask two things:

1. RSS or downloaded files — see the section below, and skip the question only if the
   profile already has a `delivery` default
2. how many cards to split it across?

Art is not one of these questions: once the card is approved, carry on through icons and
cover without stopping.

**If nothing is new, send nothing at all.** A monthly task that reports "nothing new this
month" teaches the parent to ignore it.

### 4. After approval

Create it as in the pipeline above — upload, fill each card up to the Yoto limit, then
cover and icons. Then write down what happened, so nothing is ever proposed twice:

- `record suggested <id> <title>` for everything you put in the table, and
  `record accepted|rejected <id> <title>` once the parent decides
- `track <cardId> <feedUrl> <title>` when a podcast becomes a card, so later runs pick up
  its new episodes
- `seen <feedUrl> <guid> <isoDate>` once episodes are actually on a card

## RSS or downloaded files

Whenever content is available as a feed, **ask which the parent wants** — the answer
depends on their home, not on the content. Explain both briefly; most people have never
been asked.

**Link the RSS feed**
- New episodes appear on the card by themselves; nothing to do later
- Nothing to upload, so the card is ready immediately
- **Needs a decent connection on the player every single time it plays.** On weak or busy
  wifi it stalls or won't start at all
- Plays nothing away from wifi — the car, a plane, a grandparent's house
- Episodes can change or disappear if the publisher removes them

**Download the files**
- Plays offline, every time, with no connection at all
- Fixed: exactly the episodes chosen, and they never vanish
- Starts instantly, no buffering
- New episodes need another run to be added
- Upload and transcode take time up front (long audio, minutes)
- Counts against the card's capacity

Rule of thumb: weak or unreliable wifi, or a child who listens in the car and away from
home — files. A podcast they follow and play at home on good wifi — RSS. If the parent has
already told you their connection is poor, recommend files and say why.

Then offer to save the answer as their default in the profile's `delivery`
(`"rss"` | `"files"`; `null` means keep asking), and say they can change it whenever. With
a default set, don't ask again — but do say which one you are using, so it stays visible.

## Editing

- List / remove (renumbers) / rename a chapter: `node tools/yoto-chapters.mjs <cardId> list|remove <n>|rename <n> <title>`.
- There's no delete-card tool in the MCP server.

## Notes

- Long audio (e.g. 89 min) needs a long transcode-poll timeout; the server polls up to 10 minutes.
- If the agent runs behind an HTTPS-intercepting proxy, set `NO_PROXY=login.yotoplay.com,api.yotoplay.com` for the MCP server (see README).
- Never commit or share `.yoto-mcp-config.json` — it holds the OAuth tokens.
