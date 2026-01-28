# Remote MCP Server 開發計畫

> 讓 Claude.ai、ChatGPT 網頁版等平台可以透過 HTTP 連接 Slima MCP Server

**版本**: v3.0 (2026-01-29 更新)
**狀態**: 最佳做法審查 - 依據 Cloudflare 官方建議更新

---

## 2026-01-29 更新：最佳做法審查

### 參考資源

- [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [Cloudflare Authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)
- [workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
- [createMcpHandler API](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)

### 現有實作 vs 最佳做法

| 元件 | 現有做法 | Cloudflare 建議 | 狀態 |
|------|----------|-----------------|------|
| MCP Transport | `WebStandardStreamableHTTPServerTransport` | 同上 (或 `createMcpHandler`) | ✅ 符合 |
| OAuth 處理 | 自訂 `oauth.ts` | `workers-oauth-provider` | ⚠️ 可優化 |
| Token 儲存 | KV 手動存取 | `workers-oauth-provider` 自動加密 | ⚠️ 可優化 |
| DCR | 手動 proxy | 內建支援 | ⚠️ 可優化 |
| Well-Known | ✅ 已實作 | 同上 | ✅ 符合 |

### 改進計畫

詳見 `mcp-best-practices-plan.md`

---

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

在同一個 Repository 中，新增 **Remote MCP Server** 支援，部署到 Cloudflare Workers，並提供 OAuth 2.0 + PKCE 認證讓用戶一鍵授權。

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

### 3. 認證方案：OAuth 2.0 + PKCE

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

**為什麼選擇 OAuth + PKCE：**
- ✅ 最佳用戶體驗（不需複製貼上 token）
- ✅ 重用現有 ApiToken 模型
- ✅ 重用現有 Google OAuth 登入
- ✅ PKCE 保護 public client（Cloudflare Worker 無法安全儲存 secret）
- ✅ 符合 OAuth 2.0 最佳實踐

---

## 架構設計

### 單一 Repository，共用核心邏輯

```
slima-mcp/                        # 現有 Repository
├── src/
│   ├── core/                     # 🆕 共用核心模組
│   │   ├── api/
│   │   │   ├── client.ts         # Slima API Client（平台無關，可注入依賴）
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
│       └── oauth.ts              # OAuth Client 整合 (含 PKCE)
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
   │  使用本地 token │              │  OAuth + PKCE 認證      │
   │  ~/.slima/      │              │  ┌───────────────────┐  │
   │  credentials    │              │  │ 1. 產生 PKCE      │  │
   └────────┬────────┘              │  │ 2. 導向 Slima 授權│  │
            │                       │  │ 3. 用戶登入並授權 │  │
            │                       │  │ 4. 驗證 PKCE      │  │
            │                       │  │ 5. 取得 token     │  │
            │                       │  │ 6. 儲存到 KV      │  │
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
              │  🆕 OAuth Provider + PKCE   │
              │  - GET  /api/v1/oauth/authorize │
              │  - POST /api/v1/oauth/token     │
              │                             │
              │  🆕 Services                │
              │  - Oauth::AuthorizeService  │
              │  - Oauth::ExchangeTokenService │
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

#### 1. 資料庫 Migration（含 PKCE 支援）

```ruby
# db/migrate/xxx_create_oauth_authorization_codes.rb
class CreateOAuthAuthorizationCodes < ActiveRecord::Migration[7.2]
  def change
    create_table :oauth_authorization_codes do |t|
      t.string :token, null: false, index: { unique: true }  # Slima token 格式
      t.references :user, null: false, foreign_key: true
      t.string :code, null: false, index: { unique: true }   # OAuth authorization code
      t.string :client_id, null: false
      t.string :redirect_uri, null: false
      t.string :scope                                        # OAuth scope
      t.string :code_challenge                               # PKCE: challenge
      t.string :code_challenge_method                        # PKCE: S256 或 plain
      t.string :state
      t.datetime :expires_at, null: false
      t.datetime :used_at                                    # 防止重複使用
      t.timestamps

      t.index [:client_id, :created_at]  # 方便清理過期 codes
    end
  end
end
```

#### 2. Model（使用 Tokenable concern）

```ruby
# app/models/oauth_authorization_code.rb
class OAuthAuthorizationCode < ApplicationRecord
  include Tokenable

  TOKEN_PREFIX = 'oac_'

  belongs_to :user

  validates :code, presence: true, uniqueness: true
  validates :client_id, :redirect_uri, :expires_at, presence: true

  before_validation :generate_token, on: :create
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

  def pkce_required?
    code_challenge.present?
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

#### 3. Services（遵循 Slima 架構模式）

```ruby
# app/services/oauth/authorize_service.rb
module Oauth
  class AuthorizeService
    Result = Struct.new(:success?, :authorization_code, :error, keyword_init: true)

    ALLOWED_CLIENTS = {
      'slima-mcp-worker' => {
        redirect_uri_pattern: %r{\Ahttps://slima-mcp\..*\.workers\.dev/callback\z},
        name: 'Slima MCP'
      }
    }.freeze

    def initialize(user:, client_id:, redirect_uri:, state: nil,
                   code_challenge: nil, code_challenge_method: nil, scope: nil)
      @user = user
      @client_id = client_id
      @redirect_uri = redirect_uri
      @state = state
      @code_challenge = code_challenge
      @code_challenge_method = code_challenge_method
      @scope = scope
    end

    def call
      return Result.new(success?: false, error: :invalid_client) unless valid_client?

      authorization_code = create_authorization_code
      Result.new(success?: true, authorization_code: authorization_code)
    rescue ActiveRecord::RecordInvalid => e
      Result.new(success?: false, error: e.message)
    end

    private

    attr_reader :user, :client_id, :redirect_uri, :state,
                :code_challenge, :code_challenge_method, :scope

    def valid_client?
      client = ALLOWED_CLIENTS[client_id]
      client && redirect_uri&.match?(client[:redirect_uri_pattern])
    end

    def create_authorization_code
      OAuthAuthorizationCode.create!(
        user: user,
        client_id: client_id,
        redirect_uri: redirect_uri,
        state: state,
        code_challenge: code_challenge,
        code_challenge_method: code_challenge_method,
        scope: scope
      )
    end
  end
end
```

```ruby
# app/services/oauth/exchange_token_service.rb
module Oauth
  class ExchangeTokenService
    Result = Struct.new(:success?, :access_token, :expires_in, :error, :error_description, keyword_init: true)

    def initialize(code:, client_id:, code_verifier: nil)
      @code = code
      @client_id = client_id
      @code_verifier = code_verifier
    end

    def call
      authorization_code = find_valid_code
      return invalid_grant_error unless authorization_code
      return invalid_pkce_error unless verify_pkce(authorization_code)

      authorization_code.use!
      api_token = create_api_token(authorization_code.user)

      # Audit log
      Rails.logger.info("[OAuth] Token exchanged for user #{authorization_code.user.token}")

      Result.new(
        success?: true,
        access_token: api_token.token,
        expires_in: 30.days.to_i
      )
    end

    private

    attr_reader :code, :client_id, :code_verifier

    def find_valid_code
      OAuthAuthorizationCode.valid.find_by(code: code, client_id: client_id)
    end

    def verify_pkce(authorization_code)
      return true unless authorization_code.pkce_required?
      return false if code_verifier.blank?

      case authorization_code.code_challenge_method
      when 'S256'
        expected = Base64.urlsafe_encode64(
          Digest::SHA256.digest(code_verifier),
          padding: false
        )
        ActiveSupport::SecurityUtils.secure_compare(expected, authorization_code.code_challenge)
      when 'plain'
        ActiveSupport::SecurityUtils.secure_compare(code_verifier, authorization_code.code_challenge)
      else
        false
      end
    end

    def create_api_token(user)
      user.api_tokens.create!(
        name: "MCP Remote (#{Time.current.strftime('%Y-%m-%d %H:%M')})",
        expires_at: 30.days.from_now
      )
    end

    def invalid_grant_error
      Result.new(
        success?: false,
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code'
      )
    end

    def invalid_pkce_error
      Result.new(
        success?: false,
        error: 'invalid_grant',
        error_description: 'Invalid PKCE code verifier'
      )
    end
  end
end
```

#### 4. Controller（薄控制器）

```ruby
# app/controllers/api/v1/oauth_controller.rb
module Api
  module V1
    class OauthController < ApplicationController
      include RateLimitable  # 新增：Rate Limiting

      rate_limit to: 20, within: 1.minute, only: [:authorize, :confirm]
      rate_limit to: 10, within: 1.minute, only: [:token]

      before_action :authenticate_user!, only: [:authorize, :confirm]

      # GET /api/v1/oauth/authorize
      # 顯示授權確認頁面
      def authorize
        @client_id = params[:client_id]
        @redirect_uri = params[:redirect_uri]
        @state = params[:state]
        @code_challenge = params[:code_challenge]
        @code_challenge_method = params[:code_challenge_method]
        @scope = params[:scope]

        # 驗證 client
        service = Oauth::AuthorizeService.new(
          user: current_user,
          client_id: @client_id,
          redirect_uri: @redirect_uri
        )

        # 只驗證 client，不建立 code（等用戶確認）
        unless service.send(:valid_client?)
          render json: { error: 'invalid_client' }, status: :bad_request
          return
        end

        # 渲染授權頁面
      end

      # POST /api/v1/oauth/authorize
      # 用戶確認授權
      def confirm
        result = Oauth::AuthorizeService.new(
          user: current_user,
          client_id: params[:client_id],
          redirect_uri: params[:redirect_uri],
          state: params[:state],
          code_challenge: params[:code_challenge],
          code_challenge_method: params[:code_challenge_method],
          scope: params[:scope]
        ).call

        if result.success?
          redirect_uri = build_redirect_uri(
            params[:redirect_uri],
            code: result.authorization_code.code,
            state: params[:state]
          )
          redirect_to redirect_uri, allow_other_host: true
        else
          render json: { error: result.error }, status: :bad_request
        end
      end

      # POST /api/v1/oauth/token
      # 交換 authorization code 取得 access token
      def token
        result = Oauth::ExchangeTokenService.new(
          code: params[:code],
          client_id: params[:client_id],
          code_verifier: params[:code_verifier]
        ).call

        if result.success?
          render json: {
            access_token: result.access_token,
            token_type: 'Bearer',
            expires_in: result.expires_in
          }
        else
          render json: {
            error: result.error,
            error_description: result.error_description
          }, status: :bad_request
        end
      end

      private

      def build_redirect_uri(base_uri, params)
        uri = URI.parse(base_uri)
        uri.query = URI.encode_www_form(params.compact)
        uri.to_s
      end
    end
  end
end
```

#### 5. Routes（放在 /api/v1 下）

```ruby
# config/routes.rb
namespace :api do
  namespace :v1 do
    # OAuth endpoints
    scope :oauth do
      get  :authorize, to: 'oauth#authorize'
      post :authorize, to: 'oauth#confirm'
      post :token,     to: 'oauth#token'
    end
  end
end
```

#### 6. Authorization Page View

> 遵循 [UIUX_SPEC.md](C:\Users\Tim Tsai\Desktop\codes\slima_vue\docs\specs\UIUX_SPEC.md) 設計規範：
> - 主背景使用暖色奶白 `#FBFBFA`
> - 黑白灰為主，顏色只用於傳達狀態
> - Primary Button: 深灰色填充 `bg-gray-900`
> - Ghost Button: 透明背景，灰色邊框
> - 使用 Lucide 圖示風格
> - 圓角: `rounded-xl` (16px) 用於 Modal

```erb
<%# app/views/api/v1/oauth/authorize.html.erb %>
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Authorize - Slima</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="icon" href="https://app.slima.ai/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: {
            'slima-bg': '#FBFBFA',
            'slima-secondary': '#F5F5F7',
          }
        }
      }
    }
  </script>
</head>
<body class="bg-slima-bg min-h-screen grid place-items-center p-4 font-sans">
  <div class="w-full max-w-sm bg-white rounded-xl shadow-md overflow-hidden">
    <!-- Header with Logo -->
    <div class="px-6 pt-8 pb-6 text-center">
      <img
        src="https://app.slima.ai/icons/slima-black.svg"
        alt="Slima"
        class="h-8 mx-auto mb-6"
      />
      <h1 class="text-xl font-semibold text-gray-900 mb-1">
        Authorize Slima MCP
      </h1>
      <p class="text-sm text-gray-500">
        to access your Slima account
      </p>
    </div>

    <!-- Permissions -->
    <div class="px-6 pb-6">
      <div class="bg-slima-secondary rounded-lg p-4">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
          Permissions
        </p>
        <ul class="space-y-3">
          <li class="flex items-start text-sm text-gray-700">
            <svg class="w-4 h-4 text-gray-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
            </svg>
            Read your book list
          </li>
          <li class="flex items-start text-sm text-gray-700">
            <svg class="w-4 h-4 text-gray-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
            </svg>
            Read and edit book content
          </li>
          <li class="flex items-start text-sm text-gray-700">
            <svg class="w-4 h-4 text-gray-400 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
            </svg>
            Get AI Beta Reader feedback
          </li>
        </ul>
      </div>
    </div>

    <!-- User Info -->
    <div class="px-6 pb-4">
      <div class="flex items-center text-sm text-gray-500">
        <svg class="w-4 h-4 mr-2 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
        </svg>
        <span class="truncate"><%= current_user.email %></span>
      </div>
    </div>

    <!-- Actions -->
    <div class="px-6 pb-6">
      <%= form_tag api_v1_oauth_authorize_path, method: :post do %>
        <%= hidden_field_tag :client_id, @client_id %>
        <%= hidden_field_tag :redirect_uri, @redirect_uri %>
        <%= hidden_field_tag :state, @state %>
        <%= hidden_field_tag :code_challenge, @code_challenge %>
        <%= hidden_field_tag :code_challenge_method, @code_challenge_method %>
        <%= hidden_field_tag :scope, @scope %>

        <div class="flex gap-3">
          <%= link_to "Deny",
              "#{@redirect_uri}?error=access_denied&state=#{@state}",
              class: "flex-1 px-4 py-2.5 text-center text-sm font-medium text-gray-700 bg-transparent border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors" %>
          <%= submit_tag "Allow",
              class: "flex-1 px-4 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer" %>
        </div>
      <% end %>
    </div>

    <!-- Footer -->
    <div class="px-6 py-4 bg-slima-secondary border-t border-gray-200">
      <p class="text-xs text-gray-400 text-center">
        By authorizing, you agree to Slima's
        <a href="https://slima.ai/terms" class="text-gray-500 hover:text-gray-700 underline">Terms</a>
      </p>
    </div>
  </div>
</body>
</html>
```

### Worker 端：OAuth Client（含 PKCE）

```typescript
// src/worker/oauth.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  SLIMA_API_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;
}

// PKCE 工具函數
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function createOAuthRoutes(app: Hono<{ Bindings: Env }>) {
  // CORS 設定
  app.use('/auth/*', cors({
    origin: ['https://claude.ai', 'https://chat.openai.com'],
    credentials: true,
  }));

  // 開始 OAuth 流程（含 PKCE）
  app.get('/auth/login', async (c) => {
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const redirectUri = `${new URL(c.req.url).origin}/callback`;

    // 儲存 state 和 code_verifier（PKCE 需要）
    await c.env.OAUTH_KV.put(
      `oauth:${state}`,
      JSON.stringify({ codeVerifier, redirectUri }),
      { expirationTtl: 600 }
    );

    const authUrl = new URL(`${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`);
    authUrl.searchParams.set('client_id', c.env.OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return c.redirect(authUrl.toString());
  });

  // OAuth callback (with PKCE verification)
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    // Shared page template (follows UIUX_SPEC.md)
    const pageTemplate = (options: {
      title: string;
      heading: string;
      message: string;
      isSuccess: boolean;
      autoClose?: boolean;
      sessionScript?: string;
    }) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>${options.title} - Slima</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="icon" href="https://app.slima.ai/favicon.ico">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
        <script>
          tailwind.config = {
            theme: {
              extend: {
                fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
                colors: { 'slima-bg': '#FBFBFA' }
              }
            }
          }
        </script>
        ${options.sessionScript || ''}
        ${options.autoClose ? '<script>setTimeout(() => window.close(), 3000);</script>' : ''}
      </head>
      <body class="bg-slima-bg min-h-screen grid place-items-center p-4 font-sans">
        <div class="w-full max-w-sm bg-white rounded-xl shadow-md overflow-hidden text-center">
          <div class="px-6 py-8">
            <img src="https://app.slima.ai/icons/slima-black.svg" alt="Slima" class="h-8 mx-auto mb-6" />

            <!-- Status Icon -->
            <div class="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center ${options.isSuccess ? 'bg-green-50' : 'bg-red-50'}">
              ${options.isSuccess
                ? '<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>'
                : '<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>'
              }
            </div>

            <h1 class="text-lg font-semibold text-gray-900 mb-2">${options.heading}</h1>
            <p class="text-sm text-gray-500">${options.message}</p>
          </div>

          <div class="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <p class="text-xs text-gray-400">
              ${options.autoClose ? 'This window will close automatically...' : 'You can close this window.'}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    if (error) {
      return c.html(pageTemplate({
        title: 'Authorization Denied',
        heading: 'Authorization Denied',
        message: error === 'access_denied'
          ? 'You denied access to your Slima account.'
          : error,
        isSuccess: false,
      }), 400);
    }

    // Validate state + code_verifier
    const storedData = await c.env.OAUTH_KV.get(`oauth:${state}`);
    if (!storedData) {
      return c.html(pageTemplate({
        title: 'Invalid Request',
        heading: 'Session Expired',
        message: 'The authorization session has expired. Please try again.',
        isSuccess: false,
      }), 400);
    }

    const { codeVerifier, redirectUri } = JSON.parse(storedData);
    await c.env.OAUTH_KV.delete(`oauth:${state}`);

    // Exchange code for token (with PKCE code_verifier)
    const tokenResponse = await fetch(`${c.env.SLIMA_API_URL}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: c.env.OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({})) as { error_description?: string };
      return c.html(pageTemplate({
        title: 'Authorization Failed',
        heading: 'Something went wrong',
        message: errorData.error_description || 'Failed to complete authorization. Please try again.',
        isSuccess: false,
      }), 400);
    }

    const { access_token, expires_in } = await tokenResponse.json() as {
      access_token: string;
      expires_in: number
    };

    // Generate session ID and store token
    const sessionId = crypto.randomUUID();
    await c.env.OAUTH_KV.put(`session:${sessionId}`, access_token, {
      expirationTtl: expires_in,
    });

    // Set cookie and show success page
    return c.html(pageTemplate({
      title: 'Connected',
      heading: 'Connected to Slima',
      message: 'Slima MCP is now connected to your account.',
      isSuccess: true,
      autoClose: true,
      sessionScript: `<script>document.cookie = "slima_session=${sessionId}; path=/; secure; samesite=strict; max-age=${expires_in}";</script>`,
    }));
  });

  // 登出
  app.post('/auth/logout', async (c) => {
    const sessionId = c.req.header('Cookie')?.match(/slima_session=([^;]+)/)?.[1];
    if (sessionId) {
      await c.env.OAUTH_KV.delete(`session:${sessionId}`);
    }
    return c.json({ success: true });
  });
}

