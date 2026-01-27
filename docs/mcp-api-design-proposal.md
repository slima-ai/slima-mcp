# MCP API 設計提案

> 日期：2026-01-27
> 狀態：提案討論（已更新架構分析）

---

## 架構分析

### 現有系統架構

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   AI (Claude)   │ ←──→ │   Rails API     │ ←──→ │   Frontend      │
│   Web Chat      │      │   (橋接)         │      │   (IndexedDB)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                              │                         │
                              │ 定義 tools              │ 執行 tools
                              │ (ToolRegistry)          │ (實際操作)
                              ▼                         ▼
                      read, search, edit...      IndexedDB 虛擬檔案系統
```

**關鍵理解**：現有 AI Tools (read, search, edit) 都在**前端 IndexedDB** 執行，Rails 只是定義工具、橋接對話。

### 資料儲存方式

| 資料類型 | 儲存位置 | 格式 |
|---------|---------|------|
| 章節 | `/chapters/*.md` | Markdown |
| 角色設定 | `/characters/*.md` | Markdown |
| 世界觀 | `/worldbuilding/*.md` | Markdown |
| 大綱 | `/outline.md` | Markdown |
| 關係圖 | `*.map` | JSON |
| 所有設定 | 書籍內檔案 | 無獨立 DB 表 |

### MCP 的挑戰

MCP Server **無法存取前端 IndexedDB**，需要**後端版本的操作**：

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Claude Desktop │ ←──→ │  MCP Server     │ ←──→ │   Rails API     │
│  Cursor / etc.  │      │  (Thin Client)  │      │   (需擴充)       │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                                        │
                                                        ▼
                                              Commits + Blobs (PostgreSQL)
```

---

## 問題分析

### 目前 MCP Server 的限制

| 操作類型 | 目前狀態 | 問題 |
|----------|----------|------|
| 讀取單檔 | ✅ 可行 | 需要 3 次 API call |
| 讀取多檔 | ⚠️ 低效 | N 個檔案 = N 次 blob download |
| 全書搜尋 | ❌ 不支援 | 需下載所有 blob 在 MCP 端搜尋 |
| 寫入檔案 | ❌ 不支援 | 需 5-6 步驟，易出錯 |
| 角色/設定 | ⚠️ 特殊 | 是檔案，不是 DB 表 |

### AI 協作的核心需求

從 Use Cases 分析，AI 需要：

1. **快速讀取上下文** - 一次取得多個相關檔案
2. **語意搜尋** - 找角色、場景、伏筆
3. **原子寫入** - 一個 API call 完成檔案修改
4. **版本控制** - AI 修改應建立 commit 或分支

---

## 提案 A：擴充現有 API（推薦）

### 原則
- 不破壞現有 API
- 新增 MCP 友好的 endpoint
- 後端處理複雜邏輯

### 新增 API Endpoints

#### 1. 批量讀取 (Bulk Read)

```http
POST /api/v1/books/:book_token/files/bulk-read
Content-Type: application/json

{
  "paths": [
    "chapters/01.md",
    "chapters/02.md",
    "settings/characters.json"
  ],
  "include_metadata": true
}
```

**Response:**
```json
{
  "data": {
    "files": [
      {
        "path": "chapters/01.md",
        "name": "第一章",
        "content": "章節內容...",
        "wordCount": 3500,
        "blobHash": "sha256:..."
      }
    ],
    "commit": {
      "token": "cmt_xxx",
      "createdAt": "2026-01-27T..."
    }
  }
}
```

**用途**：AI 一次讀取所需的所有上下文

#### 2. 全書搜尋 (Search)

```http
POST /api/v1/books/:book_token/search
Content-Type: application/json

{
  "query": "李明",
  "options": {
    "matchType": "fuzzy",      // exact | fuzzy | regex
    "scope": "manuscript",      // all | manuscript | notes
    "contextLines": 3,          // 前後幾行
    "limit": 50
  }
}
```

**Response:**
```json
{
  "data": {
    "results": [
      {
        "file": {
          "path": "chapters/01.md",
          "name": "第一章"
        },
        "matches": [
          {
            "line": 45,
            "text": "李明走進房間，環顧四周。",
            "context": {
              "before": ["門緩緩打開。"],
              "after": ["房間裡空無一人。"]
            },
            "highlight": [0, 2]  // 高亮位置
          }
        ]
      }
    ],
    "total": 23,
    "truncated": false
  }
}
```

**用途**：角色追蹤、一致性檢查、找伏筆

#### 3. 原子寫入 (Atomic Write)

```http
POST /api/v1/books/:book_token/files/write
Content-Type: application/json

{
  "operations": [
    {
      "action": "update",        // create | update | delete
      "path": "chapters/03.md",
      "content": "更新後的內容...",
      "expectedBlobHash": "sha256:old..."  // 樂觀鎖
    },
    {
      "action": "create",
      "path": "notes/ai-suggestions.md",
      "content": "AI 建議內容..."
    }
  ],
  "commitMessage": "AI: 更新第三章並新增建議",
  "commitType": "auto",
  "branchToken": "br_xxx"       // 可選，預設 default branch
}
```

**Response:**
```json
{
  "data": {
    "commit": {
      "token": "cmt_new",
      "name": "AI: 更新第三章並新增建議",
      "filesAffected": 2
    },
    "results": [
      { "path": "chapters/03.md", "status": "updated" },
      { "path": "notes/ai-suggestions.md", "status": "created" }
    ]
  }
}
```

**錯誤處理:**
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "File was modified since last read",
    "details": {
      "path": "chapters/03.md",
      "expectedHash": "sha256:old...",
      "actualHash": "sha256:new..."
    }
  }
}
```

**用途**：AI 寫作、批量修改、自動更新

#### 4. AI 分支操作

```http
POST /api/v1/books/:book_token/branches/ai-workspace
Content-Type: application/json

{
  "name": "AI Draft - Chapter 15",
  "fromCommitToken": "cmt_xxx"   // 可選
}
```

**自動命名**: `ai-draft-{timestamp}` 或用戶指定

**用途**：AI 修改在獨立分支，使用者決定是否合併

---

## 提案 B：智慧檔案讀取 API

### 說明
角色、世界觀、大綱都是**書籍內的 Markdown 檔案**，不是獨立資料表。
需要提供智慧讀取功能，自動找到相關檔案。

#### 自動探索 API

```http
GET /api/v1/books/:book_token/context
Content-Type: application/json

{
  "include": ["characters", "worldbuilding", "outline", "recent_chapters"],
  "maxFiles": 10,
  "maxContentSize": 50000  // 字元上限
}
```

**後端邏輯：**
```ruby
# 自動探索常見路徑
CONTEXT_PATTERNS = {
  characters: ['/characters/**/*.md', '/角色/**/*.md', '/settings/characters*.md'],
  worldbuilding: ['/worldbuilding/**/*.md', '/世界觀/**/*.md', '/settings/world*.md'],
  outline: ['/outline*.md', '/大綱*.md', '/plot/**/*.md'],
  recent_chapters: -> { recent_modified_files(kind: 'chapter', limit: 3) }
}
```

**Response:**
```json
{
  "data": {
    "characters": [
      {
        "path": "/characters/李明.md",
        "name": "李明.md",
        "content": "# 李明\n\n主角，28歲工程師...",
        "wordCount": 500
      }
    ],
    "worldbuilding": [...],
    "outline": [...],
    "recent_chapters": [...],
    "totalFiles": 8,
    "totalSize": 24500
  }
}
```

**用途**：AI 一次取得書籍上下文，不需知道具體路徑

---

## 提案 C：MCP 專用 Endpoints（可選）

如果要完全優化 MCP 體驗，可以加一層專用 API：

```http
# 命名空間
/api/v1/mcp/books/:book_token/...

