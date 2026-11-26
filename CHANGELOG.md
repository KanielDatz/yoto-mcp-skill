# Changelog

## 2026-11-26 — creative covers built from the content

- Required cover process: read every episode's description, list 6-8 elements with their
  episode (`elements.json`), put the official picture in the middle, design three options
  that differ in concept, composition and technique, show them, wait, back up, apply.
- `styles.mjs inspire` draws three random, different concepts from a library of 22 (treasure
  map, time machine, collector card, board game, diorama, pixel world, stamp, sticker album,
  storybook, display case, snow globe, theatre, comic, star map, train...) with a random
  twist, skipping ones used on recent cards.
- `gallery` refuses options that share a concept, composition or style, lack `concept`,
  `elements`, the real picture or hand-drawn objects, or repeat a recent card's concept;
  it shows each option's name and idea and prints which object comes from which episode.
  `chosen` and `history` keep the concept record.
- New style `diorama` (paper box, layers at depth 1-5 with growing shadows). `pixel` now makes
  a whole game scene (stepped sky, ground, crisp sprites, limited palette) and keeps real
  artwork sharp.
- New layers: `label`, `frame` (stamp, card, book, case, ticket, scroll, globe, stage),
  `dots`, `tiles`, `sprite`, and `depth` on any layer. 30 more hand-drawn motifs.
- `yoto-brief` keeps descriptions nearly whole for every episode, accepts local image files
  and writes an `elements.json` skeleton.
- `tools/yoto-cover-backup.mjs` saves the old cover and icons and prints the restore call.

## 2026-11-25 — smaller piece marker

- The leftover piece's number and size now sit right under the cut line, in a strip under
  5 mm (about 3 mm), so later labels printed on that piece never collide with them.

## 2026-11-25 — three real cover options

- Every new cover shows exactly three, very different designs: the real picture found for
  the content, a drawing, and a second drawing in another style and layout. A saved
  favourite style no longer skips the choice; it styles one of the drawings.
- `styles.mjs gallery` takes three separate specs (`gallery out.png a.json b.json c.json`),
  each with an optional `optionLabel` shown under its number.

## 2026-11-25 — lessons from real use

- **Open sources first.** Audio comes from the parent's files, RSS, YouTube, Archive.org and
  creators' sites; iTunes, Spotify and Apple Music are used for metadata only.
- **Original artwork on the cover.** Art tied to the content goes on the cover centred, never
  redrawn. The brief trims plain empty margins off saved images. Avoid `pixel` for real
  artwork (it blurs). The cover is shown to the parent before it is applied.
- **yt-dlp:** use the nightly build with `--js-runtimes node`; stop and ask for files if
  every video still fails. `yoto-brief` honours `$YTDLP`.
- **Proxies:** `tools/yt-dlp-proxy.py` makes yt-dlp trust the proxy's CA without turning off
  certificate checks.
- **Containers:** install `art/node_modules` where the art scripts run; check the platform.
- **Auth recovery:** the server creates the config directory on save, and if the save still
  fails it keeps the sign-in so `yoto-auth-complete` can retry without a new code. A refreshed
  token is kept the same way.
- **Tracks** are added one at a time and checked with `yoto-get-card` at the end.
- **Characters:** icons that guess at a character are flagged as guesses when delivered.

## 2026-11-25 — covers and stickers

- Printable A4 sticker sheets (`art/labels.mjs`) with a cut line and remembered leftover
  pieces.
- Cover styles (`art/styles.mjs`): up to three playful options, mixes, plain readable titles,
  a learned default per child.
- Content brief (`tools/yoto-brief.mjs`): what the audio is about and the source's own
  artwork, gathered before designing.