// 從 session 取得 token 的 middleware
export async function getTokenFromSession(c: any): Promise<string | null> {
  const sessionId = c.req.header('Cookie')?.match(/slima_session=([^;]+)/)?.[1];
  if (!sessionId) return null;
  return await c.env.OAUTH_KV.get(`session:${sessionId}`);
}
```

---

## 開發階段

### Phase 0: 重構現有程式碼結構

**目標：** 將現有程式碼拆分為 core + cli 結構，API Client 改為可注入依賴

**任務：**
1. 建立 `src/core/` 目錄結構
2. 將 API Client 移到 `src/core/api/`，改為可注入 token getter
3. 將工具邏輯抽取到 `src/core/tools/`
4. 將 CLI 相關程式碼移到 `src/cli/`
5. 確保現有測試通過

**API Client 改進：**
```typescript
// src/core/api/client.ts
export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string>;  // 異步取得 token
}

export class SlimaApiClient {
  constructor(private config: ApiClientConfig) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.config.getToken();
    // ...
  }
}
```

**產出：**
- 重構後的程式碼結構
- 所有測試通過
- npm package 功能不變

**預估：** 0.5 天

---

### Phase 1: Cloudflare Worker + OAuth

**目標：** 實作 HTTP transport 和 OAuth + PKCE 認證

#### 1.1 Rails 端（OAuth Provider）

**任務：**
1. 建立 `OAuthAuthorizationCode` model 和 migration（含 PKCE 欄位）
2. 建立 `Oauth::AuthorizeService`
3. 建立 `Oauth::ExchangeTokenService`（含 PKCE 驗證）
4. 實作 `Api::V1::OauthController`（薄控制器）
5. 新增 Rate Limiting
6. 建立授權確認頁面
7. 新增路由（在 `/api/v1/oauth/` 下）
8. 撰寫測試

**產出：**
- `GET /api/v1/oauth/authorize` - 授權頁面
- `POST /api/v1/oauth/authorize` - 確認授權
- `POST /api/v1/oauth/token` - 交換 token（支援 PKCE）

**預估：** 0.75 天

#### 1.2 Worker 端

**任務：**
1. 建立 `src/worker/` 目錄
2. 實作 Worker 入口（使用共用的 core）
3. 實作 OAuth Client（含 PKCE code_verifier 生成和儲存）
4. 新增 `wrangler.toml` 設定
5. 設定 Cloudflare KV（儲存 session 和 PKCE state）
6. 設定 CORS
7. 更新建置設定（tsup 雙 target）
8. 部署並測試

**產出：**
- 可部署的 Cloudflare Worker
- `https://slima-mcp.xxx.workers.dev/mcp`
- OAuth + PKCE 認證流程完整
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