# 合併多個操作
POST /api/v1/mcp/books/:book_token/context
{
  "include": ["chapter:current", "chapter:previous", "characters:mentioned", "worldbuilding"],
  "currentFile": "chapters/05.md"
}

# AI 任務執行
POST /api/v1/mcp/books/:book_token/ai-task
{
  "task": "consistency-check",
  "scope": "characters",
  "options": { "autoFix": false }
}
```

**優點**：最佳化 AI 體驗
**缺點**：維護成本高，可能與主 API 不一致

---

## 推薦實施順序

### Phase 1：核心讀取（MVP - 唯讀）

支援 Use Case：深度章節分析、角色一致性檢查、跨書比較

| 優先級 | Rails API | MCP Tool | 用途 |
|--------|-----------|----------|------|
| P0 | `POST /files/bulk-read` | `bulk_read` | 批量讀取多檔 |
| P0 | `POST /search` | `search_book` | 全書關鍵字搜尋 |
| P1 | `GET /context` | `get_context` | 智慧取得上下文 |

### Phase 2：寫入操作

支援 Use Case：AI 協作寫作、更新設定、建立草稿

| 優先級 | Rails API | MCP Tool | 用途 |
|--------|-----------|----------|------|
| P1 | `POST /files/write` | `write_file` | 原子寫入單檔 |
| P1 | `POST /files/batch-write` | `write_files` | 批量寫入 |
| P2 | `POST /branches/ai-workspace` | `create_ai_branch` | AI 專用分支 |

### Phase 3：進階功能

支援 Use Case：版本比較、歷史追蹤

| 優先級 | Rails API | MCP Tool | 用途 |
|--------|-----------|----------|------|
| P2 | `GET /commits/diff` | `compare_versions` | 版本差異 |
| P2 | `GET /commits` | `list_versions` | 版本歷史 |
| P3 | `POST /files/restore` | `restore_file` | 還原檔案 |

---

## MCP Tools 對應

實施上述 API 後，MCP Server 可以提供：

### 讀取類

```typescript
// 批量讀取
bulk_read(book_token, paths: string[])

