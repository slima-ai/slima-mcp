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

在同一個 Repository 中，新增 **Remote MCP Server** 支援，部署到 Cloudflare Workers，並提供 OAuth 認證讓用戶一鍵授權。

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
- 內建 KV 儲存（用於 OAuth token）

**限制：**
- CPU 時間限制：10ms (免費) / 50ms (付費)
- 部分 Node.js API 不可用（需要適配）

### 3. 認證方案：OAuth 2.0

**用戶體驗：**
```
用戶在 Claude.ai 點擊「連接 Slima」
    ↓
跳轉到 Slima 登入頁（如果尚未登入）
    ↓
顯示授權確認：「允許 Slima MCP 存取你的書籍？」
    ↓
點擊「允許」→ 自動連接完成！
```

**為什麼選擇 OAuth：**
- ✅ 最佳用戶體驗（不需複製貼上 token）
- ✅ 重用現有 ApiToken 模型
- ✅ 重用現有 Google OAuth 登入
- ✅ Cloudflare 有 `workers-oauth-provider` 函式庫

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
│       └── oauth.ts              # OAuth Client 整合
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
└───────────┼────────────────────────────────────┼────────────────┘
            │                                    │
   ┌────────▼────────┐              ┌────────────▼────────────┐
   │  slima-mcp      │              │  slima-mcp (Worker)     │
   │  (npm package)  │              │  Cloudflare Workers     │
   │                 │              │                         │
   │  使用本地 token │              │  OAuth 認證流程         │
   │  ~/.slima/      │              │  ┌───────────────────┐  │
   │  credentials    │              │  │ 1. 導向 Slima 授權│  │
   └────────┬────────┘              │  │ 2. 用戶登入並授權 │  │
            │                       │  │ 3. 取得 token     │  │
            │                       │  │ 4. 儲存到 KV      │  │
            │                       │  └───────────────────┘  │
            │                       └────────────┬────────────┘
            │                                    │
   ┌────────▼────────────────────────────────────▼────────────┐
   │              共用核心 (core/)                              │
   │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐           │
   │  │  Tools  │  │   API   │  │     Utils       │           │
   │  │ 14 個   │  │  Client │  │   Formatters    │           │
   │  └─────────┘  └─────────┘  └─────────────────┘           │
   └─────────────────────────┬────────────────────────────────┘
                             │
                       HTTPS (REST API)
                             │
              ┌──────────────▼──────────────┐
              │      Slima Rails API        │
              │      (api.slima.ai)         │
              ├─────────────────────────────┤
              │  🆕 OAuth Provider          │
              │  - GET  /oauth/authorize    │
              │  - POST /oauth/token        │
              │                             │
              │  既有 API                   │
              │  - Books, Files, Commits    │
              │  - MCP Files API            │
              │  - Bearer Token 認證        │
              └─────────────────────────────┘
```

---

## OAuth 實作細節

### Rails 端：新增 OAuth Provider

#### 1. 資料庫 Migration

```ruby
# db/migrate/xxx_create_oauth_authorization_codes.rb
class CreateOAuthAuthorizationCodes < ActiveRecord::Migration[7.2]
  def change
    create_table :oauth_authorization_codes do |t|
      t.references :user, null: false, foreign_key: true
      t.string :code, null: false, index: { unique: true }
      t.string :client_id, null: false
      t.string :redirect_uri, null: false
      t.string :state
      t.datetime :expires_at, null: false
      t.datetime :used_at  # 防止重複使用
      t.timestamps
    end
  end
end
```

#### 2. Model

```ruby
# app/models/oauth_authorization_code.rb
class OAuthAuthorizationCode < ApplicationRecord
  belongs_to :user

  validates :code, presence: true, uniqueness: true
  validates :client_id, :redirect_uri, :expires_at, presence: true

  before_validation :generate_code, on: :create
  before_validation :set_expiration, on: :create

  scope :valid, -> { where(used_at: nil).where('expires_at > ?', Time.current) }

  def expired?
    expires_at < Time.current
  end

  def used?
    used_at.present?
  end

  def use!
    update!(used_at: Time.current)
  end

  private

  def generate_code
    self.code ||= SecureRandom.urlsafe_base64(32)
  end

  def set_expiration
    self.expires_at ||= 10.minutes.from_now
  end
