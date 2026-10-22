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

Or install it as a Gemini CLI extension (it asks for your API token once and keeps it in the system keychain):

```bash
gemini extensions install https://github.com/slima-ai/slima-mcp
```

> **Why `slima-mcp@0` instead of `slima-mcp` / `slima-mcp@latest`?** Using `@0` pins to the current major version — npx fetches new `0.x.y` releases automatically (so you get features + bug fixes), but when we ship `1.0.0` with breaking changes you won't silently pick it up without updating your config. We'll announce the `@1` switch in the release notes.
>
> ⚠️ **This only holds if you do not also have a global `slima-mcp` install.** `npx pkg@<range>`
> will happily satisfy the range from a package already on your `PATH` and never contact the
> registry at all. Measured on 2026-09-09 with a global `0.2.0` present and `0.3.0` on npm:
>
> | command | resolved |
> |---|---|
> | `npx -y slima-mcp@0` | **0.2.0** — used the global install |
> | `npx -y slima-mcp` | **0.2.0** — same |
> | `npx -y slima-mcp@latest` | 0.3.0 — a dist-tag forces a registry lookup |
> | `npx -y slima-mcp@0.3.0` | 0.3.0 — the global can't satisfy an exact newer version |
>
> So a stale global install makes the npx form silently stop upgrading, while the server keeps
> telling you to upgrade. Remove it — see below.

#### Migrating from a global install

If you already installed globally with `npm install -g slima-mcp`:

```bash
# Remove the old global install — REQUIRED, not just tidiness.
# Leaving it in place makes `npx -y slima-mcp@0` resolve to the old global copy
# forever (see the warning above), so you'd stay outdated while being told to upgrade.
npm uninstall -g slima-mcp

# Then change your config `command` from "slima-mcp" to the npx form above, and restart the client.
# Verify: `npx -y slima-mcp@0 --version` must print the version shown by `npm view slima-mcp version`.
```

⚠️ Check **every** place you may have installed it. A global install can exist per Node version
manager environment and per OS — on WSL setups it is common to have one under `nvm` *and* one
under Windows' `AppData/Roaming/npm`, at two different versions, with only one of them on the
`PATH` your MCP client actually uses.

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

39 tools. **R** = read-only (never changes your book); **W** = changes something and says so in its description. Reads and writes are always separate tools.

### Start here (teaching)

| Tool | R/W | Description |
|------|-----|-------------|
| `get_capabilities` | R | What this server supports: writable file types, content types, tools, guides |
| `list_guides` | R | List the Slima guides and when to load each |
| `load_guide` | R | Load one guide in full |
| `list_writing_skills` | R | List the writing craft procedures (develop a character, revise a scene, ...) |
| `load_writing_skill` | R | Load one writing skill in full |

### Book Management

| Tool | R/W | Description |
|------|-----|-------------|
| `create_book` | W | Create a new Writing Studio book in your library |
| `list_books` | R | List the books in your library (paginated) |
| `get_book` | R | Get details of a specific book |
| `get_book_structure` | R | Get the file/folder structure of a book |
| `get_writing_stats` | R | Get word-count totals for a book |

### File Operations

| Tool | R/W | Description |
|------|-----|-------------|
| `read_file` | R | Read the content of any file by path |
| `get_chapter` | R | Read a chapter by path or file name |
| `edit_file` | W | Replace a specific text segment (search and replace) |
| `write_file` | W | Replace the entire content of an existing file |
| `create_file` | W | Create a new file in a book |
| `delete_file` | W | Delete a file or an empty folder |
| `append_to_file` | W | Append content to the end of a file |
| `search_content` | R | Search for text across all files |
| `semantic_search` | R | Find passages by meaning rather than exact words |

Every write is a commit in the book's version history, so it can be reviewed and reverted.

### Structured Files (one field at a time)

| Tool | R/W | Description |
|------|-----|-------------|
| `view_relationship_map` | R | See a `.map` relationship graph as a picture plus a readable summary |
| `update_relationship_map` | W | Change a relationship map (`.map`) |
| `update_beat_board` | W | Change a beat board (`.beats`) |
| `update_timeline` | W | Change a timeline (`.timeline`) |
| `update_script` | W | Change a screenplay (`.script`) |
| `update_world_map` | W | Change a world map (`.geomap`) |

### Notes and Comments

| Tool | R/W | Description |
|------|-----|-------------|
| `list_notes` | R | The author's margin notes on a book |
| `create_note` | W | Leave a note beside the manuscript (does not touch the prose) |
| `list_comments` | R | Editorial comment threads, open and resolved |
| `create_comment` | W | Leave an editorial comment |
| `resolve_comment` | W | Mark a comment thread addressed |
| `reopen_comment` | W | Reopen a resolved comment thread |

### AI Beta Reader

| Tool | R/W | Description |
|------|-----|-------------|
| `list_personas` | R | List the virtual reader personas |
| `analyze_chapter` | W | Run AI Beta Reader feedback on a chapter from one persona (spends the author's credits) |
| `get_reader_test` | R | Collect a Beta Reader report that was still running |

### Teams

| Tool | R/W | Description |
|------|-----|-------------|
| `list_teams` | R | List the teams this account belongs to |
| `get_team` | R | One team: its members and roles |
| `list_team_rules` | R | The team's coaching rules (house style) |
| `list_team_memories` | R | What the team has established: recurring characters, naming conventions, decisions |
| `list_team_skills` | R | The team's own writing procedures |

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

# Deploy to the test environment (test-mcp.slima.ai)
npm run deploy:worker:test
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

**Worker deployment is separate from npm, and nothing triggers it automatically.**
Publishing to npm does NOT update `mcp.slima.ai`. Remote clients (claude.ai /
ChatGPT connectors) talk to the Worker, so they keep running the old tool set
until someone runs this by hand:

```bash
npm run deploy:worker:test   # Test  (test-mcp.slima.ai -> test-api.slima.ai)
npm run deploy:worker        # Prod  (mcp.slima.ai      -> api.slima.ai)
```

Deploy test first and check `curl https://test-mcp.slima.ai/ | jq .version`
before doing prod; the same one-liner against `mcp.slima.ai` is how you tell
whether the Worker is behind npm at all.

> 2026-09-09: the Worker sat on 0.2.0 for four and a half months — it was last
> deployed the same day npm 0.2.0 shipped, so every change after that reached
> npm users and no connector users. There is no alarm for this; the version
> endpoint is the only signal.

> There used to be a `deploy:worker:preview` script pointing at an `[env.preview]`
> block. It was removed on 2026-09-09: its KV id was the literal placeholder
> string, `staging-api.slima.ai` does not resolve, and — worst — it defined no
> `routes`. `routes` is an *inheritable* key in wrangler, so that command would
> have inherited the top-level `mcp.slima.ai` custom domain and pointed
> **production's hostname** at the preview Worker. The real staging environment
> is `[env.test]`.

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