## BDD 測試規格

### Rails 端測試

#### Model 測試
```ruby
# spec/models/oauth_authorization_code_spec.rb
RSpec.describe OAuthAuthorizationCode, type: :model do
  describe 'associations' do
    it { is_expected.to belong_to(:user) }
  end

  describe 'validations' do
    it { is_expected.to validate_presence_of(:code) }
    it { is_expected.to validate_uniqueness_of(:code) }
    it { is_expected.to validate_presence_of(:client_id) }
    it { is_expected.to validate_presence_of(:redirect_uri) }
    it { is_expected.to validate_presence_of(:expires_at) }
  end

  describe 'token generation' do
    it 'generates token with oac_ prefix' do
      code = create(:oauth_authorization_code)
      expect(code.token).to start_with('oac_')
    end
  end

  describe '#expired?' do
    context 'when expires_at is in the past' do
      it 'returns true' do
        code = create(:oauth_authorization_code, expires_at: 1.minute.ago)
        expect(code).to be_expired
      end
    end

    context 'when expires_at is in the future' do
      it 'returns false' do
        code = create(:oauth_authorization_code, expires_at: 10.minutes.from_now)
        expect(code).not_to be_expired
      end
    end
  end

  describe '#use!' do
    it 'sets used_at to current time' do
      code = create(:oauth_authorization_code)
      expect { code.use! }.to change { code.used_at }.from(nil)
    end
  end

  describe '#pkce_required?' do
    context 'when code_challenge is present' do
      it 'returns true' do
        code = create(:oauth_authorization_code, code_challenge: 'challenge')
        expect(code).to be_pkce_required
      end
    end

    context 'when code_challenge is nil' do
      it 'returns false' do
        code = create(:oauth_authorization_code, code_challenge: nil)
        expect(code).not_to be_pkce_required
      end
    end
  end
end
```

