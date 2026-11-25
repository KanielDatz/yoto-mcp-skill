# yoto skill

Create Yoto MYO cards from an agent (Claude Code / NanoClaw / any MCP client): upload audio, add tracks, set pixel-art icons and a cover, and edit chapters.

- `SKILL.md` — the workflow the agent follows (art generation is a default step of the new-card pipeline)
- `server/` — the Yoto MCP server (Node/TypeScript)
- `art/` — pixel-art generator: `make.mjs` (Science-Yuck card), `make-ouz.mjs` (template for a new card), Rubik font
- `art/labels.mjs` — A4 PDF of sticker labels for the physical cards
- `tools/yoto-chapters.mjs` — list / remove / rename chapters on an existing card
- `tools/yoto-discover.mjs` — per-child profiles and scheduled discovery of new content

## Quickest path: let an agent set it up

If the agent you are using can see this repo and run commands, you don't have to work
through the steps below by hand. Ask it to set up the yoto skill. `SKILL.md` tells it to
check what is already in place first, do the parts it can do itself (building the server,
installing the art dependencies, fixing the font path), and come back to you only for the
two things it cannot get on its own: your Yoto client ID, and the auth code from your
browser. It also knows the two points where this looks broken but isn't — see steps 2 and 3.

The rest of this file is the manual path, and the reference for what the agent is doing.

## Before you start: register your own Yoto client ID

Go to https://yoto.dev, create an app, and copy its client ID. The server reads it from
the `YOTO_CLIENT_ID` environment variable and will not authenticate without it — every
auth tool returns a message telling you to set it.

```bash
export YOTO_CLIENT_ID=your_client_id_here
```

In an MCP client, set it in the server's `env` block instead (see the examples below).

It is a public PKCE client ID, not a secret, so there is nothing in it to leak. But each
registration carries its own rate limits, so use one of your own rather than borrowing
someone else's. Registering takes a minute and is free.

## Credits

