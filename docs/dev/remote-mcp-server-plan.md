# Remote MCP Server 開發計畫

> 讓 Claude.ai、ChatGPT 網頁版等平台可以透過 HTTP 連接 Slima MCP Server

## 背景

### 問題

目前的 `slima-mcp` npm package 使用 **stdio transport**，只能給本地應用使用：
- Claude Desktop ✅
- Claude Code ✅
- Cursor ✅
- Gemini CLI ✅

但無法給網頁版 AI 使用：
- Claude.ai ❌（需要 HTTP/SSE）
- ChatGPT 網頁版 ❌（需要 HTTP/SSE）

### 目標

在同一個 Repository 中，新增 **Remote MCP Server** 支援，部署到 Cloudflare Workers。

---

## 技術研究結論

### 1. Transport 標準

| Transport | 狀態 | 用途 |
|-----------|------|------|
| **stdio** | 穩定 | 本地應用（Claude Desktop 等） |
| **SSE** | 已棄用 | 舊版遠端 MCP（2025-03 前） |
| **Streamable HTTP** | 推薦 | 新版遠端 MCP（2025-03 後） |

> MCP 在 2025-03-26 正式棄用 SSE，改用 Streamable HTTP 作為遠端標準。

### 2. 平台選擇：Cloudflare Workers

**優點：**
- 全球邊緣部署，無冷啟動
- 免費方案足夠：100,000 requests/day
- 官方提供 MCP 模板和 SDK

**限制：**
- CPU 時間限制：10ms (免費) / 50ms (付費)
- 部分 Node.js API 不可用（需要適配）

### 3. 認證方案

| 方案 | 優點 | 缺點 | 階段 |
|------|------|------|------|
| **API Token** | 實作簡單、重用現有機制 | 用戶需手動設定 | Phase 1 ⭐ |
| **OAuth** | 最佳用戶體驗 | 需要 Slima 成為 OAuth Provider | Phase 3（未來） |

**決策：先用 API Token，未來再加 OAuth**

現有的 `slima-mcp auth` 已經可以產生 API Token，用戶只需要：
1. 執行 `slima-mcp auth` 或從 Slima 設定頁取得 Token
2. 在 Claude.ai 連接 MCP 時輸入 Token
3. 完成！

---

## 架構設計

### 單一 Repository，共用核心邏輯

```
slima-mcp/                        # 現有 Repository
├── src/
│   ├── core/                     # 🆕 共用核心模組
│   │   ├── api/
│   │   │   ├── client.ts         # Slima API Client（平台無關）
│   │   │   └── types.ts          # API 類型定義
│   │   ├── tools/
│   │   │   ├── index.ts          # 工具註冊函數
│   │   │   ├── books.ts          # 書籍工具邏輯
│   │   │   ├── files.ts          # 檔案工具邏輯
│   │   │   └── beta-reader.ts    # Beta Reader 工具邏輯
│   │   └── utils/
│   │       ├── errors.ts         # 錯誤類別
│   │       └── formatters.ts     # 回應格式化
│   │
│   ├── cli/                      # 🔄 重構：stdio 入口
│   │   ├── index.ts              # CLI 主程式
│   │   ├── auth.ts               # 認證命令
│   │   └── server.ts             # MCP Server (stdio)
│   │
│   └── worker/                   # 🆕 Cloudflare Worker 入口
│       ├── index.ts              # Worker 主程式
│       └── auth.ts               # Token 驗證
│
├── package.json                  # npm package 設定
├── wrangler.toml                 # 🆕 Cloudflare Worker 設定
├── tsup.config.ts                # 建置設定（雙 target）
└── README.md
```

