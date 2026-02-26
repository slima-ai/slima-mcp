# Claude.ai MCP Connector 修復計畫

> 目標：讓 Slima MCP Server 能在 claude.ai Connectors 正常連線，並發布到 MCP Registry。
> 建立日期：2026-02-26

## 錯誤訊息

```
McpAuthorizationError: Your account was authorized but the integration rejected
the credentials, so the connection was reverted. Try connecting again.
Reference: "9ef231a0bd926f1a"
```

**含義**：OAuth flow 成功（帳戶已授權），但 Claude.ai 拿到的 token 去呼叫 `/mcp` 時被拒絕。

---

## TODO List

### Phase 1：診斷與修復 OAuth 認證問題

- [x] **1.1 修正 `getTokenFromSession()` token 格式驗證** ✅
  - 檔案：`src/worker/oauth.ts`
  - 問題：只接受 `slima_` 開頭的 Bearer token，但 OAuth flow 產生的 token 可能不是這個格式
  - 修復：接受所有非空 Bearer token，`slima_` 開頭的直接使用，其他格式的也放行讓 Rails API 驗證

- [x] **1.2 增加 OAuth endpoints debug logging** ✅
  - 在 `/authorize`, `/callback`, `/token`, `/register` 增加詳細 logging
  - 在 `requireAuth` middleware 增加 logging
  - 在 `.well-known` endpoints 增加 logging
  - 方便用 `wrangler tail` 觀察 Claude.ai 的實際行為

- [x] **1.3 確認 DCR endpoint 與 .well-known 端點正確性** ✅
  - DCR `/register` 正確 proxy 到 Rails，增加了詳細 logging
  - `.well-known/oauth-protected-resource` 和 path suffix variant 都正確
  - `.well-known/oauth-authorization-server` 和 path suffix variant 都正確
  - 所有 endpoint 都有 CORS 支援

- [x] **1.4 修正 requireAuth 401 回應格式** ✅
  - 移除 `WWW-Authenticate` 中多餘的 `scope` 參數（簡化，避免格式問題）
  - `resource_metadata` 正確指向 `/.well-known/oauth-protected-resource`

- [ ] **1.5 部署 Worker 並用 `wrangler tail` 監控**
  - `npm run deploy:worker`
  - `wrangler tail slima-mcp`
  - 在 claude.ai Settings > Connectors 重新連線
  - 記錄完整的請求順序和回應

- [ ] **1.6 使用 MCP Inspector 端對端測試 OAuth flow**
  - `npx @modelcontextprotocol/inspector`
  - 選 Streamable HTTP → `https://mcp.slima.ai/mcp`
  - 走完 OAuth flow，驗證 token 格式

### Phase 2：發布到 MCP Registry

- [x] **2.1 在 `package.json` 加入 `mcpName`** ✅
  - 已加入 `"mcpName": "io.github.slima-ai/slima"`

- [x] **2.2 建立 `server.json` 描述檔** ✅
  - 包含 npm package 資訊（stdio transport）
  - 包含 remote server 資訊（streamable-http → `https://mcp.slima.ai/mcp`）

- [ ] **2.3 安裝 `mcp-publisher` CLI**
  - `curl` 或 `brew install mcp-publisher`

- [ ] **2.4 認證並發布到 Registry**
  - `mcp-publisher login github`
  - `mcp-publisher publish`
  - 驗證：`curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=slima"`

### Phase 3：發布 npm 新版本

- [ ] **3.1 更新版本號**
- [x] **3.2 確保所有測試通過** ✅ (168 tests, 15 files, all passing)
- [ ] **3.3 發布 npm + 部署 Worker**

---

## 已完成的程式碼變更

### 1. `src/worker/oauth.ts` - getTokenFromSession()
```diff
- if (token.startsWith('slima_')) {
-   return token;
- }
+ if (token) {
+   if (token.startsWith('slima_')) {
+     return token;
+   }
+   // OAuth access tokens: let Rails API validate
+   return token;
+ }
```

### 2. `src/worker/oauth.ts` - 增加 logging
- `/authorize`: 記錄完整參數（clientId, redirectUri, scope, codeChallenge 等）
- `/token`: 記錄 token prefix 和 expires_in
- `/register` (DCR): 記錄 client_name, redirect_uris, grant_types
- `/callback`: 記錄 AI client flow 的 redirectUri 和 codeChallenge

### 3. `src/worker/index.ts` - requireAuth middleware
- 增加 debug logging（method, path, auth header prefix）
- 簡化 `WWW-Authenticate` header（移除可能導致問題的 scope 參數）

### 4. `src/worker/index.ts` - .well-known endpoints
- 所有 .well-known endpoints 增加 logging

### 5. `package.json` - mcpName
- 新增 `"mcpName": "io.github.slima-ai/slima"`

### 6. `server.json` - MCP Registry 描述檔（新檔案）

---

## 技術細節

### Claude.ai OAuth Flow（預期）

```
1. 使用者在 claude.ai Settings > Connectors 加入 https://mcp.slima.ai/mcp
2. Claude.ai 查詢 GET /.well-known/oauth-protected-resource/mcp
   → 得到 authorization_servers: ["https://mcp.slima.ai"]
3. Claude.ai 查詢 GET /.well-known/oauth-authorization-server
   → 得到 authorization_endpoint, token_endpoint, registration_endpoint
4. Claude.ai POST /register (DCR)
   → 得到 client_id, client_secret(optional)
5. Claude.ai 開啟瀏覽器 GET /authorize?client_id=...&redirect_uri=https://claude.ai/api/mcp/auth_callback&...
   → Worker redirect 到 Rails OAuth → 使用者授權 → Rails redirect 回 Worker /callback
   → Worker 產生 auth code → redirect 到 claude.ai callback
6. Claude.ai POST /token (exchange auth code for access_token)
   → 得到 access_token
7. Claude.ai POST /mcp (Authorization: Bearer {access_token})
   → MCP 工具呼叫
```

---

## 參考連結

- [Claude Help Center: Building custom connectors](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)
- [MCP connector API Docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [GitHub Issue #5: OAuth Broken](https://github.com/anthropics/claude-ai-mcp/issues/5)
- [MCP Auth Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [MCP Registry GitHub](https://github.com/modelcontextprotocol/registry)
- [MCP Registry Quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