#### Service 測試
```ruby
# spec/services/oauth/authorize_service_spec.rb
RSpec.describe Oauth::AuthorizeService do
  let(:user) { create(:user) }
  let(:valid_params) do
    {
      user: user,
      client_id: 'slima-mcp-worker',
      redirect_uri: 'https://slima-mcp.test.workers.dev/callback',
      state: 'random_state'
    }
  end

  describe '#call' do
    context 'with valid client' do
      it 'creates authorization code' do
        result = described_class.new(**valid_params).call
        expect(result).to be_success
        expect(result.authorization_code).to be_persisted
      end

      it 'stores PKCE challenge when provided' do
        result = described_class.new(
          **valid_params,
          code_challenge: 'challenge_hash',
          code_challenge_method: 'S256'
        ).call

        expect(result.authorization_code.code_challenge).to eq('challenge_hash')
        expect(result.authorization_code.code_challenge_method).to eq('S256')
      end
    end

    context 'with invalid client_id' do
      it 'returns error' do
        result = described_class.new(**valid_params.merge(client_id: 'invalid')).call
        expect(result).not_to be_success
        expect(result.error).to eq(:invalid_client)
      end
    end

    context 'with invalid redirect_uri' do
      it 'returns error' do
        result = described_class.new(**valid_params.merge(redirect_uri: 'https://evil.com')).call
        expect(result).not_to be_success
        expect(result.error).to eq(:invalid_client)
      end
    end
  end
end

# spec/services/oauth/exchange_token_service_spec.rb
RSpec.describe Oauth::ExchangeTokenService do
  let(:user) { create(:user) }
  let(:authorization_code) { create(:oauth_authorization_code, user: user) }

  describe '#call' do
    context 'with valid code' do
      it 'returns access token' do
        result = described_class.new(
          code: authorization_code.code,
          client_id: authorization_code.client_id
        ).call

        expect(result).to be_success
        expect(result.access_token).to start_with('slima_')
      end

      it 'marks code as used' do
        expect {
          described_class.new(
            code: authorization_code.code,
            client_id: authorization_code.client_id
          ).call
        }.to change { authorization_code.reload.used_at }.from(nil)
      end

      it 'creates ApiToken for user' do
        expect {
          described_class.new(
            code: authorization_code.code,
            client_id: authorization_code.client_id
          ).call
        }.to change { user.api_tokens.count }.by(1)
      end
    end

    context 'with PKCE' do
      let(:code_verifier) { 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' }
      let(:code_challenge) do
        Base64.urlsafe_encode64(Digest::SHA256.digest(code_verifier), padding: false)
      end
      let(:pkce_code) do
        create(:oauth_authorization_code,
               user: user,
               code_challenge: code_challenge,
               code_challenge_method: 'S256')
      end

      context 'with valid code_verifier' do
        it 'returns access token' do
          result = described_class.new(
            code: pkce_code.code,
            client_id: pkce_code.client_id,
            code_verifier: code_verifier
          ).call

          expect(result).to be_success
        end
      end

      context 'with invalid code_verifier' do
        it 'returns error' do
          result = described_class.new(
            code: pkce_code.code,
            client_id: pkce_code.client_id,
            code_verifier: 'wrong_verifier'
          ).call

          expect(result).not_to be_success
          expect(result.error).to eq('invalid_grant')
          expect(result.error_description).to include('PKCE')
        end
      end

      context 'without code_verifier when required' do
        it 'returns error' do
          result = described_class.new(
            code: pkce_code.code,
            client_id: pkce_code.client_id
          ).call

          expect(result).not_to be_success
          expect(result.error).to eq('invalid_grant')
        end
      end
    end

    context 'with expired code' do
      let(:expired_code) { create(:oauth_authorization_code, user: user, expires_at: 1.minute.ago) }

      it 'returns error' do
        result = described_class.new(
          code: expired_code.code,
          client_id: expired_code.client_id
        ).call

        expect(result).not_to be_success
        expect(result.error).to eq('invalid_grant')
      end
    end

    context 'with already used code' do
      before { authorization_code.use! }

      it 'returns error' do
        result = described_class.new(
          code: authorization_code.code,
          client_id: authorization_code.client_id
        ).call

        expect(result).not_to be_success
        expect(result.error).to eq('invalid_grant')
      end
    end
  end
end
```