### 系統架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│                         用戶端                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐              ┌─────────────────────────┐  │
│  │  本地應用        │              │  網頁版 AI              │  │
│  │  Claude Desktop │              │  Claude.ai / ChatGPT   │  │
│  │  Cursor         │              │                         │  │
│  │  Claude Code    │              │                         │  │
│  └────────┬────────┘              └────────────┬────────────┘  │
│           │                                    │                │
│       stdio                           HTTPS (Streamable HTTP)   │
│           │                                    │                │
│  ┌────────▼────────┐              ┌────────────▼────────────┐  │
│  │  slima-mcp      │              │  slima-mcp (Worker)     │  │
│  │  (npm package)  │              │  Cloudflare Workers     │  │
│  │                 │              │                         │  │
│  │  ┌───────────┐  │              │  ┌───────────────────┐  │  │
│  │  │ CLI Entry │  │              │  │  Worker Entry     │  │  │
│  │  │ (stdio)   │  │              │  │  (HTTP)           │  │  │
│  │  └─────┬─────┘  │              │  └─────────┬─────────┘  │  │
│  │        │        │              │            │            │  │
│  │  ┌─────▼─────────────────────────────────────▼─────┐     │  │
│  │  │              共用核心 (core/)                    │     │  │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │     │  │
│  │  │  │  Tools  │  │   API   │  │     Utils       │ │     │  │
│  │  │  │ 定義    │  │  Client │  │   Formatters    │ │     │  │
│  │  │  └─────────┘  └─────────┘  └─────────────────┘ │     │  │
│  │  └─────────────────────┬───────────────────────────┘     │  │
│  │                        │                                 │  │
│  └────────────────────────┼─────────────────────────────────┘  │
│                           │                                    │
└───────────────────────────┼────────────────────────────────────┘
                            │
                      HTTPS (REST API)
                            │
                 ┌──────────▼──────────┐
                 │   Slima Rails API   │
                 │   (api.slima.ai)    │
                 └─────────────────────┘
```

### 程式碼共用策略

```typescript
// src/core/tools/books.ts - 純粹的工具邏輯（平台無關）
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatBooksResponse } from '../utils/formatters.js';

export function registerBookTools(server: McpServer, client: SlimaApiClient) {
  server.tool(
    'list_books',
    'List all books in your Slima library',
    {},
    async () => {
      const books = await client.listBooks();
      return {
        content: [{ type: 'text', text: formatBooksResponse(books) }],
      };
    }
  );

  server.tool(
    'create_book',
    'Create a new book',
    { title: z.string(), author_name: z.string().optional() },
    async ({ title, author_name }) => {
      const book = await client.createBook({ title, authorName: author_name });
      return {
        content: [{ type: 'text', text: `Book created: ${book.token}` }],
      };
    }
  );

  // ... 其他工具
}

// src/core/tools/index.ts - 統一註冊所有工具
export function registerAllTools(server: McpServer, client: SlimaApiClient) {
  registerBookTools(server, client);
  registerFileTools(server, client);
  registerBetaReaderTools(server, client);
}
```

```typescript
// src/cli/server.ts - stdio 版本
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SlimaApiClient } from '../core/api/client.js';
import { registerAllTools } from '../core/tools/index.js';

