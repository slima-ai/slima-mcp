# CLAUDE.md - Slima MCP Server

> 此文件提供 Claude Code 理解專案的必要上下文。

## 專案概述

**Slima MCP Server** 是一個 MCP (Model Context Protocol) 伺服器，讓 AI 工具（如 Claude Desktop、Cursor、Clawdbot）能夠與 Slima 書籍管理和 AI Beta Reader 功能互動。

### 架構定位

```
┌─────────────────┐     MCP (STDIO)     ┌─────────────────┐     HTTP/REST     ┌─────────────────┐
│  Claude Desktop │ ◄─────────────────► │  slima-mcp-     │ ◄───────────────► │   slima_rails   │
│  Cursor / etc.  │                     │  server         │                   │   (API)         │
└─────────────────┘                     └─────────────────┘                   └─────────────────┘
     AI 工具                              Thin Client                          業務邏輯
```

**Thin Client 架構**：
- MCP Server 只負責協議轉換，不包含業務邏輯
- 所有資料驗證、權限控制、AI 處理都在 Rails API 端
- 保持 MCP Server 輕量，易於維護和升級

---

## 技術棧

| 類別 | 技術 | 版本 |
|------|------|------|
| Runtime | Node.js | 20+ |
| Language | TypeScript | 5.x |
| MCP SDK | @modelcontextprotocol/sdk | 1.x |
| Validation | Zod | 3.x |
| Build | tsup | 8.x |
| Testing | Vitest | 2.x |

---

## 目錄結構

```
slima-mcp-server/
├── src/
│   ├── api/
│   │   ├── client.ts      # Slima API Client (HTTP 請求)
│   │   ├── types.ts       # TypeScript 型別定義
│   │   └── index.ts       # 匯出
│   ├── tools/
│   │   ├── books.ts       # 書籍工具 (4 tools)
│   │   ├── content.ts     # 內容工具 (1 tool)
│   │   ├── beta-reader.ts # Beta Reader 工具 (2 tools)
│   │   └── index.ts       # 匯出
│   ├── utils/
│   │   ├── errors.ts      # 錯誤類別和格式化
│   │   └── logger.ts      # 日誌 (輸出到 stderr)
│   ├── server.ts          # MCP Server 工廠
│   └── index.ts           # CLI 入口點
├── tests/
│   ├── api/
│   │   └── client.test.ts # API Client 測試
│   ├── tools/
│   │   ├── books.test.ts        # 書籍工具測試
│   │   ├── content.test.ts      # 內容工具測試
│   │   └── beta-reader.test.ts  # Beta Reader 測試
│   └── server.test.ts     # Server 初始化測試
├── dist/                  # 編譯輸出 (gitignored)
├── package.json
├── tsconfig.json
├── tsup.config.ts         # Build 設定 (含 shebang)
├── vitest.config.ts       # 測試設定
└── README.md              # 使用者文件
```

---

## MCP Tools 對照表

### 與 Rails API 的對應關係

| MCP Tool | Rails API Endpoint | 說明 |
|----------|-------------------|------|
| `list_books` | `GET /api/v1/books` | 列出所有書籍 |
| `get_book` | `GET /api/v1/books/:token` | 取得書籍詳情 |
| `get_book_structure` | `GET /api/v1/books/:token/commits?limit=1` | 從最新 commit 取得檔案結構 |
| `get_writing_stats` | `GET /api/v1/books/:token` + `commits` | 計算寫作統計 |
| `get_chapter` | `POST /api/v1/books/:token/blobs/download` | 下載章節內容 |
| `list_personas` | `GET /api/v1/personas` | 列出虛擬讀者 |
| `analyze_chapter` | `POST /api/v1/reader-tests` | 執行 AI Beta Reader 分析 |

### Tool 參數說明

```typescript
// list_books - 無參數

// get_book
{ book_token: string }  // e.g., "bk_abc123"

// get_book_structure
{ book_token: string }

// get_writing_stats
{ book_token: string }

// get_chapter
{
  book_token: string,
  file_path: string  // 支援多種格式：
                     // - 完整路徑: "/chapters/01.md"
                     // - 相對路徑: "chapters/01.md"
                     // - 檔名: "01.md"
                     // - Token: "ch01"
}

// list_personas
{ genre?: string }  // e.g., "fantasy", "romance"

// analyze_chapter
{
  book_token: string,
  file_path: string,
  persona_token: string  // e.g., "psn_xxx"
}
```

---

## API Client 說明

### SlimaApiClient

```typescript
class SlimaApiClient {
  constructor(config: { token: string; baseUrl?: string })

  // 書籍
  listBooks(): Promise<Book[]>
  getBook(token: string): Promise<Book>

  // 版本控制
  listCommits(bookToken: string, limit?: number): Promise<Commit[]>
  downloadBlobs(bookToken: string, hashes: string[]): Promise<Blob[]>

  // Beta Reader
  listPersonas(genre?: string): Promise<Persona[]>
  createReaderTest(bookToken: string, params: CreateReaderTestParams): Promise<ReaderTest>
  getReaderTestProgress(bookToken: string, testToken: string): Promise<ReaderTestProgress>
  getReaderTest(bookToken: string, testToken: string): Promise<ReaderTest>
}
```

