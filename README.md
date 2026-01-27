# Slima MCP

[![npm version](https://badge.fury.io/js/slima-mcp.svg)](https://www.npmjs.com/package/slima-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP (Model Context Protocol) Server for [Slima](https://slima.ai) - AI Writing IDE for Novel Authors.

Connect your Slima books to **any MCP-compatible AI tool** - one server, all platforms.

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Claude Desktop | ✅ | Native MCP support |
| ChatGPT Desktop | ✅ | Developer Mode (2025.10+) |
| Gemini CLI | ✅ | Native MCP support |
| Cursor | ✅ | Native MCP support |
| VS Code | ✅ | Via MCP extensions |

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

### 1. Install

```bash
npm install -g slima-mcp
```

Or run directly with npx:

```bash
npx slima-mcp
```

### 2. Get Your API Token

```bash
slima-mcp auth
```

This will open your browser to authenticate with Slima. Your token will be saved automatically.

**Or manually:**
1. Go to [Slima Settings](https://app.slima.ai/settings/api-tokens)
2. Click "Generate API Token"
3. Copy the token

### 3. Configure Your AI Tool

If you used `slima-mcp auth`, the token is saved automatically. Just add:

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["-y", "slima-mcp"]
    }
  }
}
```

That's it! No environment variables needed.

#### Cursor

Add to Cursor's MCP configuration:

```json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["-y", "slima-mcp"]
    }
  }
}
```

#### Gemini CLI

```bash
gemini mcp add slima --command "npx -y slima-mcp"
```

<details>
<summary>Alternative: Using environment variables</summary>

If you prefer to use environment variables instead of `slima-mcp auth`:

```json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["-y", "slima-mcp"],
      "env": {
        "SLIMA_API_TOKEN": "slima_your_token_here"
      }
    }
  }
}
```

Get your token from [Slima Settings](https://app.slima.ai/settings/api-tokens).

</details>

### 4. Restart Your AI Tool

After saving the configuration, restart the application to load Slima MCP.

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

```bash
# Clone the repository
git clone https://github.com/slima-ai/slima-mcp.git
cd slima-mcp

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

## Security

- API tokens are stored locally and never shared
- All communication with Slima API uses HTTPS
- Tokens can be revoked anytime from Slima settings

## License

MIT

## Links

- [Slima Website](https://slima.ai)
- [Slima App](https://app.slima.ai)
- [MCP Documentation](https://modelcontextprotocol.io)
- [Report Issues](https://github.com/slima-ai/slima-mcp/issues)
