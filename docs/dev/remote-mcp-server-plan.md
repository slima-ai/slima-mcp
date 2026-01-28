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

建立 **Remote MCP Server**，部署到 Cloudflare Workers，讓網頁版 AI 也能連接。

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
- 內建 OAuth 支援（`workers-oauth-provider`）
- 免費方案足夠：100,000 requests/day
- 官方提供 MCP 模板和 SDK

**限制：**
- CPU 時間限制：10ms (免費) / 50ms (付費)
- 需要使用 Cloudflare 的 KV/D1/R2 做儲存

### 3. 認證方案

由於每個用戶有自己的書籍，需要認證機制：

| 方案 | 優點 | 缺點 | 推薦 |
|------|------|------|------|
| **OAuth** | 用戶體驗好、安全 | 需要 Slima 成為 OAuth Provider | ⭐ 推薦 |
| **API Token** | 實作簡單 | 用戶需手動設定 token | 備選 |
| **無認證** | 最簡單 | 不適用（數據隔離需求） | ❌ |

---

## 架構設計

### 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         用戶端                                    │
├─────────────────────────────────────────────────────────────────┤
│  Claude.ai          ChatGPT Web         其他 MCP Client          │
│      │                   │                    │                  │
│      └───────────────────┴────────────────────┘                  │
│                          │                                       │
│                    HTTPS (Streamable HTTP)                       │
│                          │                                       │
├─────────────────────────────────────────────────────────────────┤
│                   Cloudflare Workers                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              slima-mcp-worker                            │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │    │
│  │  │  OAuth   │  │   MCP    │  │   Slima API Client   │   │    │
│  │  │ Handler  │  │  Agent   │  │                      │   │    │
│  │  └──────────┘  └──────────┘  └──────────────────────┘   │    │
│  │       │              │                   │              │    │
│  │       └──────────────┴───────────────────┘              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
├─────────────────────────────────────────────────────────────────┤
│                    Cloudflare KV                                 │
│              (OAuth Token Storage)                               │
└─────────────────────────────────────────────────────────────────┘
                           │
                     HTTPS (REST API)
                           │
┌─────────────────────────────────────────────────────────────────┐
│                      Slima Rails API                             │
│                    (api.slima.ai)                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  OAuth       │  │  MCP Files   │  │  Books / Commits     │   │
│  │  Provider    │  │  API         │  │  API                 │   │
│  │  (新增)      │  │  (已完成)    │  │  (已完成)            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 專案結構

```
slima-mcp-worker/
├── src/
│   ├── index.ts              # Worker 入口 + 路由
│   ├── mcp-server.ts         # MCP Server 定義
│   ├── tools/
│   │   ├── index.ts          # 工具註冊
│   │   ├── books.ts          # 書籍相關工具
│   │   ├── files.ts          # 檔案操作工具
│   │   └── beta-reader.ts    # AI Beta Reader 工具
│   ├── api/
│   │   ├── client.ts         # Slima API Client
│   │   └── types.ts          # API 類型定義
│   ├── auth/
│   │   ├── oauth-handler.ts  # OAuth 處理
│   │   └── slima-provider.ts # Slima OAuth Provider 整合
│   └── utils/
│       ├── errors.ts         # 錯誤處理
│       └── logger.ts         # 日誌
├── wrangler.toml             # Cloudflare 設定
├── package.json
├── tsconfig.json
└── README.md
```

---

## 開發階段

### Phase 0: 準備工作

**目標：** 驗證技術可行性

**任務：**
1. 建立 Cloudflare Workers 專案
2. 部署最簡單的 MCP Server（無認證、單一 tool）
3. 測試從 Claude.ai 連接

**產出：**
- 可連接的 `https://slima-mcp.xxx.workers.dev/mcp`
- 驗證 Streamable HTTP transport 運作正常

**預估：** 0.5 天

---

### Phase 1: 基礎 MCP Server

**目標：** 實作所有 MCP Tools（使用 API Token 認證）

**任務：**
1. 移植 `slima-mcp` 的工具定義
2. 實作 Slima API Client（Cloudflare Workers 版）
3. 使用環境變數設定 API Token（先跳過 OAuth）
4. 部署並測試所有工具

**工具清單：**
| 工具 | 描述 |
|------|------|
| `list_books` | 列出所有書籍 |
| `get_book` | 取得書籍詳情 |
| `create_book` | 建立新書籍 |
| `get_book_structure` | 取得檔案結構 |
| `get_writing_stats` | 取得寫作統計 |
| `read_file` | 讀取檔案內容 |
| `write_file` | 覆寫檔案內容 |
| `edit_file` | 編輯檔案（搜尋取代） |
| `create_file` | 建立新檔案 |
| `delete_file` | 刪除檔案 |
| `append_to_file` | 附加內容到檔案 |
| `search_content` | 搜尋檔案內容 |
| `list_personas` | 列出 Beta Reader 角色 |
| `analyze_chapter` | 取得 AI 試讀回饋 |

**產出：**
- 完整功能的 Remote MCP Server
- 可用自己的 API Token 測試

**預估：** 1 天

---

### Phase 2: OAuth 整合（Slima 成為 OAuth Provider）

**目標：** 讓用戶可以透過 Slima 帳號授權

#### 2.1 Rails 端：實作 OAuth Provider

**新增 endpoints：**