export async function startServer(config: { token: string; baseUrl: string }) {
  const server = new McpServer({ name: 'slima', version: __VERSION__ });
  const client = new SlimaApiClient(config);

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

```typescript
// src/worker/index.ts - Cloudflare Worker 版本
import { McpAgent } from '@cloudflare/agents';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../core/api/client.js';
import { registerAllTools } from '../core/tools/index.js';

interface Env {
  SLIMA_API_URL: string;
}

export class SlimaMcpWorker extends McpAgent<Env> {
  server = new McpServer({ name: 'slima', version: '1.0.0' });

  async init() {
    // 從請求 header 取得用戶的 API Token
    const token = this.request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new Error('Missing API token');
    }

    const client = new SlimaApiClient({
      baseUrl: this.env.SLIMA_API_URL,
      token,
    });

    registerAllTools(this.server, client);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === '/mcp') {
      return SlimaMcpWorker.handle(request, env);
    }

    return new Response('Slima MCP Server. Connect via /mcp endpoint.', {
      status: 200,
    });
  },
};
```

---

## 開發階段

### Phase 0: 重構現有程式碼結構

**目標：** 將現有程式碼拆分為 core + cli 結構

**任務：**
1. 建立 `src/core/` 目錄結構
2. 將 API Client 移到 `src/core/api/`
3. 將工具邏輯抽取到 `src/core/tools/`
4. 將 CLI 相關程式碼移到 `src/cli/`
5. 確保現有測試通過

**產出：**
- 重構後的程式碼結構
- 所有測試通過
- npm package 功能不變

**預估：** 0.5 天

---

### Phase 1: 新增 Cloudflare Worker 支援

**目標：** 實作 HTTP transport，部署到 Cloudflare Workers

**任務：**
1. 建立 `src/worker/` 目錄
2. 實作 Worker 入口（使用共用的 core）
3. 新增 `wrangler.toml` 設定
4. 更新建置設定（tsup 雙 target）
5. 部署並測試

**認證方式（Phase 1）：**
- 用戶在 Claude.ai 連接時提供 API Token
- Worker 從 Authorization header 取得 Token
- 使用此 Token 呼叫 Slima API

**產出：**
- 可部署的 Cloudflare Worker
- `https://slima-mcp.xxx.workers.dev/mcp`
- 所有 14 個工具可用

**預估：** 1 天

---

### Phase 2: 整合測試與文件

**目標：** 確保穩定性，更新文件

**任務：**
1. 新增 Worker 相關測試
2. 更新 README（新增 Remote MCP 使用說明）
3. 錯誤處理優化
4. 新增使用範例

**產出：**
- 完整測試覆蓋
- 更新後的文件

**預估：** 0.5 天

---

### Phase 3（未來）: OAuth 整合

**目標：** 提升用戶體驗，實作 OAuth 認證

**任務：**
1. Slima Rails 實作 OAuth Provider
2. Worker 實作 OAuth Client
3. 新增 Cloudflare KV 儲存 token

**此階段暫不實作，待 Phase 1-2 穩定後再評估需求。**

---

## 里程碑

| 階段 | 目標 | 預估時間 | 完成標準 |
|------|------|----------|----------|
| Phase 0 | 重構程式碼結構 | 0.5 天 | 測試通過、npm package 正常 |
| Phase 1 | Worker 基礎功能 | 1 天 | 能從 Claude.ai 連接並使用所有工具 |
| Phase 2 | 測試與文件 | 0.5 天 | 文件完整、測試覆蓋 |

**總計：** 2 天

---

## 建置與部署

### package.json scripts

```json
{
  "scripts": {
    "build": "tsup",
    "build:cli": "tsup --config tsup.cli.config.ts",
    "build:worker": "tsup --config tsup.worker.config.ts",
    "dev": "tsup --watch",
    "dev:worker": "wrangler dev",
    "deploy:worker": "wrangler deploy",
    "test": "vitest",
    "start": "node dist/cli/index.js"
  }
}
```

### wrangler.toml

```toml
name = "slima-mcp"
main = "dist/worker/index.js"
compatibility_date = "2025-01-01"

[vars]
SLIMA_API_URL = "https://api.slima.ai"
```

### 部署流程

```bash
# 開發
npm run dev:worker          # 本地測試 Worker

# 部署
npm run build:worker        # 建置 Worker
npm run deploy:worker       # 部署到 Cloudflare

# 部署後 URL
# https://slima-mcp.{account}.workers.dev/mcp
```

---

## 用戶使用流程

### 本地應用（現有流程，不變）

```bash
# 1. 安裝並認證
npx slima-mcp auth

# 2. 設定 Claude Desktop
# ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "slima": {
      "command": "npx",
      "args": ["-y", "slima-mcp"]
    }
  }
}

# 3. 重啟 Claude Desktop
```

### 網頁版（新流程）

```bash
# 1. 取得 API Token（二選一）
npx slima-mcp auth     # 會顯示 token
# 或從 https://app.slima.ai/settings/api-tokens 取得

# 2. 在 Claude.ai 連接 MCP
# Settings → Connectors → Add custom connector
# URL: https://slima-mcp.xxx.workers.dev/mcp
# Authorization: Bearer slima_your_token_here

# 3. 完成！
```

---

## 決策記錄

| 決策 | 選項 | 選擇 | 理由 |
|------|------|------|------|
| 專案架構 | 分開 Repo / 單一 Repo | **單一 Repo** | 共用程式碼、統一維護 |
| 平台 | Cloudflare / Vercel / 自建 | **Cloudflare Workers** | 官方 MCP 支援、免費額度高 |
| Transport | SSE / Streamable HTTP | **Streamable HTTP** | 新標準、SSE 已棄用 |
| 認證（Phase 1） | OAuth / API Token | **API Token** | 簡單、重用現有機制 |
| 認證（未來） | - | OAuth | 最佳用戶體驗 |

---

## 相關資源

- [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [MCP Transports Documentation](https://modelcontextprotocol.io/docs/concepts/transports)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [Why MCP Deprecated SSE](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/)

---

## 風險與緩解

| 風險 | 影響 | 緩解措施 |
|------|------|----------|
| Cloudflare Workers 環境限制 | 部分 Node.js API 不可用 | 使用 polyfill 或改寫 |
| API Token 洩漏 | 安全風險 | 提醒用戶不要分享 token、支援 token 撤銷 |
| 雙 transport 維護成本 | 開發時間增加 | 共用核心邏輯、統一測試 |