#### Request 測試
```ruby
# spec/requests/api/v1/oauth_spec.rb
RSpec.describe 'Api::V1::OAuth', type: :request do
  let(:user) { create(:user) }

  describe 'GET /api/v1/oauth/authorize' do
    let(:valid_params) do
      {
        client_id: 'slima-mcp-worker',
        redirect_uri: 'https://slima-mcp.test.workers.dev/callback',
        state: 'random_state',
        response_type: 'code'
      }
    end

    context 'when not authenticated' do
      it 'redirects to login' do
        get '/api/v1/oauth/authorize', params: valid_params
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context 'when authenticated' do
      before { sign_in user }

      it 'shows authorization page' do
        get '/api/v1/oauth/authorize', params: valid_params
        expect(response).to have_http_status(:ok)
        expect(response.body).to include('授權 Slima MCP')
      end

      context 'with PKCE parameters' do
        it 'includes PKCE fields in form' do
          get '/api/v1/oauth/authorize', params: valid_params.merge(
            code_challenge: 'challenge',
            code_challenge_method: 'S256'
          )
          expect(response.body).to include('code_challenge')
        end
      end
    end

    context 'with invalid client_id' do
      before { sign_in user }

      it 'returns 400 error' do
        get '/api/v1/oauth/authorize', params: valid_params.merge(client_id: 'invalid')
        expect(response).to have_http_status(:bad_request)
        expect(json_response['error']).to eq('invalid_client')
      end
    end
  end

  describe 'POST /api/v1/oauth/authorize' do
    let(:valid_params) do
      {
        client_id: 'slima-mcp-worker',
        redirect_uri: 'https://slima-mcp.test.workers.dev/callback',
        state: 'random_state'
      }
    end

    before { sign_in user }

    context 'when user confirms' do
      it 'redirects with code and state' do
        post '/api/v1/oauth/authorize', params: valid_params

        expect(response).to have_http_status(:redirect)
        redirect_uri = URI.parse(response.location)
        params = CGI.parse(redirect_uri.query)

        expect(params['code']).to be_present
        expect(params['state']).to eq(['random_state'])
      end

      it 'creates authorization code' do
        expect {
          post '/api/v1/oauth/authorize', params: valid_params
        }.to change { OAuthAuthorizationCode.count }.by(1)
      end
    end
  end

  describe 'POST /api/v1/oauth/token' do
    let(:authorization_code) { create(:oauth_authorization_code, user: user) }

    context 'with valid code' do
      it 'returns access token' do
        post '/api/v1/oauth/token', params: {
          grant_type: 'authorization_code',
          code: authorization_code.code,
          client_id: authorization_code.client_id
        }

        expect(response).to have_http_status(:ok)
        expect(json_response['access_token']).to be_present
        expect(json_response['token_type']).to eq('Bearer')
        expect(json_response['expires_in']).to be_present
      end
    end

    context 'with invalid code' do
      it 'returns 400 error' do
        post '/api/v1/oauth/token', params: {
          grant_type: 'authorization_code',
          code: 'invalid_code',
          client_id: 'slima-mcp-worker'
        }

        expect(response).to have_http_status(:bad_request)
        expect(json_response['error']).to eq('invalid_grant')
      end
    end
  end
end
```