end
```

#### 3. Controller

```ruby
# app/controllers/oauth_controller.rb
class OAuthController < ApplicationController
  # 允許的 Client（目前只有我們自己的 Worker）
  ALLOWED_CLIENTS = {
    'slima-mcp-worker' => {
      redirect_uri_pattern: %r{\Ahttps://slima-mcp\..*\.workers\.dev/callback\z}
    }
  }.freeze

  before_action :validate_client, only: [:authorize, :confirm]
  before_action :authenticate_user!, only: [:authorize, :confirm]

  # GET /oauth/authorize
  # 顯示授權確認頁面
  def authorize
    # 如果用戶已授權過（有有效的 token），可以自動授權
    # 或顯示確認頁面讓用戶選擇
    @client_id = params[:client_id]
    @redirect_uri = params[:redirect_uri]
    @state = params[:state]
  end

  # POST /oauth/authorize
  # 用戶確認授權
  def confirm
    code = OAuthAuthorizationCode.create!(
      user: current_user,
      client_id: params[:client_id],
      redirect_uri: params[:redirect_uri],
      state: params[:state]
    )

    redirect_uri = URI.parse(params[:redirect_uri])
    redirect_uri.query = URI.encode_www_form(
      code: code.code,
      state: params[:state]
    )

    redirect_to redirect_uri.to_s, allow_other_host: true
  end

  # POST /oauth/token
  # 交換 authorization code 取得 access token
  def token
    code = OAuthAuthorizationCode.valid.find_by(
      code: params[:code],
      client_id: params[:client_id]
    )

    if code.nil?
      render json: { error: 'invalid_grant', error_description: 'Invalid or expired code' },
             status: :bad_request
      return
    end

    # 標記 code 已使用
    code.use!

    # 建立 API Token（重用現有模型）
    api_token = code.user.api_tokens.create!(
      name: "MCP Remote (#{Time.current.strftime('%Y-%m-%d %H:%M')})",
      expires_at: 30.days.from_now
    )

    render json: {
      access_token: api_token.token,
      token_type: 'Bearer',
      expires_in: 30.days.to_i
    }
  end

  private

  def validate_client
    client_id = params[:client_id]
    redirect_uri = params[:redirect_uri]

    client = ALLOWED_CLIENTS[client_id]

    unless client && redirect_uri&.match?(client[:redirect_uri_pattern])
      render json: { error: 'invalid_client' }, status: :bad_request
    end
  end
end
```

#### 4. Routes

```ruby
# config/routes.rb
scope :oauth do
  get  :authorize, to: 'oauth#authorize'
  post :authorize, to: 'oauth#confirm'
  post :token,     to: 'oauth#token'
end
```

#### 5. 授權頁面 View

```erb
<%# app/views/oauth/authorize.html.erb %>
<div class="oauth-consent">
  <h1>授權 Slima MCP</h1>

  <p>
    <strong>Slima MCP</strong> 想要存取你的 Slima 帳號：
  </p>

  <ul>
    <li>讀取你的書籍列表</li>
    <li>讀取和編輯書籍內容</li>
    <li>取得 AI Beta Reader 回饋</li>
  </ul>

  <%= form_tag oauth_authorize_path, method: :post do %>
    <%= hidden_field_tag :client_id, @client_id %>
    <%= hidden_field_tag :redirect_uri, @redirect_uri %>
    <%= hidden_field_tag :state, @state %>

    <div class="actions">
      <%= submit_tag '允許', class: 'btn-primary' %>
      <%= link_to '拒絕', @redirect_uri + '?error=access_denied', class: 'btn-secondary' %>
    </div>
  <% end %>
</div>
```

### Worker 端：OAuth Client

```typescript
// src/worker/oauth.ts
import { Hono } from 'hono';

interface Env {
  SLIMA_API_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;  // 儲存 user tokens
}

export function createOAuthRoutes(app: Hono<{ Bindings: Env }>) {
  // 開始 OAuth 流程
  app.get('/auth/login', async (c) => {
    const state = crypto.randomUUID();
    const redirectUri = `${new URL(c.req.url).origin}/callback`;

    // 儲存 state 用於驗證（防 CSRF）
    await c.env.OAUTH_KV.put(`state:${state}`, '1', { expirationTtl: 600 });

    const authUrl = new URL(`${c.env.SLIMA_API_URL}/oauth/authorize`);
    authUrl.searchParams.set('client_id', c.env.OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');

    return c.redirect(authUrl.toString());
  });

  // OAuth callback
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      return c.html(`<h1>授權失敗</h1><p>${error}</p>`);
    }

    // 驗證 state
    const storedState = await c.env.OAUTH_KV.get(`state:${state}`);
    if (!storedState) {
      return c.html('<h1>無效的請求</h1>', 400);
    }
    await c.env.OAUTH_KV.delete(`state:${state}`);

    // 交換 code 取得 token
    const tokenResponse = await fetch(`${c.env.SLIMA_API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: c.env.OAUTH_CLIENT_ID,
        redirect_uri: `${new URL(c.req.url).origin}/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      return c.html('<h1>授權失敗</h1>', 400);
    }

    const { access_token } = await tokenResponse.json();

    // 產生 session ID 並儲存 token
    const sessionId = crypto.randomUUID();
    await c.env.OAUTH_KV.put(`session:${sessionId}`, access_token, {
      expirationTtl: 30 * 24 * 60 * 60, // 30 days
    });

    // 設定 cookie 並顯示成功頁面
    return c.html(`
      <script>
        document.cookie = "session=${sessionId}; path=/; secure; samesite=strict; max-age=${30 * 24 * 60 * 60}";
        window.close();
      </script>
      <h1>授權成功！</h1>
      <p>你可以關閉此視窗。</p>
    `);
  });
}
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

