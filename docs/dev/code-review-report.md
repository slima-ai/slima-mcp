# Code Review & Test Review Report

**日期**: 2026-01-28
**更新**: 2026-01-28 (必須修復項目已完成)
**範圍**: Remote MCP Server (Rails OAuth Provider + Cloudflare Worker)

---

## 摘要

| 項目 | 狀態 | 測試數 | 備註 |
|------|------|--------|------|
| Rails OAuth Provider | ✅ 安全性已修復 | 44 | 新增 redirect_uri 驗證測試 |
| MCP Server Worker | ✅ 安全性已修復 | 11 | XSS 防護、HttpOnly cookie |
| **總計** | | **55** | |

## 修復記錄 (2026-01-28)

### ✅ 已修復的必須項目

1. **Rate Limiting** - 在 `rack_attack.rb` 新增 OAuth 專用限制
   - `/api/v1/oauth/authorize`: 20 次/分鐘
   - `/api/v1/oauth/token`: 10 次/分鐘

2. **XSS 防護** - Worker `oauth.ts` 新增 `escapeHtml()` 函數
   - 所有動態內容都經過 escape 處理

3. **Cookie HttpOnly** - Worker 使用 `Set-Cookie` header
   - `Secure; HttpOnly; SameSite=Strict`

4. **redirect_uri 驗證** - `ExchangeTokenService` 新增驗證
   - Token exchange 時驗證 redirect_uri 必須匹配

---

## Rails OAuth Provider Review

### 1. OauthAuthorizationCode Model

**檔案**: `app/models/oauth_authorization_code.rb`

#### ✅ 優點
- 使用 `Tokenable` concern，符合 Slima token 標準 (`oac_` prefix)
- 正確實作 PKCE 相關欄位 (code_challenge, code_challenge_method)
- 適當的 scope (`valid`, `expired`) 和 instance 方法
- `before_validation` 自動生成 code 和 expires_at

#### ❌ 問題

| 問題 | 嚴重度 | 建議 |
|------|--------|------|
| 缺少 `(client_id, created_at)` 索引 | 中 | 加入索引以便清理過期 codes |
| 沒有清理過期 codes 的機制 | 低 | 新增 Rake task 或 Sidekiq job |

#### 🧪 測試涵蓋率

| 測試項目 | 狀態 |
|----------|------|
| associations | ✅ |
| validations (client_id, redirect_uri) | ✅ |
| auto-generate code | ✅ |
| auto-generate expires_at | ✅ |
| code uniqueness | ✅ |
| token prefix | ✅ |
| #expired? | ✅ |
| #used? | ✅ |
| #use! | ✅ |
| #pkce_required? | ✅ |
| .valid scope | ✅ |
| .expired scope | ✅ |

**遺漏的測試**:
- [ ] `expires_at` 邊界情況 (正好等於 Time.current)
- [ ] 同一用戶多個 authorization codes 的情況
- [ ] code 長度驗證 (>= 32 characters)

---

### 2. Oauth::AuthorizeService

**檔案**: `app/services/oauth/authorize_service.rb`

#### ✅ 優點
- 使用 regex pattern 驗證 redirect_uri，防止開放重定向攻擊
- 支援多個 client 設定 (production + dev)
- 結構清晰，單一職責

#### ❌ 問題

| 問題 | 嚴重度 | 建議 |
|------|--------|------|
| redirect_uri pattern 只支援 `*.workers.dev` 和 localhost | 中 | 考慮支援自訂域名 |
| 沒有驗證 code_challenge_method 值 | 低 | 可加入白名單驗證 (S256, plain) |

#### 🧪 測試涵蓋率

| 測試項目 | 狀態 |
|----------|------|
| valid production client | ✅ |
| valid dev client | ✅ |
| invalid client_id | ✅ |
| invalid redirect_uri | ✅ |
| without PKCE | ✅ |
| valid_client? 各種情況 | ✅ |

**遺漏的測試**:
- [ ] `ActiveRecord::RecordInvalid` 異常處理
- [ ] state 特殊字符處理 (XSS prevention)
- [ ] 無效的 code_challenge_method 值

---

### 3. Oauth::ExchangeTokenService

**檔案**: `app/services/oauth/exchange_token_service.rb`

#### ✅ 優點
- 正確實作 PKCE S256 和 plain 驗證
- 使用 `ActiveSupport::SecurityUtils.secure_compare` 防止 timing attack
- 有 audit log 記錄 token 交換
- 正確處理各種錯誤情況

#### ❌ 問題