### MCP Server 端測試

```typescript
// tests/worker/oauth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OAuth Client', () => {
  describe('GET /auth/login', () => {
    it('generates PKCE code_verifier and stores in KV', async () => {
      // Mock KV
      const mockKV = {
        put: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      // ... test implementation
      expect(mockKV.put).toHaveBeenCalledWith(
        expect.stringContaining('oauth:'),
        expect.stringContaining('codeVerifier'),
        expect.objectContaining({ expirationTtl: 600 })
      );
    });

    it('redirects to Slima authorize with PKCE challenge', async () => {
      // ... test implementation
      expect(redirectUrl).toContain('code_challenge=');
      expect(redirectUrl).toContain('code_challenge_method=S256');
    });
  });

  describe('GET /callback', () => {
    it('validates state from KV', async () => {
      // ... test implementation
    });

    it('exchanges code for token with PKCE verifier', async () => {
      // ... test implementation
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.objectContaining({
          body: expect.stringContaining('code_verifier'),
        })
      );
    });

    it('stores session token in KV', async () => {
      // ... test implementation
    });

    it('handles authorization error', async () => {
      // ... test implementation
    });
  });
});
```

### Factory 定義

```ruby
# spec/factories/oauth_authorization_codes.rb
FactoryBot.define do
  factory :oauth_authorization_code do
    user
    client_id { 'slima-mcp-worker' }
    redirect_uri { 'https://slima-mcp.test.workers.dev/callback' }
    state { SecureRandom.hex(16) }
    expires_at { 10.minutes.from_now }
    code_challenge { nil }
    code_challenge_method { nil }

    trait :with_pkce do
      code_challenge { Base64.urlsafe_encode64(Digest::SHA256.digest('test_verifier'), padding: false) }
      code_challenge_method { 'S256' }
    end

    trait :expired do
      expires_at { 1.minute.ago }
    end

    trait :used do
      used_at { Time.current }
    end
  end
end
```

