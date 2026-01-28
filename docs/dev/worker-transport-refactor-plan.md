# Worker Transport 重構計畫

> 日期：2026-01-29
> 狀態：✅ 完成
> 優先級：P0 - 阻斷性問題修復

---

## 問題根源

### 現有問題

1. **手動 JSON-RPC 處理** - 繞過 MCP SDK transport 機制
2. **存取私有屬性** - 使用 `_registeredTools` hack
3. **缺少整合測試** - 只有 unit tests，沒有驗證完整 MCP 協議
4. **不符合 MCP 規範** - Streamable HTTP transport 實作不完整

### 錯誤的程式碼

```typescript
// ❌ 錯誤：手動處理 JSON-RPC
if (method === 'tools/list') {
  const registeredTools = (server as any)._registeredTools;
  // ...
}
```

### 正確的做法

```typescript
// ✅ 正確：使用 SDK transport
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

await server.connect(transport);
return transport.handleRequest(request);
```

---

## 技術規格

### 使用的 SDK

| 套件 | 版本 | 用途 |
|------|------|------|
| `@modelcontextprotocol/sdk` | ^1.12.0 | MCP 核心 SDK |
| `WebStandardStreamableHTTPServerTransport` | (內建) | Cloudflare Workers 相容 transport |

### 架構設計

```
┌─────────────────────────────────────────────────────────────┐
│                    Hono App (index.ts)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │ OAuth Routes │    │      MCP Transport Handler        │  │
│  │ /auth/*      │    │                                    │  │
│  │ /callback    │    │  ┌────────────────────────────┐  │  │
│  └──────────────┘    │  │ WebStandardStreamable      │  │  │
│                      │  │ HTTPServerTransport        │  │  │
│  ┌──────────────┐    │  │                            │  │  │
│  │ Well-Known   │    │  │ - handleRequest(req)       │  │  │
│  │ /.well-known │    │  │ - session management       │  │  │
│  └──────────────┘    │  │ - JSON-RPC handling        │  │  │
│                      │  └────────────────────────────┘  │  │
│  ┌──────────────┐    │              ↓                    │  │
│  │ requireAuth  │───►│  ┌────────────────────────────┐  │  │
│  │ middleware   │    │  │      McpServer              │  │  │
│  └──────────────┘    │  │                            │  │  │
│                      │  │  - registerTools()          │  │  │
│                      │  │  - server.connect(transport)│  │  │
│                      │  └────────────────────────────┘  │  │
│                      └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Session 管理

使用 **Stateless 模式**（無 session），因為：
1. Cloudflare Workers 無狀態
2. 每個 request 獨立處理
3. 認證透過 Bearer token

```typescript
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless mode
});
```

### 認證整合

```typescript
// 透過 HandleRequestOptions 傳遞認證資訊
const response = await transport.handleRequest(request, {
  authInfo: {
    token: apiToken,
    clientId: 'slima-mcp',
    scopes: ['read', 'write'],
  },
});
```

---

## 實作步驟

### Step 1: 建立 MCP Handler 模組

**檔案**: `src/worker/mcp-handler.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SlimaApiClient, Logger } from '../core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from '../core/tools/index.js';

export interface McpHandlerOptions {
  apiUrl: string;
  getToken: () => Promise<string>;
  logger: Logger;
}

export async function handleMcpRequest(
  request: Request,
  options: McpHandlerOptions
): Promise<Response> {
  const { apiUrl, getToken, logger } = options;

  // Create API client
  const client = new SlimaApiClient({
    baseUrl: apiUrl,
    getToken,
    logger,
  });

  // Create MCP server
  const server = new McpServer({
    name: 'slima',
    version: '0.1.0',
  });

  // Register all tools
  registerBookTools(server, client);
  registerContentTools(server, client);
  registerBetaReaderTools(server, client, logger);
  registerFileTools(server, client);

  // Create transport (stateless mode)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Connect server to transport
  await server.connect(transport);

  // Handle the request
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
  }
}
```

### Step 2: 更新 Worker 入口

**檔案**: `src/worker/index.ts`

```typescript
import { Hono, Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { createOAuthRoutes, getTokenFromSession, Env } from './oauth.js';
import { handleMcpRequest } from './mcp-handler.js';

const VERSION = '0.1.0';

const workerLogger = { /* ... */ };

// Authentication middleware
async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = await getTokenFromSession(c);
  if (!token) {
    const baseUrl = new URL(c.req.url).origin;
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Authentication required' },
        id: null,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
        },
      }
    );
  }
  c.set('apiToken', token);
  await next();
}

const app = new Hono<{ Bindings: Env; Variables: { apiToken: string } }>();

// CORS and OAuth routes
app.use('/mcp/*', cors({ /* ... */ }));
createOAuthRoutes(app);

// MCP endpoint - using SDK transport
app.all('/mcp', requireAuth, async (c) => {
  const token = c.get('apiToken');

  return handleMcpRequest(c.req.raw, {
    apiUrl: c.env.SLIMA_API_URL,
    getToken: async () => token,
    logger: workerLogger,
  });
});

// Well-known endpoints...
// ...

export default app;
```

### Step 3: 新增整合測試

**檔案**: `tests/worker/mcp-integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