| 問題 | 嚴重度 | 狀態 |
|------|--------|------|
| ~~沒有驗證 redirect_uri 是否匹配~~ | ~~高~~ | ✅ 已修復 |
| 沒有處理 ApiToken 創建失敗 | 中 | 待改進 |
| 沒有處理 race condition (同一 code 並發使用) | 中 | 待改進 |

#### 🧪 測試涵蓋率

| 測試項目 | 狀態 |
|----------|------|
| valid code (no PKCE) | ✅ |
| PKCE S256 正確 | ✅ |
| PKCE S256 錯誤 | ✅ |
| PKCE S256 缺失 | ✅ |
| PKCE plain | ✅ |
| invalid code | ✅ |
| expired code | ✅ |
| used code | ✅ |
| mismatched client_id | ✅ |
| mismatched redirect_uri | ✅ (新增) |

**遺漏的測試**:
- [ ] 未知的 code_challenge_method (e.g., "SHA1")
- [ ] ApiToken 創建失敗的情況
- [ ] Race condition (並發請求)

---

### 4. Api::V1::OauthController

**檔案**: `app/controllers/api/v1/oauth_controller.rb`

#### ✅ 優點
- 薄控制器，業務邏輯在 Service
- 正確跳過 CSRF 驗證 (token endpoint)
- 使用 ERB 手動渲染解決 API mode 問題

#### ❌ 問題

| 問題 | 嚴重度 | 狀態 |
|------|--------|------|
| ~~**缺少 Rate Limiting**~~ | ~~高~~ | ✅ 已在 rack_attack.rb 修復 |
| `build_redirect_uri` 沒有 URL 驗證 | 低 | Service 已驗證 |
| HTML 渲染方式不標準 | 低 | 可接受 |

#### 🧪 Request Tests 涵蓋率

| 測試項目 | 狀態 |
|----------|------|
| GET authorize - authenticated | ✅ |
| GET authorize - invalid client | ✅ |
| GET authorize - invalid redirect_uri | ✅ |
| GET authorize - unauthenticated | ✅ |
| POST authorize - valid | ✅ |
| POST authorize - invalid client | ✅ |
| POST authorize - unauthenticated | ✅ |
| POST token - valid (no PKCE) | ✅ |
| POST token - PKCE S256 | ✅ |
| POST token - invalid code | ✅ |
| POST token - expired code | ✅ |
| POST token - used code | ✅ |
| POST token - mismatched client_id | ✅ |
| POST token - mismatched redirect_uri | ✅ (新增) |

**遺漏的測試**:
- [ ] OAuth 完整流程端到端測試
- [ ] PKCE plain 的 request 測試
- [ ] Content-Type 驗證 (application/json vs form-urlencoded)
- [ ] CORS headers 驗證

---

## MCP Server Worker Review

### 1. OAuth Client (src/worker/oauth.ts)

#### ✅ 優點
- 正確實作 PKCE (code_verifier + code_challenge)
- 使用 Web Crypto API (SHA-256)
- 正確的 base64url encoding
- 適當的 KV TTL 設定

#### ❌ 問題

| 問題 | 嚴重度 | 狀態 |
|------|--------|------|
| ~~pageTemplate XSS 風險~~ | ~~高~~ | ✅ 已修復 (escapeHtml) |
| 沒有驗證 state 參數格式 | 中 | 待改進 |
| ~~Cookie 沒有設定 HttpOnly~~ | ~~中~~ | ✅ 已修復 (Set-Cookie header) |
| CORS origin 硬編碼 | 低 | 可接受 |

#### 🧪 測試涵蓋率

| 測試項目 | 狀態 |
|----------|------|
| Code verifier generation | ✅ |
| Code challenge generation | ✅ |
| KV state storage | ✅ |
| KV session storage | ✅ |
| Authorization URL generation | ✅ |
| Token exchange | ✅ |
| Token exchange error | ✅ |
| Session cookie extraction | ✅ |

**遺漏的測試**:
- [ ] 完整的 Hono route 整合測試
- [ ] /auth/login 端點測試
- [ ] /callback 端點測試 (各種情況)
- [ ] /auth/logout 端點測試
- [ ] /auth/status 端點測試
- [ ] Error 情況的頁面渲染測試
- [ ] KV 過期的情況

---

### 2. Worker Entry Point (src/worker/index.ts)

#### ✅ 優點
- 使用 Hono 作為路由框架
- 正確設定 CORS
- 有 authentication middleware

#### ❌ 問題

| 問題 | 嚴重度 | 建議 |
|------|--------|------|
| MCP 實作不完整 | 高 | 需要使用 MCP SDK 的 transport |
| 每次請求都創建新 MCP Server | 中 | 考慮使用 singleton 或 cache |
| 沒有 error boundary | 中 | 加入全局錯誤處理 |

