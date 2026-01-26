# Slima MCP Server

MCP (Model Context Protocol) Server for [Slima](https://slima.app) - AI Writing IDE for Novel Authors.

Connect Slima to any MCP-compatible AI tool like Claude Desktop, Cursor, or Clawdbot.

## Features

- **Book Management**: List and view your books
- **Content Access**: Read chapters and view file structures
- **AI Beta Reader**: Get feedback from virtual reader personas
- **Writing Stats**: Track your writing progress

## Installation

```bash
npm install -g slima-mcp-server
```

Or run directly with npx:

```bash
npx slima-mcp-server
```

## Configuration

### 1. Get Your API Token

1. Go to [Slima Settings](https://app.slima.app/settings/api)
2. Click "Generate API Token"
3. Copy the token (it starts with `slima_`)

### 2. Configure Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["slima-mcp-server"],
      "env": {
        "SLIMA_API_TOKEN": "slima_your_token_here"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

After saving the configuration, restart Claude Desktop to load the Slima MCP Server.

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

Once configured, you can ask Claude:

- "List my books in Slima"
- "Show me the structure of my novel"
- "Read chapter 3 of my book"
- "What are my writing stats for this month?"
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
git clone https://github.com/slima-app/slima-mcp-server.git
cd slima-mcp-server

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

## Testing Locally

```bash
# Set your API token
export SLIMA_API_TOKEN="slima_your_token"

# Run the server
npm start
```

## License

MIT

## Links

- [Slima Website](https://slima.app)
- [MCP Documentation](https://modelcontextprotocol.io)
- [Report Issues](https://github.com/slima-app/slima-mcp-server/issues)