The server is based on [bperkinspdx/yoto-mcp-server](https://github.com/bperkinspdx/yoto-mcp-server)
with changes:
PKCE + paste-the-code auth, correct add-track endpoint (`POST /content`), longer transcode
polling, `yoto-set-card-art`, and a configurable token path. MIT licensed — see `LICENSE`.

## 1. Build the server

```bash
cd server
npm install
npm run build        # -> dist/index.js
```

Tokens are stored in `server/.yoto-mcp-config.json` (override with `YOTO_CONFIG_PATH`). It is gitignored; add a `.gitignore` containing `.yoto-mcp-config.json`, `node_modules/`, `dist/` if you don't have one. Keep the file on persistent storage (in containers, under a mounted workspace, not `$HOME`).

## 2. Connect it to your agent

**Claude Code / any stdio MCP client:**

```json
{
  "mcpServers": {
    "yoto": {
      "command": "node",
      "args": ["/abs/path/to/server/dist/index.js"],
      "env": { "YOTO_CLIENT_ID": "your_client_id_here" }
    }
  }
}
```

or `claude mcp add yoto -e YOTO_CLIENT_ID=your_client_id_here -- node /abs/path/to/server/dist/index.js`.

**Restart the client fully after editing this** — not a new chat, the whole application.
MCP servers are read at startup, so until you do, the `yoto-*` tools simply won't be there
and nothing will look like it worked.

**NanoClaw (this skill's home):**

```bash
ncl groups config add-mcp-server --name yoto --command node \
  --args '["/workspace/agent/yoto-mcp-server/dist/index.js"]'
ncl groups restart      # needs admin approval; config changes apply after restart
```

`YOTO_CLIENT_ID` goes in the `env` field of the `yoto` entry in the group's container
config, the same place as `NO_PROXY` below.

If the container goes through an HTTPS-intercepting proxy (OneCLI), the Yoto hosts must bypass it so the OAuth/API calls aren't rewritten — add to the server's `env`:

```json
"env": { "NO_PROXY": "login.yotoplay.com,api.yotoplay.com", "no_proxy": "login.yotoplay.com,api.yotoplay.com" }
```

(In NanoClaw that's the `env` field of the `yoto` entry in the group's container config.)

## 3. Authenticate with Yoto (once)

1. Call `yoto-auth` — returns a login URL. Open it in a browser and approve.
2. The browser then fails to load `http://127.0.0.1:8787/callback?code=...&state=...` — that's expected (nothing listens there). Copy the `code` value from the address bar.
3. Call `yoto-auth-complete` with that code. Verify with `yoto-check-auth`.

The refresh token is saved and renewed automatically.

## 4. Art tooling

```bash
cd art && npm install                       # sharp, pdf-lib
# edit fonts.conf: set <dir> to the absolute path of ./fonts
FONTCONFIG_FILE=$PWD/fonts.conf node make-ouz.mjs ./out   # writes icon-*.png, cover.png, sheet.png
```

Icons must be 16x16 PNG, cover ~638x1011 portrait. Apply with the `yoto-set-card-art` tool. To make art for a new card, copy `make-ouz.mjs`, replace the `ICONS` grids (palette chars at the top of the file) and the cover SVG text/composition.

## 4a. Printable labels

```bash
node art/labels.mjs list                                   # your cards, and which have a cover
node art/labels.mjs pdf labels.pdf <cardId> <cardId> ...   # whole A4 sheet, up to 11 labels
node art/labels.mjs pdf labels.pdf <cardId> --piece=2      # print on leftover piece #2
node art/labels.mjs pieces                                 # leftover pieces on record
```

Print on A4 PVC sticker paper (matte recommended) at **100% / Actual size**. Labels are the
card's cover art, 52 x 83.6 mm with rounded corners (`--exact` for the full 54 x 85.6 mm card
size), 5 mm apart, with a thin cut outline (`--no-guide` to drop it). Upright and sideways
labels are mixed to use the least height (11 per A4 sheet), packed at the top, and when the
rest of the sheet can still take a label, a dashed line marks where to cut it off,
and the piece below it is marked with its number and size ("#2  210 x 114 mm") and arrows
pointing at the end to feed into the printer first. Keep it and print on it next time with
`--piece=<id>` (or `--sheet=<height>` for a piece cut by hand), setting a custom paper size of
the same dimensions in the print dialog. Pieces are recorded in `.yoto-labels.json` next to
the token file; `pieces add <mm>` / `pieces drop <id>` correct the record.

## 5. Chapter tools

```bash
node tools/yoto-chapters.mjs <cardId> list
node tools/yoto-chapters.mjs <cardId> remove 8
node tools/yoto-chapters.mjs <cardId> rename 1 "New title"
```

## 6. Proactive discovery (per child)

Keeps a profile for each child and, on a schedule, looks for content that now fits them —
new episodes of podcasts they already have, and new shows matching their interests and
languages. It proposes; it never creates a card on its own. `SKILL.md` has the workflow the
agent follows.

```bash
node tools/yoto-discover.mjs ~/yoto/noa.json init     # then fill in the profile
node tools/yoto-discover.mjs ~/yoto/noa.json age      # age today, from birth month
node tools/yoto-discover.mjs ~/yoto/noa.json scan     # JSON: new episodes + new shows
node tools/yoto-discover.mjs ~/yoto/noa.json probe <feedUrl>   # inspect any feed
node tools/yoto-discover.mjs ~/yoto/noa.json autoadd <feedUrl> on   # keep a card updated
node tools/yoto-discover.mjs ~/yoto/noa.json vet <url>         # check BEFORE downloading
```

`vet` runs on every audio URL before it is downloaded. Feeds are not trusted input, so it
reads the first couple of kilobytes rather than the server's `Content-Type`, follows
redirects a hop at a time, and refuses anything that is not http(s), resolves to a private
or link-local address, or turns out to be an executable, archive, script, PDF or HTML page.
It also returns a sanitised filename — path traversal, control characters and null bytes
removed, length capped, non-Latin names kept — to use instead of the one in the URL.

A podcast that is already a card can be kept up to date automatically: with `autoadd` on
for that feed, scheduled runs add new episodes to the card and make icons for them, then
report what they added. It is opt-in per show, applies only to cards built from downloaded
files (an RSS-linked card updates itself), never covers a show the parent hasn't already
approved, and stops to ask rather than part-filling a card that is running out of room.

`scan` searches iTunes and re-reads the feeds already tracked. For everything iTunes misses
— כאן הסכתים, Podbean, Spreaker, Omny, YouTube, shows that publish only on their own site —
the agent searches the web and runs `probe` on what it finds, which pulls any feed into the
same pipeline and reports its language (feeds declare it; the iTunes API does not), whether
the episodes are actually downloadable, how recently it published, and its median length.

A YouTube channel's feed (`youtube.com/feeds/videos.xml?channel_id=<id>`) works with
`probe` too, so a channel can be watched for new uploads — though it carries no audio, so
YouTube is always delivered as downloaded files rather than a linked feed.

## Languages

The skill is not English-only. It replies in the parent's language, keeps titles in the
content's own language, and handles RTL — `art/make-ouz.mjs` is itself a Hebrew card. The
bundled Rubik font covers Latin, Hebrew and Cyrillic in full and Arabic in part; for Greek,
CJK, Devanagari or Thai, add a font to `art/fonts/` and change `font-family` in the cover
SVG.

## Card limits

A Make Your Own card holds **100 tracks**, **500 MB or 5 hours** of audio, with **100 MB or
60 minutes** per track ([Yoto
support](https://support.yotoplay.com/en_gb/how-much-audio-fits-on-a-make-your-own-card-r1ssdFimfl.md)).

Needs Node 18+; no dependencies. Store the age as `birth: "YYYY-MM"` — the tool recomputes
the age on every run, so a profile never goes stale.

Two things worth knowing about the iTunes Search API, both handled in the tool: it needs a
`User-Agent` or it answers every call with an empty body, and it rate-limits by answering
`200` with an empty body, which the tool retries with backoff rather than reading as "no
results".

Profiles describe a child, so keep them out of git — `.gitignore` already covers
`profiles/` and `*.profile.json`. Put them wherever `.yoto-mcp-config.json` lives, so they
survive restarts.