describe('MCP Integration Tests', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/worker/index.ts', {
      experimental: { disableExperimentalWarning: true },
      vars: {
        SLIMA_API_URL: 'https://api.slima.ai',
        OAUTH_CLIENT_ID: 'test-client',
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  describe('Authentication', () => {
    it('returns 401 with WWW-Authenticate header when no token', async () => {
      const response = await worker.fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata');
    });
  });

  describe('MCP Protocol', () => {
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer slima_test_token_for_integration',
    };

    it('handles initialize request', async () => {
      const response = await worker.fetch('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          },
          id: 1,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result.serverInfo.name).toBe('slima');
    });

    it('handles tools/list request', async () => {
      const response = await worker.fetch('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 2,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result.tools).toBeInstanceOf(Array);
      expect(data.result.tools.length).toBeGreaterThan(0);

      // Verify tool structure
      const tool = data.result.tools[0];
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    });

    it('handles tools/call request', async () => {
      const response = await worker.fetch('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'list_books',
            arguments: {},
          },
          id: 3,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should return content array (even if empty or error)
      expect(data.result).toHaveProperty('content');
    });

    it('returns error for unknown tool', async () => {
      const response = await worker.fetch('/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
          id: 4,
        }),
      });

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32602); // Invalid params
    });
  });

  describe('Well-Known Endpoints', () => {
    it('returns OAuth protected resource metadata', async () => {
      const response = await worker.fetch('/.well-known/oauth-protected-resource');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authorization_servers).toContain('https://api.slima.ai');
    });

    it('returns OAuth authorization server metadata', async () => {
      const response = await worker.fetch('/.well-known/oauth-authorization-server');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authorization_endpoint).toContain('/oauth/authorize');
      expect(data.token_endpoint).toContain('/oauth/token');
    });
  });
});
```

---

## BDD 測試規格

### Model: McpHandler

```
描述: MCP Handler 模組

  描述: handleMcpRequest

    情境: 收到 initialize 請求
      Given 一個有效的 Bearer token
      When 發送 initialize JSON-RPC 請求
      Then 應回傳 serverInfo 包含 name 和 version
      And 應回傳 capabilities 物件

    情境: 收到 tools/list 請求
      Given 一個有效的 Bearer token
      When 發送 tools/list JSON-RPC 請求
      Then 應回傳所有已註冊的 tools
      And 每個 tool 應有 name, description, inputSchema
      And tools 數量應 >= 14

    情境: 收到 tools/call 請求
      Given 一個有效的 Bearer token
      And 一個存在的 tool name
      When 發送 tools/call JSON-RPC 請求
      Then 應執行對應的 tool handler
      And 應回傳 content array

    情境: 收到無效的 tool name
      Given 一個有效的 Bearer token
      When 發送 tools/call 帶有不存在的 tool name
      Then 應回傳 JSON-RPC error
      And error code 應為 -32602
```

### Integration: Worker Endpoints

```
描述: Worker 端點整合測試

  描述: 認證

    情境: 無 token 存取 /mcp
      When 發送請求到 /mcp 不帶 Authorization header
      Then 應回傳 401
      And 應包含 WWW-Authenticate header
      And header 應指向 oauth-protected-resource

    情境: 無效 token 存取 /mcp
      When 發送請求到 /mcp 帶有無效 token
      Then 應回傳 401

    情境: 有效 token 存取 /mcp
      When 發送請求到 /mcp 帶有有效 Bearer token
      Then 應正常處理 MCP 請求

  描述: MCP 協議

    情境: 完整 MCP 對話流程
      Given 一個有效的 Bearer token
      When 發送 initialize 請求
      And 發送 tools/list 請求
      And 發送 tools/call 請求調用 list_books
      Then 所有請求都應成功
      And 回應格式應符合 MCP 規範

    情境: 錯誤處理
      When 發送無效的 JSON
      Then 應回傳 JSON-RPC parse error (-32700)

      When 發送未知的 method
      Then 應回傳 method not found error (-32601)

  描述: CORS

    情境: 跨域請求
      When 發送帶有 Origin header 的請求
      Then 應回傳適當的 CORS headers
```

---

## 驗收標準

1. **功能性**
   - [x] `initialize` 請求正確回應
   - [x] `tools/list` 回傳所有 15 tools 並有完整 schema
   - [x] `tools/call` 正確執行 tool 並回傳結果
   - [x] 認證失敗回傳正確的 401 + WWW-Authenticate

2. **測試涵蓋率**
   - [x] 整合測試涵蓋所有 MCP endpoints (9 tests)
   - [x] Unit tests 涵蓋 mcp-handler 模組
   - [ ] OAuth 流程端到端測試

3. **相容性**
   - [ ] Claude.ai 可以成功連接並使用
   - [ ] ChatGPT 可以成功連接（如支援）
   - [x] 本地 npm 版本維持向後相容

## 實作記錄

### 關鍵修復

1. **Transport 選項**: 使用 `enableJsonResponse: true` 讓 Worker 回傳 JSON 而非 SSE 串流
2. **Headers 設定**: 測試中需使用 `new Headers()` 建構子確保 headers 正確設定
3. **Accept Header**: MCP SDK 要求同時包含 `application/json` 和 `text/event-stream`

---

## 時間估計

| 步驟 | 時間 |
|------|------|
| 建立 mcp-handler.ts | 30 分鐘 |
| 更新 index.ts | 15 分鐘 |
| 整合測試 | 45 分鐘 |
| 部署與驗證 | 30 分鐘 |
| **總計** | **2 小時** |

---

## 參考資料

- [MCP SDK WebStandardStreamableHTTPServerTransport](https://github.com/modelcontextprotocol/typescript-sdk)
- [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [MCP Transport Specification](https://spec.modelcontextprotocol.io/)

---

## 變更記錄

| 版本 | 日期 | 變更 |
|------|------|------|
| 1.0 | 2026-01-29 | 初版 |
| 1.1 | 2026-01-29 | 完成實作，所有測試通過 (142 tests) |