// 搜尋
search_book(book_token, query, options?)

// 讀取設定
get_characters(book_token)
get_worldbuilding(book_token)
get_outline(book_token)
```

### 寫入類

```typescript
// 更新檔案（自動 commit）
update_file(book_token, path, content, message?)

// 批量更新
update_files(book_token, operations[], message?)

// 在 AI 分支上工作
create_ai_branch(book_token, name?)
```

### 分析類

```typescript
// 一致性檢查
check_consistency(book_token, scope: 'characters' | 'timeline' | 'all')

// 摘要生成
generate_summary(book_token, scope: 'chapter' | 'act' | 'book')
```

---

## 問題待確認

### 已確認 ✅

1. **角色/設定資料目前存在哪裡？**
   - ✅ 都是書籍內的 Markdown 檔案（`/characters/`, `/worldbuilding/` 等）
   - ✅ 儲存在 Blob 中，透過 Commit 的 files_snapshot 追蹤

### 待決定 ❓

2. **AI 修改的版本控制策略？**
   - 選項 A：直接在 default branch 建立 commit（簡單，但使用者需確認）
   - 選項 B：自動建立 AI 分支，使用者決定是否合併（安全，但複雜）
   - 選項 C：混合 - 小修改直接 commit，大改動建立分支
   - **建議**：選項 A，配合 `commitType: 'ai'` 標記，前端可顯示「AI 修改」

3. **搜尋功能的實作方式？**
   - 選項 A：後端即時搜尋 - 下載所有 blob，用 Ruby 搜尋
   - 選項 B：PostgreSQL 全文搜尋 - 需要額外索引表
   - 選項 C：搜尋服務（Elasticsearch/Meilisearch）- 複雜但最佳
   - **建議**：Phase 1 用選項 A（限制檔案數），未來可升級

4. **Rate Limiting 策略？**
   - 現有：auto commit 200 次/分鐘/書
   - **建議**：AI 寫入使用相同限制，搜尋 30 次/分鐘

5. **MCP 認證與一般 API 認證是否分開？**
   - 現有 Bearer Token 應該足夠
   - 是否需要區分「MCP Token」vs「一般 API Token」？
   - **建議**：共用，可在 token metadata 標記來源

---

## 下一步

1. 確認上述問題
2. 選擇實施方案（A / B / C）
3. 設計詳細 API spec
4. Rails 端實作
5. MCP Server 整合

---

*此文件為討論用提案，非最終設計。*