---

## 安全性 Review

### ✅ 已實作的安全措施

1. **PKCE**: 防止授權碼攔截攻擊
2. **State 參數**: 防止 CSRF 攻擊
3. **Secure Compare**: 防止 timing attack
4. **redirect_uri 驗證**: 防止開放重定向攻擊 (authorize + token exchange)
5. **Token 過期**: 10 分鐘 (auth code), 30 天 (access token)
6. **Rate Limiting**: OAuth 端點專用限制 ✅ (2026-01-28 新增)
7. **Cookie HttpOnly**: 防止 XSS 竊取 session ✅ (2026-01-28 新增)
8. **XSS 防護**: HTML escape 所有動態內容 ✅ (2026-01-28 新增)

### ⚠️ 仍需改進的安全措施

| 問題 | 風險等級 | 建議 |
|------|----------|------|
| 沒有驗證 state 參數格式 | 低 | 加入 UUID 格式驗證 |
| Race condition (並發 token exchange) | 低 | 使用 pessimistic lock |

---

## 建議的改進

### ✅ 高優先級 (已完成)

1. ~~**加入 Rate Limiting** (Rails)~~ ✅
   - 在 `config/initializers/rack_attack.rb` 新增 OAuth 端點限制

2. ~~**修復 XSS 風險** (Worker)~~ ✅
   - 在 `src/worker/oauth.ts` 新增 `escapeHtml()` 函數

3. ~~**加入 redirect_uri 驗證** (ExchangeTokenService)~~ ✅
   - Service 現在接受並驗證 `redirect_uri` 參數

4. ~~**Cookie HttpOnly** (Worker)~~ ✅
   - 使用 `Set-Cookie` header 設定 `HttpOnly; Secure; SameSite=Strict`

### 中優先級

1. 加入過期 authorization codes 清理 job
2. 加入 Worker 整合測試
3. 加入 OAuth 端到端測試
4. 實作完整的 MCP transport

### 低優先級

1. 加入 Swagger 文件
2. 支援自訂域名的 redirect_uri
3. 優化 MCP Server 創建（cache/singleton）

---

## 測試改進計畫

### Rails 需要新增的測試

```ruby
# spec/services/oauth/exchange_token_service_spec.rb

context "with unknown code_challenge_method" do
  let!(:authorization_code) do
    create(:oauth_authorization_code,
      user: user,
      code_challenge: "challenge",
      code_challenge_method: "SHA1"  # 不支援的方法
    )
  end

  it "returns invalid_grant error" do
    result = service.call
    expect(result).not_to be_success
  end
end

context "with concurrent requests (race condition)" do
  it "only allows one successful exchange" do
    # 使用 threads 測試並發
  end
end
```

```ruby
# spec/requests/api/v1/oauth_spec.rb

describe "end-to-end OAuth flow" do
  it "completes full authorization flow" do
    # 1. GET authorize
    # 2. POST authorize (confirm)
    # 3. Extract code from redirect
    # 4. POST token
    # 5. Verify token works
  end
end
```

### Worker 需要新增的測試

```typescript
// tests/worker/routes.test.ts

describe('OAuth Routes Integration', () => {
  describe('GET /auth/login', () => {
    it('should redirect to Slima authorize endpoint');
    it('should store state and code_verifier in KV');
  });

  describe('GET /callback', () => {
    it('should handle successful authorization');
    it('should handle access_denied error');
    it('should handle expired state');
    it('should handle token exchange failure');
  });

  describe('POST /auth/logout', () => {
    it('should delete session from KV');
  });

  describe('GET /auth/status', () => {
    it('should return authenticated: true when session exists');
    it('should return authenticated: false when no session');
  });
});
```

---

## 結論

整體程式碼品質良好，**所有必須修復的安全問題已解決**。

### ✅ 已完成 (2026-01-28)

1. **Rate Limiting** - rack_attack.rb OAuth 端點限制
2. **Cookie HttpOnly** - Worker Set-Cookie header
3. **XSS 防護** - Worker escapeHtml()
4. **redirect_uri 驗證** - ExchangeTokenService 驗證

### 🔜 部署前建議 (可選)

1. 加入過期 authorization codes 清理 job
2. 加入 Worker 整合測試
3. 加入 OAuth 端到端測試

### 📋 可延後

1. 加入 Swagger 文件
2. 支援自訂域名的 redirect_uri
3. 優化 MCP Server 創建（cache/singleton）

**結論：OAuth 安全性已達到部署標準。**
