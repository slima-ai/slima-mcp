# MCP 最佳做法整合計畫

> 日期：2026-01-29
> 狀態：Phase 1 已完成 ✅
> 優先級：P0 - 核心架構優化

---

## 目標

整合 Cloudflare 官方最佳做法，確保 Slima MCP Server 能正確支援所有 MCP 客戶端：
- Claude Code CLI (stdio)
- Claude.ai (Remote HTTP)
- ChatGPT (Remote HTTP)
- Cursor, Windsurf 等本地應用 (stdio)

---

## 參考資源

| 資源 | 用途 |
|------|------|
| [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/) | 官方指南 |
| [Cloudflare Authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/) | OAuth 整合 |
| [workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider) | OAuth Provider Library |
| [createMcpHandler API](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/) | Stateless MCP Handler |
| [MCP Transport Specification](https://spec.modelcontextprotocol.io/) | 協議規範 |

---

## 架構概覽

```
┌────────────────────────────────────────────────────────────────────┐
│                         MCP Clients                                 │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐       ┌─────────────────────────────────┐│
│  │   Local Clients     │       │      Remote Clients              ││
│  │                     │       │                                   ││
│  │  • Claude Code CLI  │       │  • Claude.ai                     ││
│  │  • Claude Desktop   │       │  • ChatGPT                       ││
│  │  • Cursor           │       │  • MCP Inspector                 ││
│  │  • Windsurf         │       │                                   ││
│  └──────────┬──────────┘       └──────────────┬────────────────────┘│
│             │                                  │                     │
│         stdio                          Streamable HTTP              │
│             │                                  │                     │
└─────────────┼──────────────────────────────────┼─────────────────────┘
              │                                  │
     ┌────────▼────────┐            ┌────────────▼────────────┐
     │  slima-mcp CLI  │            │  Cloudflare Worker      │
     │  (npm package)  │            │  (mcp.slima.ai)         │
     │                 │            │                         │
     │  Token from:    │            │  ┌───────────────────┐  │
     │  ~/.slima/      │            │  │ workers-oauth-    │  │
     │  credentials    │            │  │ provider          │  │
     │                 │            │  │                   │  │
     │  Transport:     │            │  │ + OAuthProvider   │  │
     │  StdioServer    │            │  │ + createMcpHandler│  │
     └────────┬────────┘            │  └───────────────────┘  │
              │                     │            ↓            │
              │                     │  ┌───────────────────┐  │
              │                     │  │ MCP Handler       │  │
              │                     │  │                   │  │
              │                     │  │ - handleMcpRequest│  │
              │                     │  │ - tools/list      │  │
              │                     │  │ - tools/call      │  │
              │                     │  └───────────────────┘  │
              │                     └────────────┬────────────┘
              │                                  │
     ┌────────▼──────────────────────────────────▼────────────┐
     │              共用核心 (core/)                            │
     │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐         │
     │  │  Tools  │  │   API   │  │     Utils       │         │
     │  │ 15 個   │  │  Client │  │   Formatters    │         │
     │  └─────────┘  └─────────┘  └─────────────────┘         │
     └─────────────────────────┬──────────────────────────────┘
                               │
                         HTTPS (REST API)
                               │
                ┌──────────────▼──────────────┐
                │      Slima Rails API        │
                │      (api.slima.ai)         │
                ├─────────────────────────────┤
                │  OAuth Provider (RFC 6749)  │
                │  - /api/v1/oauth/authorize  │
                │  - /api/v1/oauth/token      │
                │  - /api/v1/oauth/register   │
                │                             │
                │  CLI Auth (簡化流程)         │
                │  - /api/v1/auth/cli         │
                │                             │
                │  既有 API                   │
                │  - Books, Files, Commits    │
                │  - MCP Files API            │
                └─────────────────────────────┘
```

---

## 兩種認證流程

### 1. CLI 認證 (本地應用)

```
User → slima-mcp auth
         ↓
   開啟瀏覽器到 Rails /api/v1/auth/cli
         ↓
   使用者登入 (Google OAuth)
         ↓
   Rails 產生 API Token
         ↓
   Callback 到 localhost:8765/callback
         ↓
   Token 儲存到 ~/.slima/credentials
         ↓
   完成! MCP Server 使用該 token
```

### 2. Remote 認證 (Claude.ai, ChatGPT)

```
MCP Client (Claude.ai) 連接到 mcp.slima.ai/mcp
         ↓
Worker 返回 401 + WWW-Authenticate header
         ↓
Client 查詢 /.well-known/oauth-protected-resource
         ↓
Client 查詢 Rails /.well-known/oauth-authorization-server
         ↓
Client 執行 OAuth 2.0 + PKCE 流程
         ↓
   workers-oauth-provider 自動處理:
   1. 產生 code_verifier/challenge
   2. 重定向到 Rails authorize
   3. 接收 callback
   4. 用 code 交換 token
   5. 加密儲存到 KV
         ↓
完成! 後續請求自動附帶 token
```

---

## 技術選擇

### 採用 Cloudflare 推薦方案

| 元件 | 當前做法 | 最佳做法 | 理由 |
|------|----------|----------|------|
| OAuth 處理 | 自訂 oauth.ts | `workers-oauth-provider` | 自動處理加密、規範合規 |
| MCP Transport | `WebStandardStreamableHTTPServerTransport` | 保持不變 | 已符合規範 |
| Token 儲存 | 手動 KV put/get | `workers-oauth-provider` 自動管理 | 更安全的加密儲存 |
| DCR | 手動 proxy | `workers-oauth-provider` 內建 | 自動支援 RFC 7591 |

### 保持不變的部分

| 元件 | 說明 |
|------|------|
| CLI 認證流程 | 使用簡化的 `/api/v1/auth/cli` 端點 |
| Rails OAuth Provider | 繼續作為 OAuth 伺服器 |
| 共用核心 (core/) | API Client, Tools, Utils |
| stdio Transport | CLI 繼續使用 `StdioServerTransport` |

---

## 實作步驟

### Phase 1: 安裝與設定 workers-oauth-provider ✅ 完成

**目標**: 替換自訂 OAuth client 為 Cloudflare 官方 library

**完成內容**:
- ✅ 安裝 `@cloudflare/workers-oauth-provider`
- ✅ 重寫 `src/worker/index.ts` 使用 OAuthProvider wrapper
- ✅ 建立 `src/worker/oauth-handler.ts` 整合 Rails OAuth
- ✅ 更新 `tsup.worker.config.ts` 處理 `cloudflare:workers` external
- ✅ 所有 142 個測試通過
- ✅ Worker 成功建置 (397.79 KB)
- ✅ CLI 功能正常運作

#### 1.1 安裝依賴

```bash
npm install workers-oauth-provider
```

#### 1.2 更新 Worker 入口

**檔案**: `src/worker/index.ts`

```typescript
import OAuthProvider from 'workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp'; // 或使用現有 mcp-handler
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from '../core/tools/index.js';
import SlimaOAuthHandler from './oauth-handler.js';

// Create MCP Server and register tools
function createMcpServer(apiClient: SlimaApiClient) {
  const server = new McpServer({
    name: 'slima',
    version: '0.1.0',
  });

  registerBookTools(server, apiClient);
  registerContentTools(server, apiClient);
  registerBetaReaderTools(server, apiClient, console);
  registerFileTools(server, apiClient);

  return server;
}

// Export with OAuthProvider wrapper
export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: async (request: Request, env: Env, ctx: ExecutionContext, authContext) => {
    // authContext.accessToken 由 workers-oauth-provider 自動提供
    const client = new SlimaApiClient({
      baseUrl: env.SLIMA_API_URL,
      getToken: async () => authContext.accessToken,
      logger: console,
    });

    const server = createMcpServer(client);
    // 使用現有的 handleMcpRequest 或 createMcpHandler
    return handleMcpRequest(request, server);
  },
  defaultHandler: SlimaOAuthHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
```

#### 1.3 建立 OAuth Handler

**檔案**: `src/worker/oauth-handler.ts`

```typescript
import { OAuthHelpers } from 'workers-oauth-provider';

interface Env {
  SLIMA_API_URL: string;
  OAUTH_KV: KVNamespace;
}

// 整合 Rails OAuth Provider
export default class SlimaOAuthHandler {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // 代理 authorize 請求到 Rails
    if (url.pathname === '/authorize') {
      const railsUrl = new URL(`${env.SLIMA_API_URL}/api/v1/oauth/authorize`);
      // 複製所有 query params
      url.searchParams.forEach((value, key) => {
        railsUrl.searchParams.set(key, value);
      });
      return Response.redirect(railsUrl.toString(), 302);
    }

    // 代理 token 請求到 Rails
    if (url.pathname === '/token' && request.method === 'POST') {
      const body = await request.text();
      const response = await fetch(`${env.SLIMA_API_URL}/api/v1/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      return response;
    }

    // 代理 register (DCR) 請求到 Rails
    if (url.pathname === '/register' && request.method === 'POST') {
      const body = await request.json();
      const response = await fetch(`${env.SLIMA_API_URL}/api/v1/oauth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return response;
    }

    return new Response('Not Found', { status: 404 });
  }
}
```

### Phase 2: 更新測試

#### 2.1 CLI 測試

確保 CLI 認證和執行流程正常運作。

```typescript
// tests/cli/auth.test.ts
describe('CLI Authentication', () => {
  it('should start local server and wait for callback');
  it('should save token to credentials file');
  it('should load existing token');
  it('should delete token on logout');
});

// tests/cli/server.test.ts
describe('CLI MCP Server', () => {
  it('should create MCP server with token');
  it('should register all 15 tools');
  it('should connect via stdio transport');
});
```

#### 2.2 Worker 測試

```typescript
// tests/worker/oauth.test.ts
describe('Worker OAuth Flow', () => {
  it('should return 401 with WWW-Authenticate for unauthenticated requests');
  it('should redirect to Rails authorize endpoint');
  it('should proxy token exchange to Rails');
  it('should proxy DCR to Rails');
});

// tests/worker/mcp.test.ts
describe('Worker MCP Protocol', () => {
  it('should handle initialize request');
  it('should list all tools');
  it('should call tools with auth context');
  it('should return proper errors for invalid requests');
});
```

### Phase 3: 整合測試

```typescript
// tests/integration/e2e.test.ts
describe('End-to-End MCP Flow', () => {
  describe('CLI Flow', () => {
    it('should complete full auth → list_books flow');
  });

  describe('Remote Flow', () => {
    it('should complete OAuth → initialize → tools/list flow');
  });
});
```

---

## Well-Known 端點

### 由 Worker 提供 (RFC 9728)

```
GET /.well-known/oauth-protected-resource
→ {
    "resource": "https://mcp.slima.ai",
    "authorization_servers": ["https://api.slima.ai"],
    "scopes_supported": ["read", "write"]
  }
```

### 由 Rails 提供 (RFC 8414)

```
GET /.well-known/oauth-authorization-server
→ {
    "issuer": "https://api.slima.ai",
    "authorization_endpoint": "https://api.slima.ai/api/v1/oauth/authorize",
    "token_endpoint": "https://api.slima.ai/api/v1/oauth/token",
    "registration_endpoint": "https://api.slima.ai/api/v1/oauth/register",
    ...
  }
```

---

## 驗收標準

### 功能性

- [ ] CLI `slima-mcp auth` 正常運作
- [ ] CLI `slima-mcp` 啟動 MCP Server 正常
- [ ] Claude.ai 可連接並授權
- [ ] ChatGPT 可連接並授權 (如支援)
- [ ] 所有 15 個 tools 可正常調用

### 測試涵蓋率

- [ ] CLI 認證測試
- [ ] CLI MCP Server 測試
- [ ] Worker OAuth 測試
- [ ] Worker MCP 測試
- [ ] 整合測試 (E2E)

### 規範合規

- [ ] RFC 9728 (OAuth Protected Resource)
- [ ] RFC 8414 (OAuth Authorization Server Metadata)
- [ ] RFC 7591 (Dynamic Client Registration)
- [ ] MCP Streamable HTTP Transport

---

## 變更記錄

| 版本 | 日期 | 變更 |
|------|------|------|
| 1.0 | 2026-01-29 | 初版 - 根據 Cloudflare 最佳做法規劃 |
| 1.1 | 2026-01-29 | Phase 1 完成 - workers-oauth-provider 整合完成 |
