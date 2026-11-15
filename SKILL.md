---
name: yoto
description: Create and manage Yoto MYO cards from chat — upload audio, add tracks, and (by default) generate and apply pixel-art icons + cover. Use when asked to make or change a Yoto card, add songs/stories to a card, or give a card art. Also covers first-run setup: connecting the MCP server, registering a Yoto client ID, and authenticating.
---

# Yoto cards

Tools come from the `yoto` MCP server (`server/`, setup in README.md): `yoto-auth`, `yoto-auth-complete`, `yoto-check-auth`, `yoto-list-cards`, `yoto-get-card`, `yoto-upload-audio` (creates a card with track 1), `yoto-add-track`, `yoto-set-card-art`.

## First run: get the user set up before anything else

Call `yoto-check-auth` at the start of any Yoto request. It tells you where the user
actually is, so you don't walk someone through steps they finished weeks ago. Fix only the
step that is actually broken, then carry on with what they asked for.

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

1. **Find / prepare the audio** (yt-dlp, RSS, files). Latest yt-dlp is required — old builds fail with "Requested format is not available".
2. **Show a table and wait for approval before touching Yoto**: track #, title, duration, source. If unsure whether content is one long recording or separate songs, ask. One song per track is the usual wish.
3. **Create the card**: `yoto-upload-audio` with track 1 (title = card title), then `yoto-add-track` for each remaining track *sequentially, in order*. Fix track 1's title afterwards: `node tools/yoto-chapters.mjs <cardId> rename 1 "<title>"`.
4. **Art**: read each track's actual content (description / summary / lyrics / audio), not just the title. Propose one icon concept per track plus a cover concept, wait for approval.
5. **Generate**: copy `art/make-ouz.mjs` as the template (16x16 grids using the palette in the file; cover is a 160x253 SVG upscaled to 638x1011). Run with `FONTCONFIG_FILE=<art/fonts.conf> node make-xyz.mjs`, open `sheet.png` and `cover.png` to eyeball before applying (check symmetry and stray gaps).
6. **Apply**: `yoto-set-card-art` with `coverPath` and `icons: [{track, iconPath}, ...]`.
7. Tell the user to re-sync the player to see changes.

## Editing

- List / remove (renumbers) / rename a chapter: `node tools/yoto-chapters.mjs <cardId> list|remove <n>|rename <n> <title>`.
- There's no delete-card tool in the MCP server.

## Notes

- Long audio (e.g. 89 min) needs a long transcode-poll timeout; the server polls up to 10 minutes.
- If the agent runs behind an HTTPS-intercepting proxy, set `NO_PROXY=login.yotoplay.com,api.yotoplay.com` for the MCP server (see README).
- Never commit or share `.yoto-mcp-config.json` — it holds the OAuth tokens.
