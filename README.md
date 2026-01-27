# Slima MCP

MCP (Model Context Protocol) Server for [Slima](https://slima.app) - AI Writing IDE for Novel Authors.

Connect Slima to **any MCP-compatible AI tool** - one server, all platforms.

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Claude Desktop | ✅ | Native MCP support |
| ChatGPT Desktop | ✅ | Developer Mode (2025.10+) |
| Gemini CLI | ✅ | Native MCP support |
| Cursor | ✅ | Native MCP support |
| Clawdbot | ✅ | Via Skills system |
| VS Code | ✅ | Via MCP extensions |

> MCP became the industry standard in December 2025 when Anthropic, OpenAI, and Block co-founded the Agentic AI Foundation under the Linux Foundation.

## Features

- **Book Management**: List and view your books
- **Content Access**: Read chapters and view file structures
- **AI Beta Reader**: Get feedback from virtual reader personas
- **Writing Stats**: Track your writing progress

## Installation

```bash
npm install -g slima-mcp
```

Or run directly with npx:

```bash
npx slima-mcp
```

## Configuration

### 1. Get Your API Token

1. Go to [Slima Settings](https://app.slima.app/settings/api)
2. Click "Generate API Token"
3. Copy the token (it starts with `slima_`)

### 2. Configure Your AI Tool

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

#### ChatGPT (Developer Mode)

1. Open ChatGPT Settings → Connectors → Advanced → Developer Mode
2. Add MCP Server with endpoint configuration
3. Set `SLIMA_API_TOKEN` in environment

#### Gemini CLI

```bash
gemini mcp add slima --command "npx -y slima-mcp" --env SLIMA_API_TOKEN=slima_your_token
```

#### Cursor

Add to Cursor's MCP configuration:

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

### 3. Restart Your AI Tool

After saving the configuration, restart the application to load Slima MCP.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_books` | List all books in your Slima library |
| `get_book` | Get details of a specific book |
| `get_book_structure` | Get the file/folder structure of a book |
| `get_chapter` | Read the content of a chapter |
| `get_writing_stats` | Get writing statistics for a book |
| `list_personas` | List available beta reader personas |
| `analyze_chapter` | Get AI beta reader feedback on a chapter |

## Usage Examples

Once configured, you can ask your AI:

- "List my books in Slima"
- "Show me the structure of my novel"
- "Read chapter 3 of my book"
- "What are my writing stats?"
- "Get feedback on chapter 5 from a young female reader"

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLIMA_API_TOKEN` | Yes | - | Your Slima API token |
| `SLIMA_API_URL` | No | `https://api.slima.app` | API endpoint (for development) |
| `DEBUG` | No | `false` | Enable debug logging |

## Development

```bash
# Clone the repository
git clone https://github.com/slima-app/slima-mcp.git
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

## License

MIT

## Links

- [Slima Website](https://slima.app)
- [MCP Documentation](https://modelcontextprotocol.io)
- [Report Issues](https://github.com/slima-app/slima-mcp/issues)
