# yoto skill

Create Yoto MYO cards from an agent (Claude Code / NanoClaw / any MCP client): upload audio, add tracks, set pixel-art icons and a cover, and edit chapters.

- `SKILL.md` — the workflow the agent follows (art generation is a default step of the new-card pipeline)
- `server/` — the Yoto MCP server (Node/TypeScript)
- `art/` — pixel-art generator: `make.mjs` (Science-Yuck card), `make-ouz.mjs` (template for a new card), Rubik font
- `tools/yoto-chapters.mjs` — list / remove / rename chapters on an existing card

## Before you start: register your own Yoto client ID

`server/src/index.ts` ships with a `CLIENT_ID` constant. **Replace it with your own** before you use this: go to https://yoto.dev, create an app, and copy its client ID.

```ts
const CLIENT_ID = "your_client_id_here";
```

The ID committed here belongs to this repo author's own registered app. It is a public
PKCE client ID, so there is no secret in it to leak — but every install that keeps it
shares a single app registration, and therefore shares its rate limits. Registering your
own takes a minute and is free.

## Credits

The server is based on [bperkinspdx/yoto-mcp-server](https://github.com/bperkinspdx/yoto-mcp-server)
(declared MIT in its `package.json`; the upstream repo ships no LICENSE file), with changes:
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
{ "mcpServers": { "yoto": { "command": "node", "args": ["/abs/path/to/server/dist/index.js"] } } }
```

or `claude mcp add yoto -- node /abs/path/to/server/dist/index.js`.

**NanoClaw (this skill's home):**

```bash
ncl groups config add-mcp-server --name yoto --command node \
  --args '["/workspace/agent/yoto-mcp-server/dist/index.js"]'
ncl groups restart      # needs admin approval; config changes apply after restart
```

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
cd art && npm install                       # sharp
# edit fonts.conf: set <dir> to the absolute path of ./fonts
FONTCONFIG_FILE=$PWD/fonts.conf node make-ouz.mjs ./out   # writes icon-*.png, cover.png, sheet.png
```

Icons must be 16x16 PNG, cover ~638x1011 portrait. Apply with the `yoto-set-card-art` tool. To make art for a new card, copy `make-ouz.mjs`, replace the `ICONS` grids (palette chars at the top of the file) and the cover SVG text/composition.

## 5. Chapter tools

```bash
node tools/yoto-chapters.mjs <cardId> list
node tools/yoto-chapters.mjs <cardId> remove 8
node tools/yoto-chapters.mjs <cardId> rename 1 "New title"
```
