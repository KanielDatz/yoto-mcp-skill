#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { readFile, writeFile } from "fs/promises";
import { randomBytes, createHash } from "crypto";

// Configuration
// homedir() is NOT persisted across container restarts — keep the config
// under the workspace mount instead, or re-auth is required every restart.
const CONFIG_PATH = process.env.YOTO_CONFIG_PATH || new URL("../.yoto-mcp-config.json", import.meta.url).pathname;
const CLIENT_ID = "tpc_4Y7pJYhDPNKe6bnG98nQQg";
const AUTH_SERVER = "https://login.yotoplay.com";
const API_SERVER = "https://api.yotoplay.com";
// Yoto deprecated the device_code flow for self-registered apps in favor of
// PKCE + loopback redirect (OAuth 2.1 native app flow). We have no listener
// reachable from the user's own browser, so instead of running a local
// callback server we ask the user to paste the "code" query param from the
// (intentionally failing) redirect URL back to us.
const REDIRECT_URI = "http://127.0.0.1:8787/callback";
const SCOPE = "openid profile offline_access user:content:manage family:library:view";

interface YotoConfig {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

// Load/save configuration
async function loadConfig(): Promise<YotoConfig> {
  try {
    const data = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(config: YotoConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Yoto API Authentication
async function authenticate(): Promise<string> {
  const config = await loadConfig();

  // Check if we have a valid token
  if (config.accessToken && config.expiresAt && config.expiresAt > Date.now()) {
    return config.accessToken;
  }

  // Try to refresh
  if (config.refreshToken) {
    try {
      const response = await fetch(`${AUTH_SERVER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: config.refreshToken,
          client_id: CLIENT_ID,
        }),
      });

      if (response.ok) {
        const data: any = await response.json();
        const newConfig = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || config.refreshToken,
          expiresAt: Date.now() + data.expires_in * 1000,
        };
        await saveConfig(newConfig);
        return data.access_token;
      }
    } catch (error) {
      console.error("Token refresh failed:", error);
    }
  }

  throw new Error("Authentication required. Please run yoto-auth tool first.");
}

// Yoto API: Authorization Code + PKCE flow (native/loopback app)
interface PendingAuth {
  code_verifier: string;
  state: string;
}

let pendingAuth: PendingAuth | null = null;

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildAuthorizeUrl(): { url: string; code_verifier: string; state: string } {
  const code_verifier = base64url(randomBytes(32));
  const code_challenge = base64url(createHash("sha256").update(code_verifier).digest());
  const state = base64url(randomBytes(16));

  const authUrl = new URL(`${AUTH_SERVER}/authorize`);
  authUrl.search = new URLSearchParams({
    audience: "https://api.yotoplay.com",
    scope: SCOPE,
    response_type: "code",
    client_id: CLIENT_ID,
    code_challenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    state,
  }).toString();

  return { url: authUrl.toString(), code_verifier, state };
}

async function exchangeCodeForToken(code: string, code_verifier: string): Promise<YotoConfig> {
  const tokenResponse = await fetch(`${AUTH_SERVER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code_verifier,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
  }

  const tokenData: any = await tokenResponse.json();
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  };
}

// Yoto API: Upload and transcode audio
async function uploadAndTranscodeAudio(
  audioFilePath: string,
  accessToken: string
): Promise<any> {
  const uploadUrlResponse = await fetch(
    `${API_SERVER}/media/transcode/audio/uploadUrl`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  const uploadData: any = await uploadUrlResponse.json();
  const { uploadUrl, uploadId } = uploadData.upload;

  const audioBuffer = await readFile(audioFilePath);
  await fetch(uploadUrl, {
    method: "PUT",
    body: audioBuffer,
    headers: { "Content-Type": "audio/mpeg" },
  });

  let transcodedAudio: any = null;
  let attempts = 0;
  const maxAttempts = 200;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const transcodeResponse = await fetch(
      `${API_SERVER}/media/upload/${uploadId}/transcoded?loudnorm=false`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (transcodeResponse.ok) {
      const data: any = await transcodeResponse.json();
      if (data.transcode.transcodedSha256) {
        transcodedAudio = data.transcode;
        break;
      }
    }
    attempts++;
  }

  if (!transcodedAudio) {
    throw new Error("Transcoding timed out");
  }

  return transcodedAudio;
}

// Yoto API: Upload audio and create card
async function uploadAudioToYoto(
  audioFilePath: string,
  title: string
): Promise<{ cardId: string; title: string }> {
  const accessToken = await authenticate();
  const transcodedAudio = await uploadAndTranscodeAudio(audioFilePath, accessToken);
  const mediaInfo = transcodedAudio.transcodedInfo;

  const content = {
    title,
    content: {
      chapters: [
        {
          key: "01",
          title,
          overlayLabel: "1",
          tracks: [
            {
              key: "01",
              title,
              trackUrl: `yoto:#${transcodedAudio.transcodedSha256}`,
              duration: mediaInfo.duration,
              fileSize: mediaInfo.fileSize,
              channels: mediaInfo.channels,
              format: mediaInfo.format,
              type: "audio",
              overlayLabel: "1",
              display: {
                icon16x16: "yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q",
              },
            },
          ],
          display: {
            icon16x16: "yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q",
          },
        },
      ],
    },
    metadata: {
      media: {
        duration: mediaInfo.duration,
        fileSize: mediaInfo.fileSize,
        readableFileSize: Math.round((mediaInfo.fileSize / 1024 / 1024) * 10) / 10,
      },
    },
  };

  const createResponse = await fetch(`${API_SERVER}/content`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(content),
  });

  if (!createResponse.ok) {
    throw new Error(`Failed to create card: ${await createResponse.text()}`);
  }

  const result: any = await createResponse.json();
  return {
    cardId: result.card.cardId,
    title: result.card.title,
  };
}

// Yoto API: List cards
async function listCards(): Promise<any[]> {
  const accessToken = await authenticate();
  
  const response = await fetch(`${API_SERVER}/content/mine`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list cards: ${await response.text()}`);
  }

  const data: any = await response.json();
  return data.cards || [];
}

// Yoto API: Get card details
async function getCard(cardId: string): Promise<any> {
  const accessToken = await authenticate();
  
  const response = await fetch(`${API_SERVER}/content/${cardId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get card: ${await response.text()}`);
  }

  const data: any = await response.json();
  return data.card;
}

// Yoto API: Add track to existing card
async function addTrackToCard(
  cardId: string,
  audioFilePath: string,
  trackTitle: string
): Promise<{ cardId: string; title: string }> {
  const accessToken = await authenticate();
  const card = await getCard(cardId);
  
  const transcodedAudio = await uploadAndTranscodeAudio(audioFilePath, accessToken);
  const mediaInfo = transcodedAudio.transcodedInfo;

  const existingChapters = card.content?.chapters || [];
  const nextChapterNum = existingChapters.length + 1;
  const chapterKey = String(nextChapterNum).padStart(2, '0');

  const newTrack = {
    key: chapterKey,
    title: trackTitle,
    trackUrl: `yoto:#${transcodedAudio.transcodedSha256}`,
    duration: mediaInfo.duration,
    fileSize: mediaInfo.fileSize,
    channels: mediaInfo.channels,
    format: mediaInfo.format,
    type: "audio",
    overlayLabel: String(nextChapterNum),
    display: {
      icon16x16: "yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q",
    },
  };

  const updatedChapters = [
    ...existingChapters,
    {
      key: chapterKey,
      title: trackTitle,
      overlayLabel: String(nextChapterNum),
      tracks: [newTrack],
      display: {
        icon16x16: "yoto:#aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q",
      },
    },
  ];

  const updateResponse = await fetch(`${API_SERVER}/content`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cardId,
      title: card.title,
      content: {
        ...card.content,
        chapters: updatedChapters,
      },
    }),
  });

  if (!updateResponse.ok) {
    throw new Error(`Failed to update card: ${await updateResponse.text()}`);
  }

  const result: any = await updateResponse.json();
  return {
    cardId: result.card.cardId,
    title: result.card.title,
  };
}


// Yoto API: Upload a 16x16 PNG display icon, returns the icon reference
async function uploadIcon(imagePath: string, accessToken: string): Promise<string> {
  const body = await readFile(imagePath);
  const response = await fetch(
    `${API_SERVER}/media/displayIcons/user/me/upload?autoConvert=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/png",
        Accept: "application/json",
      },
      body,
    }
  );
  if (!response.ok) {
    throw new Error(`Icon upload failed: ${await response.text()}`);
  }
  const data: any = await response.json();
  const mediaId = data.displayIcon?.mediaId;
  if (!mediaId) throw new Error(`Icon upload returned no mediaId: ${JSON.stringify(data)}`);
  return `yoto:#${mediaId}`;
}

// Yoto API: Upload a cover image, returns its media URL
async function uploadCover(imagePath: string, accessToken: string): Promise<string> {
  const body = await readFile(imagePath);
  const response = await fetch(
    `${API_SERVER}/media/coverImage/user/me/upload?autoconvert=true&coverType=default`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/png",
        Accept: "application/json",
      },
      body,
    }
  );
  if (!response.ok) {
    throw new Error(`Cover upload failed: ${await response.text()}`);
  }
  const data: any = await response.json();
  const url = data.coverImage?.mediaUrl;
  if (!url) throw new Error(`Cover upload returned no mediaUrl: ${JSON.stringify(data)}`);
  return url;
}

// Yoto API: Set cover image and/or per-track icons on an existing card
async function setCardArt(
  cardId: string,
  coverPath: string | undefined,
  icons: { track: number; iconPath: string }[]
): Promise<{ cover: boolean; icons: number }> {
  const accessToken = await authenticate();
  const card = await getCard(cardId);
  const chapters = JSON.parse(JSON.stringify(card.content?.chapters || []));

  let iconCount = 0;
  for (const { track, iconPath } of icons) {
    const chapter = chapters[track - 1];
    if (!chapter) throw new Error(`Card has no track ${track}`);
    const ref = await uploadIcon(iconPath, accessToken);
    chapter.display = { ...chapter.display, icon16x16: ref };
    for (const t of chapter.tracks || []) {
      t.display = { ...t.display, icon16x16: ref };
    }
    iconCount++;
  }

  const metadata = { ...(card.metadata || {}) };
  if (coverPath) {
    const url = await uploadCover(coverPath, accessToken);
    metadata.cover = { ...(metadata.cover || {}), imageL: url };
  }

  const response = await fetch(`${API_SERVER}/content`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cardId,
      title: card.title,
      content: { ...card.content, chapters },
      metadata,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update card art: ${await response.text()}`);
  }
  return { cover: !!coverPath, icons: iconCount };
}

// Create MCP server
const server = new Server(
  {
    name: "yoto-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "yoto-auth",
        description: "Start Yoto authentication (PKCE authorization code flow). Returns a link for the user to open and approve.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "yoto-auth-complete",
        description: "Finish a pending yoto-auth after the user approved the link. The browser will fail to load the redirect (nothing listens on that loopback port) but the resulting URL contains a 'code' query param — pass that code here.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The 'code' query-string value from the failed redirect URL (e.g. http://127.0.0.1:8787/callback?code=THIS_PART&state=...)",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "yoto-upload-audio",
        description: "Upload an audio file to Yoto and create a new MYO card",
        inputSchema: {
          type: "object",
          properties: {
            audioFilePath: {
              type: "string",
              description: "Absolute path to the audio file (MP3)",
            },
            title: {
              type: "string",
              description: "Title for the MYO card",
            },
          },
          required: ["audioFilePath", "title"],
        },
      },
      {
        name: "yoto-add-track",
        description: "Add a track to an existing Yoto MYO card",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID to add the track to",
            },
            audioFilePath: {
              type: "string",
              description: "Absolute path to the audio file (MP3)",
            },
            trackTitle: {
              type: "string",
              description: "Title for the track",
            },
          },
          required: ["cardId", "audioFilePath", "trackTitle"],
        },
      },
      {
        name: "yoto-set-card-art",
        description:
          "Set the cover image and/or per-track 16x16 icons on an existing Yoto card. Images are PNG files; icons must be 16x16, the cover ~638x1011 (portrait).",
        inputSchema: {
          type: "object",
          properties: {
            cardId: { type: "string", description: "The card ID" },
            coverPath: {
              type: "string",
              description: "Absolute path to the cover PNG (optional)",
            },
            icons: {
              type: "array",
              description: "Per-track icons (optional)",
              items: {
                type: "object",
                properties: {
                  track: { type: "number", description: "1-based track number" },
                  iconPath: { type: "string", description: "Absolute path to a 16x16 PNG" },
                },
                required: ["track", "iconPath"],
              },
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "yoto-list-cards",
        description: "List all MYO cards in your Yoto library",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "yoto-get-card",
        description: "Get details of a specific Yoto MYO card",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID to retrieve",
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "yoto-check-auth",
        description: "Check if authenticated with Yoto API",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "yoto-auth": {
        const { url, code_verifier, state } = buildAuthorizeUrl();
        pendingAuth = { code_verifier, state };
        return {
          content: [
            {
              type: "text",
              text: `Visit this link and approve:\n${url}\n\nAfter approving, the browser will try to redirect to ${REDIRECT_URI} and fail to load (nothing is listening there) — that's expected. Copy the "code" value from that failed URL's address bar and call yoto-auth-complete with it.`,
            },
          ],
        };
      }

      case "yoto-auth-complete": {
        if (!pendingAuth) {
          return {
            content: [
              { type: "text", text: "No pending authentication. Run yoto-auth first." },
            ],
          };
        }
        if (!args || typeof args !== "object" || !("code" in args)) {
          throw new Error("Missing required 'code' argument");
        }
        const { code } = args as { code: string };
        const config = await exchangeCodeForToken(code, pendingAuth.code_verifier);
        pendingAuth = null;
        await saveConfig(config);
        return {
          content: [
            { type: "text", text: "✅ Successfully authenticated with Yoto API!" },
          ],
        };
      }

      case "yoto-check-auth": {
        try {
          const config = await loadConfig();
          if (config.accessToken && config.expiresAt && config.expiresAt > Date.now()) {
            return {
              content: [
                {
                  type: "text",
                  text: "✅ Authenticated with Yoto API",
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: "❌ Not authenticated. Please run yoto-auth tool.",
                },
              ],
            };
          }
        } catch {
          return {
            content: [
              {
                type: "text",
                text: "❌ Not authenticated. Please run yoto-auth tool.",
              },
            ],
          };
        }
      }

      case "yoto-list-cards": {
        const cards = await listCards();
        
        if (cards.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No MYO cards found in your library.",
              },
            ],
          };
        }

        const cardsList = cards.map((card: any) => 
          `• ${card.title} (ID: ${card.cardId})`
        ).join("\n");

        return {
          content: [
            {
              type: "text",
              text: `📚 Your MYO Cards:\n\n${cardsList}`,
            },
          ],
        };
      }

      case "yoto-get-card": {
        if (!args || typeof args !== "object") {
          throw new Error("Invalid arguments");
        }

        const { cardId } = args as { cardId: string };
        const card = await getCard(cardId);

        const chapters = card.content?.chapters || [];
        const trackCount = chapters.reduce((sum: number, ch: any) => 
          sum + (ch.tracks?.length || 0), 0
        );

        return {
          content: [
            {
              type: "text",
              text: `📀 Card Details:\n\nTitle: ${card.title}\nCard ID: ${card.cardId}\nChapters: ${chapters.length}\nTracks: ${trackCount}\nCreated: ${new Date(card.createdAt).toLocaleString()}`,
            },
          ],
        };
      }

      case "yoto-set-card-art": {
        if (!args || typeof args !== "object") {
          throw new Error("Invalid arguments");
        }
        const { cardId, coverPath, icons } = args as {
          cardId: string;
          coverPath?: string;
          icons?: { track: number; iconPath: string }[];
        };
        const result = await setCardArt(cardId, coverPath, icons || []);
        return {
          content: [
            {
              type: "text",
              text: `✅ Updated card art on ${cardId}: cover ${result.cover ? "set" : "unchanged"}, ${result.icons} track icon(s) set.`,
            },
          ],
        };
      }

      case "yoto-add-track": {
        if (!args || typeof args !== "object") {
          throw new Error("Invalid arguments");
        }

        const { cardId, audioFilePath, trackTitle } = args as {
          cardId: string;
          audioFilePath: string;
          trackTitle: string;
        };

        const result = await addTrackToCard(cardId, audioFilePath, trackTitle);

        return {
          content: [
            {
              type: "text",
              text: `✅ Successfully added track to card!\n\nCard ID: ${result.cardId}\nCard Title: ${result.title}\nTrack: ${trackTitle}\n\nThe track has been added to your existing MYO card.`,
            },
          ],
        };
      }

      case "yoto-upload-audio": {
        if (!args || typeof args !== "object") {
          throw new Error("Invalid arguments");
        }

        const { audioFilePath, title } = args as {
          audioFilePath: string;
          title: string;
        };

        const result = await uploadAudioToYoto(audioFilePath, title);

        return {
          content: [
            {
              type: "text",
              text: `✅ Successfully uploaded audio to Yoto!\n\nCard ID: ${result.cardId}\nTitle: ${result.title}\n\nYou can now link this card to a physical MYO card using your Yoto app or player.`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Yoto MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