### Phase 1: Cloudflare Worker + OAuth

**目標：** 實作 HTTP transport 和 OAuth 認證

#### 1.1 Rails 端（OAuth Provider）

**任務：**
1. 建立 `OAuthAuthorizationCode` model 和 migration
2. 實作 `OAuthController`（authorize, token endpoints）
3. 建立授權確認頁面
4. 新增路由
5. 撰寫測試

**產出：**
- `GET /oauth/authorize` - 授權頁面
- `POST /oauth/authorize` - 確認授權
- `POST /oauth/token` - 交換 token

**預估：** 0.5 天

#### 1.2 Worker 端

**任務：**
1. 建立 `src/worker/` 目錄
2. 實作 Worker 入口（使用共用的 core）
3. 實作 OAuth Client（login, callback）
4. 新增 `wrangler.toml` 設定
5. 設定 Cloudflare KV（儲存 session）
6. 更新建置設定（tsup 雙 target）
7. 部署並測試

**產出：**
- 可部署的 Cloudflare Worker
- `https://slima-mcp.xxx.workers.dev/mcp`
- OAuth 認證流程完整
- 所有 14 個工具可用

**預估：** 1 天

---

### Phase 2: 整合測試與文件

**目標：** 確保穩定性，更新文件

**任務：**
1. 新增 Worker 相關測試
2. 新增 OAuth 端到端測試
3. 更新 README（新增 Remote MCP 使用說明）
4. 錯誤處理優化
5. 新增使用範例

**產出：**
- 完整測試覆蓋
- 更新後的文件

**預估：** 0.5 天

---

## 里程碑

| 階段 | 目標 | 預估時間 | 完成標準 |
|------|------|----------|----------|
| Phase 0 | 重構程式碼結構 | 0.5 天 | 測試通過、npm package 正常 |
| Phase 1.1 | Rails OAuth Provider | 0.5 天 | OAuth endpoints 可用 |
| Phase 1.2 | Worker + OAuth Client | 1 天 | 能從 Claude.ai 一鍵授權並使用所有工具 |
| Phase 2 | 測試與文件 | 0.5 天 | 文件完整、測試覆蓋 |

**總計：** 2.5 天

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
OAUTH_CLIENT_ID = "slima-mcp-worker"

[[kv_namespaces]]
binding = "OAUTH_KV"
id = "your-kv-namespace-id"
```

### 部署流程

```bash
# 1. 建立 KV namespace
wrangler kv:namespace create OAUTH_KV

# 2. 更新 wrangler.toml 中的 KV ID

# 3. 開發
npm run dev:worker          # 本地測試 Worker

# 4. 部署
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

### 網頁版（OAuth 流程）

```
1. 在 Claude.ai 點擊「連接 MCP」
2. 輸入 URL: https://slima-mcp.xxx.workers.dev/mcp
3. 點擊連接 → 跳轉到 Slima
4. 登入（如果尚未登入）
5. 點擊「允許」授權
6. 自動返回 Claude.ai → 連接完成！

整個過程不需要複製貼上任何 token。
```

---

## 決策記錄

| 決策 | 選項 | 選擇 | 理由 |
|------|------|------|------|
| 專案架構 | 分開 Repo / 單一 Repo | **單一 Repo** | 共用程式碼、統一維護 |
| 平台 | Cloudflare / Vercel / 自建 | **Cloudflare Workers** | 官方 MCP 支援、免費額度高 |
| Transport | SSE / Streamable HTTP | **Streamable HTTP** | 新標準、SSE 已棄用 |
| 認證 | OAuth / API Token | **OAuth** | 最佳用戶體驗、一鍵授權 |

---

## 相關資源

- [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [MCP Transports Documentation](https://modelcontextprotocol.io/docs/concepts/transports)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [OAuth 2.0 Specification](https://oauth.net/2/)

---

## 風險與緩解

| 風險 | 影響 | 緩解措施 |
|------|------|----------|
| Cloudflare Workers 環境限制 | 部分 Node.js API 不可用 | 使用 polyfill 或改寫 |
| OAuth token 洩漏 | 安全風險 | KV 設定 TTL、支援 token 撤銷 |
| 雙 transport 維護成本 | 開發時間增加 | 共用核心邏輯、統一測試 |

---

## 附錄：需要在 Rails 新增的檔案

```
slima_rails/
├── app/
│   ├── controllers/
│   │   └── oauth_controller.rb          # 🆕 OAuth endpoints
│   ├── models/
│   │   └── oauth_authorization_code.rb  # 🆕 Authorization code model
│   └── views/
│       └── oauth/
│           └── authorize.html.erb       # 🆕 授權確認頁面
├── config/
│   └── routes.rb                        # 🔄 新增 OAuth routes
├── db/
│   └── migrate/
│       └── xxx_create_oauth_authorization_codes.rb  # 🆕 Migration
└── spec/
    ├── controllers/
    │   └── oauth_controller_spec.rb     # 🆕 Controller 測試
    └── models/
        └── oauth_authorization_code_spec.rb  # 🆕 Model 測試
```
