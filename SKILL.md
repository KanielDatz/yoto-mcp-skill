---
name: yoto
description: Create and manage Yoto MYO cards from chat — upload audio, add tracks, and (by default) generate and apply pixel-art icons + cover. Use when asked to make or change a Yoto card, add songs/stories to a card, or give a card art.
---

# Yoto cards

Tools come from the `yoto` MCP server (`server/`, setup in README.md): `yoto-auth`, `yoto-auth-complete`, `yoto-check-auth`, `yoto-list-cards`, `yoto-get-card`, `yoto-upload-audio` (creates a card with track 1), `yoto-add-track`, `yoto-set-card-art`.

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