---

## 里程碑

| 階段 | 目標 | 預估時間 | 完成標準 | 狀態 |
|------|------|----------|----------|------|
| Phase 0 | 重構程式碼結構 | 0.5 天 | 測試通過、npm package 正常 | ✅ 完成 |
| Phase 1.1 | Rails OAuth Provider | 0.75 天 | OAuth + PKCE endpoints 可用、測試通過 | ✅ 完成 |
| Phase 1.2 | Worker + OAuth Client | 1 天 | 能從 Claude.ai 一鍵授權並使用所有工具 | ✅ 完成 |
| Phase 2 | 測試與文件 | 0.5 天 | 文件完整、測試覆蓋 | ✅ 完成 |

**總計：** 2.75 天

### 完成紀錄 (2026-01-28)

**Phase 0: 重構程式碼結構**
- 建立 `src/core/` 目錄結構
- API Client 支援依賴注入（`getToken` 函數）
- 保持向後相容（支援舊版 `token` 字串配置）
- 所有 122 測試通過

**Phase 1.1: Rails OAuth Provider**
- 建立 `OauthAuthorizationCode` model（含 PKCE 欄位）
- 實作 `Oauth::AuthorizeService` 和 `Oauth::ExchangeTokenService`
- 實作 `Api::V1::OauthController` （薄控制器）
- 建立授權頁面（遵循 UIUX_SPEC.md）
- 59 個 OAuth 相關測試通過

**Phase 1.2: Worker + OAuth Client**
- 建立 `src/worker/` 目錄
- 實作 OAuth 2.0 + PKCE 客戶端
- 使用 Hono 作為 HTTP 路由
- 整合 MCP 端點（Streamable HTTP）
- 建立 `wrangler.toml` 設定
- 133 測試通過（含 11 個新 OAuth 測試）

**Phase 2: 測試與文件**
- 更新 README 加入 Remote MCP 使用說明
- 新增專案結構說明
- 完善錯誤處理

---

## 開發進度總覽

### ✅ 已完成（程式碼開發）

| 項目 | 狀態 | 備註 |
|------|------|------|
| MCP Server 重構 (core/cli/worker 結構) | ✅ | 133 tests |
| Rails OAuth Provider (Model, Service, Controller, View) | ✅ | 59 tests |
| Cloudflare Worker + OAuth Client 程式碼 | ✅ | 含 PKCE |
| 測試 (192 tests total) | ✅ | 需要 review 涵蓋率 |
| README 文件更新 | ✅ | |

### ⏳ 尚未完成（部署相關）

