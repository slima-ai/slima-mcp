# Slima MCP

[![npm version](https://badge.fury.io/js/slima-mcp.svg)](https://www.npmjs.com/package/slima-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP (Model Context Protocol) Server for [Slima](https://slima.ai) - AI Writing IDE for Novel Authors.

Connect your Slima books to **any MCP-compatible AI tool** - one server, all platforms.

## Supported Platforms

### Desktop Applications (Local MCP - stdio)

| Platform | Status | Notes |
|----------|--------|-------|
| Claude Desktop | ✅ | Native MCP support |
| ChatGPT Desktop | ✅ | Developer Mode (2025.10+) |
| Gemini CLI | ✅ | Native MCP support |
| Cursor | ✅ | Native MCP support |
| VS Code | ✅ | Via MCP extensions |

### Web Applications (Remote MCP - HTTP)

| Platform | Status | Notes |
|----------|--------|-------|
| Claude.ai | ✅ | OAuth login, no token needed |
| ChatGPT Web | ✅ | OAuth login, no token needed |

> MCP became the industry standard in December 2025 when Anthropic, OpenAI, and Block co-founded the Agentic AI Foundation under the Linux Foundation.

## Features

### Book Management
- **Create** new books
- List and view your books
- Get file/folder structure
- Track writing statistics

### File Operations
- **Read** any file by path
- **Edit** specific text (search & replace)
- **Write** (replace) file content
- **Create** new files
- **Delete** files
- **Append** content to files
- **Search** across all files

### AI Beta Reader
- Get feedback from virtual reader personas
- Analyze chapters with different reader perspectives

## Quick Start

**Pick the path that matches how you use AI:**

- ⭐ Use **claude.ai / ChatGPT in a web browser** → [Recommended: web connector](#recommended-claudeai--chatgpt-web-auto-updating) *(one-time setup, auto-updates forever)*
- Use **Claude Desktop / Cursor / Gemini CLI locally** → [Local install with `npx`](#local-claude-desktop--cursor--gemini-cli)
- Running in air-gapped / enterprise environments → [Self-host](#self-host-advanced)

### Recommended: claude.ai / ChatGPT Web (auto-updating)

If you chat with Claude or ChatGPT in a browser, this is the easiest and most future-proof option. **Configure once and you will automatically get every Slima MCP update** — no upgrade commands, no config edits.

**MCP URL:** `https://mcp.slima.ai/mcp`

#### claude.ai (Pro / Max / Team / Enterprise)

1. Sign in at [claude.ai](https://claude.ai).
2. Open **Settings → Connectors** (or **Integrations** depending on your plan).
3. Click **Add custom connector**.
4. Fill in:
   - **Name:** `Slima`
   - **URL:** `https://mcp.slima.ai/mcp`
5. Click **Connect** → you will be redirected to slima.ai to approve → return to claude.ai.
6. The Slima tools icon appears in your chat input. You're done.

#### ChatGPT (Plus / Pro, Developer Mode)

1. Sign in at [chatgpt.com](https://chatgpt.com).
2. Open **Settings → Connectors → Advanced** and toggle **Developer Mode** on (2025.10+).
3. Back in **Connectors**, click **Create → Custom MCP Server**.
4. Fill in:
   - **Name:** `Slima`
   - **Server URL:** `https://mcp.slima.ai/mcp`
   - **Authentication:** OAuth
5. Click **Create** → approve the OAuth flow.

After setup, Slima features roll out automatically on your next conversation. No restarts, no reinstalls.

---

### Local: Claude Desktop / Cursor / Gemini CLI

Use this if you want offline-friendly operation, faster startup, or you need to run MCP alongside other stdio servers.

**Recommended config** — pinned to the major version so you pick up new features automatically but never break on a `1.0` release:

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["-y", "slima-mcp@0"],
      "env": {
        "SLIMA_API_TOKEN": "slima_your_token_here"
      }
    }
  }
}
```

Get your token from [Slima Settings](https://app.slima.ai/settings/api-tokens) or run `npx slima-mcp@0 auth` once to save it to disk.

#### Cursor

```json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["-y", "slima-mcp@0"],
      "env": {
        "SLIMA_API_TOKEN": "slima_your_token_here"
      }
    }
  }
}
```

#### Gemini CLI

```bash
gemini mcp add slima --command "npx -y slima-mcp@0"
```

> **Why `slima-mcp@0` instead of `slima-mcp` / `slima-mcp@latest`?** Using `@0` pins to the current major version — npx still fetches new `0.x.y` releases automatically (so you get features + bug fixes), but when we ship `1.0.0` with breaking changes you won't silently pick it up without updating your config. We'll announce the `@1` switch in the release notes.

#### Migrating from a global install

If you already installed globally with `npm install -g slima-mcp`:

```bash
# Remove the old global install (optional but cleaner)
npm uninstall -g slima-mcp

# Change your config `command` from "slima-mcp" to the npx form above, and restart the client.
```

Or, if you want to stay on a global install, remember to periodically run:

```bash
npm install -g slima-mcp@latest
```

Otherwise your local client will drift from the MCP tools/schema the Slima backend exposes.

### Self-host (advanced)

You can also clone this repo and deploy the Cloudflare Worker yourself. See `wrangler.toml` + `npm run deploy:worker`. Not required for normal use.

---

## Remote MCP Security

The hosted Remote MCP Server at `https://mcp.slima.ai/mcp` uses:

- **OAuth 2.0 + PKCE** for authentication — no tokens copy-pasted.
- **No secrets stored server-side** — credentials never leave Slima's auth server.
- **Session-based**: OAuth tokens are stored in Cloudflare KV, scoped per session.
- **Revocable anytime** from [Slima Settings](https://app.slima.ai/settings/api-tokens).

---

## Book Types: Writing Studio vs Script Studio

Slima books come in two flavors, distinguished by the `book_type` field. MCP behaves slightly differently for each:

| | 📖 Writing Studio (`book_type: "book"`) | 📝 Script Studio (`book_type: "script"`) |
|---|---|---|
| **Creation via MCP** | ✅ `create_book` works | ❌ use the Slima app UI |
| **Read** (any file) | ✅ | ✅ |
| **Write / Edit / Delete** | ✅ any path | ✅ only under `.script_studio/planning/**/*` |
| Structured files (`series.json`, `*.character`, `*.scene`, `*.storyline`, `*.note`, `*.location`, `season.json`, `episode.json`) | n/a | ❌ read-only via MCP — edits must go through the Script Studio UI |
| `analyze_chapter` (AI Beta Reader) | ✅ | ❌ not yet supported on structured scenes |
| `search_content` | all files | structured files excluded by default; pass `include_structured: true` to include them |

For per-book details, ask your AI client to read the resource `slima://books/{book_token}/schema` — it returns a JSON spec of exactly which paths are writable/read-only for that specific book.

`list_books` tags every book with its studio icon (📝 / 📖) so you (and the AI) can tell them apart at a glance.

---

## Available Tools

### Book Management

| Tool | Description |
|------|-------------|
| `create_book` | Create a new book in your library |
| `list_books` | List all books in your Slima library |
| `get_book` | Get details of a specific book |
| `get_book_structure` | Get the file/folder structure of a book |
| `get_writing_stats` | Get writing statistics for a book |

### File Operations

| Tool | Description |
|------|-------------|
| `read_file` | Read content of any file by path |
| `edit_file` | Edit specific text using search & replace |
| `write_file` | Replace entire content of a file |
| `create_file` | Create a new file in a book |
| `delete_file` | Delete a file from a book |
| `append_to_file` | Append content to end of a file |
| `search_content` | Search for text across all files |

### AI Beta Reader

| Tool | Description |
|------|-------------|
| `list_personas` | List available beta reader personas |
| `analyze_chapter` | Get AI beta reader feedback on a chapter |

## Usage Examples

Once configured, you can ask your AI:

**Book & Content:**
- "Create a new book called 'My Novel'"
- "List my books in Slima"
- "Show me the structure of my novel"
- "Read chapter 3 of my book"
- "What are my writing stats?"

**File Operations:**
- "Read the character profile for my protagonist"
- "Edit chapter 1 and change 'John' to 'James'"
- "Create a new file called worldbuilding.md with notes about the magic system"
- "Search for all mentions of 'blue eyes' in my book"
- "Append this new paragraph to chapter 5"

**AI Feedback:**
- "Get feedback on chapter 5 from a young reader perspective"
- "Analyze my opening scene from a critic's perspective"

## CLI Commands

```bash
slima-mcp auth      # Authenticate with browser (recommended)
slima-mcp status    # Check authentication status
slima-mcp logout    # Remove saved credentials
slima-mcp --help    # Show help
slima-mcp --version # Show version
```

Token is stored in `~/.slima/credentials.json` with secure permissions.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLIMA_API_TOKEN` | No* | - | Your Slima API token |
| `SLIMA_API_URL` | No | `https://api.slima.ai` | API endpoint (for development) |
| `DEBUG` | No | `false` | Enable debug logging |

*Not required if you used `slima-mcp auth`

## Development

### Local CLI Development

```bash
# Clone the repository
git clone https://github.com/slima-ai/slima-mcp.git
cd slima-mcp

# Install dependencies
npm install

# Build CLI
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

### Cloudflare Worker Development

```bash
# Build the Worker
npm run build:worker

# Run Worker locally
npm run dev:worker

# Deploy to Cloudflare
npm run deploy:worker

# Deploy to preview environment
npm run deploy:worker:preview
```

### Project Structure

```
slima-mcp/
├── src/
│   ├── core/           # Shared core modules
│   │   ├── api/        # Slima API Client
│   │   ├── tools/      # MCP Tool implementations
│   │   └── utils/      # Utilities and errors
│   ├── cli/            # CLI entry point (stdio transport)
│   │   ├── index.ts    # CLI main
│   │   ├── auth.ts     # Authentication commands
│   │   └── server.ts   # MCP Server for CLI
│   └── worker/         # Cloudflare Worker (HTTP transport)
│       ├── index.ts    # Worker entry point
│       └── oauth.ts    # OAuth 2.0 + PKCE client
├── wrangler.toml       # Cloudflare Worker config
├── tsup.config.ts      # CLI build config
└── tsup.worker.config.ts # Worker build config
```

## Security

- API tokens are stored locally and never shared
- All communication with Slima API uses HTTPS
- Tokens can be revoked anytime from Slima settings

## Release & Deployment

### npm (Automatic)

Merge to `main` with a version bump in `package.json` triggers automatic npm publish via GitHub Actions.

```bash
# 1. Bump version on dev branch
npm version patch   # 0.1.10 → 0.1.11

# 2. Merge to main
git checkout main && git merge dev && git push

# 3. CI runs tests → publish.yml publishes to npm + creates git tag
```

### Cloudflare Worker (Manual)

Worker deployment is separate from npm. Deploy after code changes:

```bash
npm run deploy:worker           # Production (mcp.slima.ai)
npm run deploy:worker:preview   # Staging
```

### MCP Registry (Manual)

To publish/update the server listing on the [MCP Registry](https://registry.modelcontextprotocol.io/):

```bash
mcp-publisher login github
mcp-publisher publish
```

Requires `mcpName` in `package.json` and `server.json` in repo root.

## Operational Notes

### Debugging Worker OAuth

When troubleshooting claude.ai or ChatGPT connector issues:

```bash
# Live logs from production Worker
wrangler tail slima-mcp
```

All OAuth endpoints log key parameters (client_id, redirect_uri, token prefix, etc.) to help trace the flow.

### Worker OAuth Flow (claude.ai / ChatGPT)

```
Client POST /mcp → 401 + WWW-Authenticate header
  → Client GET /.well-known/oauth-protected-resource
  → Client GET /.well-known/oauth-authorization-server
  → Client POST /register (DCR)
  → Client redirects user to GET /authorize
    → Worker redirects to Rails OAuth
    → User authorizes → Rails redirects to Worker /callback
    → Worker issues auth code → redirects to client callback
  → Client POST /token (exchange code for access_token)
  → Client POST /mcp (Authorization: Bearer {access_token})
```

### Known Constraints

- Worker Bearer token validation accepts all non-empty tokens (not just `slima_` prefix) to support OAuth-issued tokens. Rails API performs actual validation.
- `getTokenFromSession()` checks Authorization header first, then falls back to cookie session.
- MCP Inspector (`npx @modelcontextprotocol/inspector`) is useful for testing the full OAuth flow independently.

## License

MIT

## Links

- [Slima Website](https://slima.ai)
- [Slima App](https://app.slima.ai)
- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [Report Issues](https://github.com/slima-ai/slima-mcp/issues)