```ruby
# config/routes.rb
namespace :oauth do
  get  :authorize  # 授權頁面
  post :authorize  # 授權確認
  post :token      # Token 交換
  get  :userinfo   # 用戶資訊
end
```

**流程：**
```
1. Client (Worker) 將用戶導向 /oauth/authorize?client_id=...&redirect_uri=...
2. 用戶在 Slima 登入並授權
3. Slima 導回 redirect_uri?code=...
4. Client 用 code 換取 access_token (POST /oauth/token)
5. Client 用 access_token 呼叫 API
```

**資料模型：**
```ruby
# OAuth Application（MCP Worker 註冊）
class OauthApplication < ApplicationRecord
  has_many :access_tokens

  # client_id, client_secret, redirect_uris, scopes
end

# Access Token
class OauthAccessToken < ApplicationRecord
  belongs_to :user
  belongs_to :oauth_application

  # token, refresh_token, expires_at, scopes
end
```

#### 2.2 Worker 端：OAuth Client

使用 `workers-oauth-provider` 整合：

```typescript
import { OAuthProvider } from 'workers-oauth-provider';

const slimaOAuth = new OAuthProvider({
  authorizationEndpoint: 'https://api.slima.ai/oauth/authorize',
  tokenEndpoint: 'https://api.slima.ai/oauth/token',
  clientId: env.SLIMA_CLIENT_ID,
  clientSecret: env.SLIMA_CLIENT_SECRET,
  redirectUri: 'https://slima-mcp.xxx.workers.dev/callback',
  scopes: ['read', 'write'],
});
```

**產出：**
- Slima 成為標準 OAuth 2.0 Provider
- 用戶可透過瀏覽器授權 MCP Server

**預估：** 2-3 天

---

### Phase 3: 生產環境優化

**目標：** 準備上線

**任務：**
1. 錯誤處理與 logging
2. Rate limiting
3. 監控與 alerting
4. 文件更新

**產出：**
- 生產就緒的 Remote MCP Server
- 用戶文件

**預估：** 1 天

---

## 里程碑

| 階段 | 目標 | 預估時間 | 完成標準 |
|------|------|----------|----------|
| Phase 0 | 技術驗證 | 0.5 天 | 能從 Claude.ai 連接到 Worker |
| Phase 1 | 基礎功能 | 1 天 | 所有工具可用（API Token） |
| Phase 2 | OAuth 整合 | 2-3 天 | 用戶可透過 Slima 帳號授權 |
| Phase 3 | 生產優化 | 1 天 | 正式上線 |

**總計：** 4.5-5.5 天

---

## 替代方案

### 方案 B：純 API Token（跳過 OAuth）

如果 OAuth 太複雜，可以先用簡化版：

1. 用戶在 Slima 設定頁面產生 API Token
2. 用戶在 Claude.ai 設定 MCP 連接時輸入 Token
3. Worker 使用此 Token 呼叫 API

**優點：** 實作簡單、快速上線
**缺點：** 用戶體驗較差、Token 管理麻煩

### 方案 C：使用 mcp-remote 橋接

使用 `mcp-remote` 將現有 stdio server 暴露為 HTTP：

```bash
npx mcp-remote --stdio "npx slima-mcp" --port 3000
```

**優點：** 零程式碼修改
**缺點：** 需要額外運行一個 process、認證問題未解決

---

## 決策記錄

| 決策 | 選項 | 選擇 | 理由 |
|------|------|------|------|
| 平台 | Cloudflare Workers / Vercel / 自建 | Cloudflare Workers | 官方 MCP 支援、邊緣部署、免費額度高 |
| Transport | SSE / Streamable HTTP | Streamable HTTP | 新標準、更穩定 |
| 認證 | OAuth / API Token / 無 | OAuth（Phase 2） | 最佳用戶體驗 |
| 程式碼共用 | 共用 / 分開 | 分開專案 | Worker 環境限制多、避免複雜度 |

---

## 相關資源

- [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [MCP Transports Documentation](https://modelcontextprotocol.io/docs/concepts/transports)
- [workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)

---

## 附錄：程式碼範例

### Worker 入口 (src/index.ts)

```typescript
import { McpAgent } from "cloudflare:agents";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class SlimaMcpServer extends McpAgent<Env> {
  server = new McpServer({
    name: "slima",
    version: "1.0.0",
  });

  async init() {
    // 取得用戶的 access token（OAuth 認證後）
    const accessToken = this.props.accessToken;

    // 初始化 API Client
    const client = new SlimaApiClient({
      baseUrl: this.env.SLIMA_API_URL,
      token: accessToken,
    });

    // 註冊工具
    this.server.tool(
      "list_books",
      "List all books in your Slima library",
      {},
      async () => {
        const books = await client.listBooks();
        return {
          content: [{
            type: "text",
            text: formatBooksResponse(books),
          }],
        };
      }
    );

    // ... 其他工具
  }
}

export default {
  async fetch(request: Request, env: Env) {
    // 路由處理
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return SlimaMcpServer.handle(request, env);
    }

    if (url.pathname === "/oauth/callback") {
      return handleOAuthCallback(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

### wrangler.toml

```toml
name = "slima-mcp-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
SLIMA_API_URL = "https://api.slima.ai"

[[kv_namespaces]]
binding = "OAUTH_KV"
id = "xxx"

# 敏感資訊用 secrets
# wrangler secret put SLIMA_CLIENT_ID
# wrangler secret put SLIMA_CLIENT_SECRET
```
