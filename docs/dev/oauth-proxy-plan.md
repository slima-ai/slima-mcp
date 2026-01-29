# OAuth Proxy 實作計畫

> 日期：2026-01-29
> 狀態：進行中
> 目標：讓 Claude.ai 可以透過標準 OAuth 2.1 流程連接

---

## 問題分析

### Claude.ai OAuth 流程

```
1. Claude.ai → GET /.well-known/oauth-authorization-server
   取得 OAuth endpoints

2. Claude.ai → POST /register
   Dynamic Client Registration (RFC 7591)

3. Claude.ai → GET /authorize?client_id=xxx&redirect_uri=xxx&...
   開始 OAuth 流程

4. 用戶在 Rails 登入並授權

5. Rails → redirect to /callback?code=xxx&state=xxx

6. Claude.ai → POST /token
   交換 code 取得 access_token

7. Claude.ai → POST /mcp with Authorization: Bearer xxx
   使用 token 呼叫 MCP
```

### 現有問題

`/.well-known/oauth-authorization-server` 回傳：
```json
{
  "authorization_endpoint": "https://api.slima.ai/api/v1/oauth/authorize",  // ❌ 不同 domain
  "token_endpoint": "https://api.slima.ai/api/v1/oauth/token"               // ❌ 不同 domain
}
```

Claude.ai 期望：
```json
{
  "authorization_endpoint": "https://mcp.slima.ai/authorize",  // ✅ 同一 domain
  "token_endpoint": "https://mcp.slima.ai/token"               // ✅ 同一 domain
}
```

---

## 解決方案

### 架構：Worker 作為 OAuth Proxy

```
Claude.ai                    MCP Worker                      Rails API
    │                            │                              │
    │ GET /.well-known/oauth-... │                              │
    │ ─────────────────────────► │                              │
    │ ◄───────────────────────── │ (endpoints 指向 Worker)      │
    │                            │                              │
    │ POST /register             │                              │
    │ ─────────────────────────► │ ─────────────────────────► │
    │ ◄───────────────────────── │ ◄───────────────────────── │
    │                            │                              │
    │ GET /authorize             │                              │
    │ ─────────────────────────► │                              │
    │                            │ redirect to Rails /oauth/authorize
    │ ◄───────────────────────────────────────────────────────│
    │                            │                              │
    │          (用戶在 Rails 授權)                              │
    │ ◄───────────────────────────────────────────────────────│
    │ redirect to /callback      │                              │
    │ ─────────────────────────► │                              │
    │                            │ exchange code with Rails     │
    │                            │ ─────────────────────────► │
    │                            │ ◄───────────────────────── │
    │ ◄───────────────────────── │ redirect to Claude callback │
    │                            │                              │
    │ POST /token                │                              │
    │ ─────────────────────────► │ proxy to Rails /oauth/token  │
    │                            │ ─────────────────────────► │
    │                            │ ◄───────────────────────── │
    │ ◄───────────────────────── │ return access_token         │
    │                            │                              │
    │ POST /mcp (Bearer token)   │                              │
    │ ─────────────────────────► │ validate & call Rails API   │
```

---

## 實作步驟

### Step 1: 更新 Well-Known Endpoints

修改 `/.well-known/oauth-authorization-server` 指向 Worker endpoints：

```typescript
app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: ['read', 'write'],
  });
});
```

### Step 2: 新增 /authorize Endpoint

處理 OAuth 授權請求，將用戶導向 Rails：

