# yoto skill

Create Yoto MYO cards from an agent (Claude Code / NanoClaw / any MCP client): upload audio, add tracks, set pixel-art icons and a cover, and edit chapters.

- `SKILL.md` — the workflow the agent follows (art generation is a default step of the new-card pipeline)
- `server/` — the Yoto MCP server (Node/TypeScript)
- `art/` — pixel-art generator: `make.mjs` (Science-Yuck card), `make-ouz.mjs` (template for a new card), Rubik font
- `tools/yoto-chapters.mjs` — list / remove / rename chapters on an existing card

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