| 項目 | 狀態 | 備註 |
|------|------|------|
| Cloudflare KV namespace 建立 | ⏳ | 需要 Cloudflare 帳號 |
| wrangler.toml KV ID 更新 | ⏳ | 等待 KV 建立後 |
| Worker 部署到 Cloudflare | ⏳ | `npm run deploy:worker` |
| 端到端測試 (Claude.ai 實測) | ⏳ | 需要部署後測試 |

### ❌ 尚未實作

| 項目 | 優先級 | 備註 |
|------|--------|------|
| Rate Limiting (OAuth endpoints) | 高 | 計畫中有提到，但未實作 |
| ALLOWED_CLIENTS 自訂域名支援 | 中 | 目前只支援 *.workers.dev |
| Token 撤銷功能 | 中 | 用戶可從 Slima 設定頁面撤銷 |
| OAuth Swagger 文件 | 低 | 可後續補充 |

### 🔍 Code Review 結果 (2026-01-28)

詳細報告請見: `docs/dev/code-review-report.md`

#### 🚨 必須修復（部署前）

| 問題 | 檔案 | 狀態 |
|------|------|------|
| 缺少 Rate Limiting | `oauth_controller.rb` | ⏳ |
| Cookie 缺少 HttpOnly | `src/worker/oauth.ts` | ⏳ |
| pageTemplate XSS 風險 | `src/worker/oauth.ts` | ⏳ |
| 缺少 redirect_uri 驗證 | `exchange_token_service.rb` | ⏳ |

#### ⚠️ 建議修復

| 問題 | 檔案 | 狀態 |
|------|------|------|
| 缺少整合測試 | Worker tests | ⏳ |
| 缺少端到端測試 | Rails tests | ⏳ |
| 過期 codes 清理機制 | Model | ⏳ |
| MCP transport 不完整 | `src/worker/index.ts` | ⏳ |

#### 📊 測試涵蓋率

| 模組 | 測試數 | 狀態 |
|------|--------|------|
| Rails Model (OauthAuthorizationCode) | 19 | ✅ 良好 |
| Rails Service (Authorize) | 11 | ✅ 良好 |
| Rails Service (ExchangeToken) | 14 | ⚠️ 缺少邊界測試 |
| Rails Request | 15 | ⚠️ 缺少整合測試 |
| Worker OAuth | 11 | ⚠️ 缺少 route 測試 |
| **總計** | **70** | |

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
| 認證 | OAuth / API Token | **OAuth + PKCE** | 最佳用戶體驗、Public Client 安全 |
| 架構模式 | Controller 直接處理 / Service | **Service 模式** | 遵循 Slima 架構、可測試性 |
| Token 格式 | 隨機字串 / Slima 標準 | **Slima 標準 (oac_)** | 一致性、可識別 |
| 路由位置 | /oauth / /api/v1/oauth | **/api/v1/oauth** | 與現有 API 結構一致 |

---

## 相關資源

- [Cloudflare Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [MCP Transports Documentation](https://modelcontextprotocol.io/docs/concepts/transports)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [OAuth 2.0 PKCE](https://oauth.net/2/pkce/)

---

## 風險與緩解

| 風險 | 影響 | 緩解措施 |
|------|------|----------|
| Cloudflare Workers 環境限制 | 部分 Node.js API 不可用 | 使用 polyfill 或改寫 |
| OAuth token 洩漏 | 安全風險 | PKCE 保護、KV 設定 TTL、支援 token 撤銷 |
| 雙 transport 維護成本 | 開發時間增加 | 共用核心邏輯、統一測試 |
| CORS 問題 | 跨域請求失敗 | 正確設定 CORS headers |
| Rate Limiting 繞過 | 暴力攻擊 | 使用 IP + User Agent 限制 |

---

## 附錄：需要在 Rails 新增的檔案

```
slima_rails/
├── app/
│   ├── controllers/
│   │   └── api/v1/
│   │       └── oauth_controller.rb        # 🆕 OAuth endpoints (薄控制器)
│   ├── models/
│   │   └── oauth_authorization_code.rb    # 🆕 Authorization code model
│   ├── services/
│   │   └── oauth/
│   │       ├── authorize_service.rb       # 🆕 授權服務
│   │       └── exchange_token_service.rb  # 🆕 Token 交換服務
│   └── views/
│       └── api/v1/oauth/
│           └── authorize.html.erb         # 🆕 授權確認頁面
├── config/
│   └── routes.rb                          # 🔄 新增 OAuth routes
├── db/
│   └── migrate/
│       └── xxx_create_oauth_authorization_codes.rb  # 🆕 Migration (含 PKCE)
└── spec/
    ├── factories/
    │   └── oauth_authorization_codes.rb   # 🆕 Factory
    ├── models/
    │   └── oauth_authorization_code_spec.rb  # 🆕 Model 測試
    ├── services/
    │   └── oauth/
    │       ├── authorize_service_spec.rb     # 🆕 Service 測試
    │       └── exchange_token_service_spec.rb
    └── requests/
        └── api/v1/
            └── oauth_spec.rb              # 🆕 Request 測試
```

---

## 變更記錄

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| v1.0 | 2026-01-27 | 初版 |
| v2.0 | 2026-01-28 | Plan Review 後更新：新增 PKCE 支援、Service 模式、詳細 BDD 測試規格、Route 調整 |