```typescript
app.get('/authorize', async (c) => {
  // 取得 Claude.ai 傳來的參數
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const state = c.req.query('state');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method');
  const scope = c.req.query('scope');
  const responseType = c.req.query('response_type');

  // 驗證必要參數
  if (!clientId || !redirectUri || !state) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  // 儲存 OAuth 請求資訊（用於 callback 時還原）
  const oauthState = crypto.randomUUID();
  await c.env.OAUTH_KV.put(`oauth_req:${oauthState}`, JSON.stringify({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
    scope,
  }), { expirationTtl: 600 });

  // 建立 Rails OAuth URL
  const railsAuthUrl = new URL(`${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`);
  railsAuthUrl.searchParams.set('client_id', c.env.OAUTH_CLIENT_ID);  // Worker's client ID
  railsAuthUrl.searchParams.set('redirect_uri', `${new URL(c.req.url).origin}/callback`);
  railsAuthUrl.searchParams.set('state', oauthState);
  railsAuthUrl.searchParams.set('response_type', 'code');

  return c.redirect(railsAuthUrl.toString());
});
```

### Step 3: 更新 /callback Endpoint

處理 Rails callback，生成 code 給 Claude.ai：

```typescript
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const oauthState = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.html(errorPage(error), 400);
  }

  // 還原原始 OAuth 請求
  const storedData = await c.env.OAUTH_KV.get(`oauth_req:${oauthState}`);
  if (!storedData) {
    return c.html(errorPage('Session expired'), 400);
  }

  const oauthReq = JSON.parse(storedData);
  await c.env.OAUTH_KV.delete(`oauth_req:${oauthState}`);

  // 與 Rails 交換 token
  const tokenResponse = await fetch(`${c.env.SLIMA_API_URL}/api/v1/oauth/token`, {
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
    return c.html(errorPage('Token exchange failed'), 400);
  }

  const { access_token, expires_in } = await tokenResponse.json();

  // 生成新的 authorization code 給 Claude.ai
  const newCode = crypto.randomUUID();
  await c.env.OAUTH_KV.put(`auth_code:${newCode}`, JSON.stringify({
    accessToken: access_token,
    clientId: oauthReq.clientId,
    redirectUri: oauthReq.redirectUri,
    codeChallenge: oauthReq.codeChallenge,
    codeChallengeMethod: oauthReq.codeChallengeMethod,
    expiresIn: expires_in,
  }), { expirationTtl: 600 });

  // Redirect 回 Claude.ai
  const callbackUrl = new URL(oauthReq.redirectUri);
  callbackUrl.searchParams.set('code', newCode);
  callbackUrl.searchParams.set('state', oauthReq.state);

  return c.redirect(callbackUrl.toString());
});
```

### Step 4: 新增 /token Endpoint

處理 Claude.ai 的 token 請求：

```typescript
app.post('/token', async (c) => {
  const body = await c.req.parseBody();
  const grantType = body.grant_type;
  const code = body.code as string;
  const clientId = body.client_id;
  const codeVerifier = body.code_verifier as string;
  const redirectUri = body.redirect_uri;

  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }

  // 取得儲存的 auth code 資訊
  const storedData = await c.env.OAUTH_KV.get(`auth_code:${code}`);
  if (!storedData) {
    return c.json({ error: 'invalid_grant', error_description: 'Code expired or invalid' }, 400);
  }

  const authData = JSON.parse(storedData);
  await c.env.OAUTH_KV.delete(`auth_code:${code}`);

  // 驗證 client_id
  if (authData.clientId !== clientId) {
    return c.json({ error: 'invalid_client' }, 400);
  }

  // 驗證 redirect_uri
  if (authData.redirectUri !== redirectUri) {
    return c.json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' }, 400);
  }

  // 驗證 PKCE code_verifier
  if (authData.codeChallenge && codeVerifier) {
    const challenge = await generateCodeChallenge(codeVerifier);
    if (challenge !== authData.codeChallenge) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

  // 回傳 token（直接使用 Rails 的 token）
  return c.json({
    access_token: authData.accessToken,
    token_type: 'Bearer',
    expires_in: authData.expiresIn || 3600,
    scope: 'read write',
  });
});
```

### Step 5: 更新 Token 驗證

修改 `getTokenFromSession` 直接驗證 Rails token：

```typescript
export async function getTokenFromSession(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // 直接回傳 token，讓 Rails API 驗證
    if (token.startsWith('slima_')) {
      return token;
    }
  }
  return null;
}
```

---

## 檔案變更

| 檔案 | 變更 |
|------|------|
| `src/worker/index.ts` | 新增 /authorize, /token endpoints |
| `src/worker/oauth.ts` | 更新 callback 處理、新增 PKCE 驗證 |

---

## 測試計畫

1. **Unit Tests**
   - PKCE verification
   - Token exchange
   - State management

2. **Integration Tests**
   - 完整 OAuth 流程
   - Claude.ai 模擬測試

3. **Manual Testing**
   - Claude.ai 實際連接測試

---

## 部署步驟

1. 更新程式碼
2. `npm run deploy:worker`
3. 在 Claude.ai 測試連接