### 錯誤處理

```typescript
// 錯誤類別對應
class AuthenticationError   // 401 - Token 無效或過期
class NotFoundError         // 404 - 資源不存在
class InsufficientCreditsError  // 402 - 點數不足
class SlimaApiError         // 其他 API 錯誤
```

---

## 開發指令

```bash
# 安裝依賴
npm install

# 開發模式（監聽變更）
npm run dev

# 編譯
npm run build

# 執行測試
npm test

# 測試（含覆蓋率）
npm test -- --coverage

# 執行單一測試檔案
npm test -- tests/tools/content.test.ts

# 類型檢查
npx tsc --noEmit
```

---

## 測試指南

### 測試模式

使用 **Handler Capture Pattern** 測試工具：

```typescript
// 1. 捕獲 handler
const toolHandlers = new Map<string, Function>();
vi.spyOn(server, 'tool').mockImplementation(
  (name, _desc, _schema, handler) => {
    toolHandlers.set(name, handler);
    return server;
  }
);

// 2. 註冊工具
registerXxxTools(server, mockClient);

// 3. 呼叫 handler 測試
const handler = toolHandlers.get('tool_name')!;
const result = await handler({ param: 'value' });

// 4. 驗證結果
expect(result.content[0].text).toContain('expected');
```

### 測試覆蓋率目標

| 檔案類型 | 目標覆蓋率 |
|----------|-----------|
| API Client | > 80% |
| Tools | > 70% |
| Utils | > 60% |
| 整體 | > 70% |

---

## 重要注意事項

### MCP STDIO 模式

- **日誌必須輸出到 stderr**，不能用 stdout
- stdout 保留給 MCP JSON-RPC 通訊
- 使用 `logger.info()` / `logger.error()` 而非 `console.log()`

### Token 格式

遵循 Slima Rails 的 Token 規則：

| 類型 | Prefix | 範例 |
|------|--------|------|
| Book | `bk_` | `bk_abc123def456gh` |
| Commit | `cmt_` | `cmt_abc123def456gh` |
| Persona | `psn_` | `psn_abc123def456gh` |
| Reader Test | `rpt_` | `rpt_abc123def456gh` |

### 檔案路徑搜尋

`get_chapter` 和 `analyze_chapter` 支援靈活的路徑搜尋：

1. 完整路徑（大小寫不敏感）
2. 相對路徑
3. 只用檔名
4. 使用 Token

搜尋會遞迴進入資料夾，找到第一個匹配的檔案。

---

## 與 slima_rails 的關係

### 依賴關係

```
slima-mcp-server (此專案)
    │
    └── 呼叫 ──► slima_rails API
                    │
                    ├── /api/v1/books
                    ├── /api/v1/personas
                    ├── /api/v1/reader-tests
                    └── /api/v1/books/:token/blobs/download
```

### 認證機制

使用 **Bearer Token** 認證：

1. 使用者在 Slima 設定頁面產生 API Token
2. Token 以 `slima_` 開頭
3. MCP Server 透過 `Authorization: Bearer {token}` 呼叫 API

### 資料同步

- MCP Server **不儲存任何資料**
- 每次工具呼叫都即時從 Rails API 取得
- 版本控制資料來自 Commit 的 `filesSnapshot`

---

## 未來擴展

### 可能新增的 Tools

| Tool | 用途 | 優先級 |
|------|------|--------|
| `list_commits` | 列出版本歷史 | 中 |
| `compare_commits` | 比較兩個版本 | 低 |
| `search_content` | 全書搜尋 | 中 |
| `get_outline` | 取得大綱 | 中 |

### Resources 和 Prompts

MCP 還支援 Resources 和 Prompts，目前未實作：

- **Resources**: 可將書籍內容作為 context 提供
- **Prompts**: 預設的寫作指令模板

---

## 常見問題

### Q: 為什麼 logs 輸出到 stderr？

MCP 使用 STDIO 傳輸，stdout 用於 JSON-RPC 通訊。任何非 JSON-RPC 的輸出都會破壞協議。

### Q: 為什麼不直接在 MCP Server 實作業務邏輯？

Thin Client 架構的優點：
1. 安全性 - 權限控制集中在 Rails
2. 一致性 - Web/Mobile/MCP 共用相同邏輯
3. 維護性 - MCP Server 保持輕量

### Q: Token 驗證失敗怎麼辦？

1. 確認 Token 以 `slima_` 開頭
2. 確認 Token 未過期或撤銷
3. 檢查 Rails API 是否正常運作

---

## 版本資訊

- **Version**: 0.1.0
- **MCP Protocol**: 1.x
- **最後更新**: 2026-01-27
