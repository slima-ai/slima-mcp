# 團隊知識庫 MCP 工具實作計畫

> 日期：2026-07-12
> 狀態：規劃（由 slima_rails 後端 session 撰寫，交棒本 repo 動工）
> 目標：讓外部 MCP client（Claude Desktop、claude.ai connector）可以搜尋/讀寫團隊的共享知識庫
> 對應 slima_rails 的 `TEAM_BACKEND_DEV_PLAN.md` Phase 5.2-5.4

---

## 這份計畫怎麼來的

`slima_rails` repo（Rails 後端）的 Team/DKM 開發計畫走到 Phase 5.2（team MCP 工具）時卡住——計畫原文寫「端點鏡像 `books/:token/mcp` → `teams/:token/mcp`」，但這個 repo（`slima-mcp-server`）此前對後端 session 是不可見的，無法規劃前端＋MCP server 這一半該怎麼接。2026-07-12 確認這個 repo 實際上就在 `slima_rails` 隔壁目錄，可以直接查證+規劃。

**第一個重要發現，會改變原本計畫的形狀**：`books/:token/mcp/files/*` 這條路徑本身已經是**任意 book_token 皆可用**的通用工具（`read_file`/`write_file`/`create_file`/`delete_file`/`append_to_file`/`search_content`，見 `src/core/tools/files.ts`），不是綁死「目前開啟的書」。這代表**大部分情境根本不需要新的 Rails 路由**——只要 MCP client 知道團隊知識庫的 book token，現有的 7 個檔案工具直接就能用在知識庫書上。真正卡住的不是「路由」，是「怎麼發現/怎麼授權/怎麼搜」這三件事，見下面拆解。

---

## 現況盤點

### Rails 後端（`slima_rails`，已完成，本次確認）

- `Team#knowledge_book`（`Team.knowledge_book_id` FK）——每個團隊都有一本知識庫書，`book_type: 'knowledge'`，`Book.accessible_by` 對任何 active 成員（不分角色）皆放行讀取（Phase 2.1 C1）。
- `TeamResource#knowledgeBookToken`——`GET /api/v1/teams`/`GET /api/v1/teams/:token` 回應已經帶團隊的知識庫 book token（2026-07-12 剛修好，見 `TEAM_BACKEND_DEV_PLAN.md` §14.18.1）。
- **知識庫寫入權限**：§5.5 矩陣定案「owner/admin/佔席 writer 皆可寫，只有 editor 被擋」，2026-07-12 查證確認**這條規則此前沒有真的實作**（`Book#writable_by?` 只放行 owner/admin，一般 writer 佔席成員今天打 `POST /books/:knowledge_book_token/commits` 或走 MCP `create_file`/`update_file` 一律 403）——**已同批修復**，`Book#writable_by?` 新增知識庫專屬分支，用既有的 `TeamMembership#editor_only?` 判斷式（見 commit，本文件寫成時該修復正在委派實作中，完成後會更新這段狀態）。
- **MCP token scope 執法**（Phase 5.1，已上線 test）：`api_tokens.scope` 欄位 + `requires_scope` 宣告式 fail-closed 執法——目前唯一宣告的 scope 是 `mcp:books`（`Api::V1::Mcp::FilesController`）。**任何新的團隊 MCP 端點都必須明確 `requires_scope`，否則窄 scope token 一律 403**（這是刻意的安全預設，不是要繞過的障礙）。
- **語意檢索**（`semantic_search`，Team/DKM Phase 2.2，已上線）：目前**只存在於站內 AI 對話的 server tool 攔截機制**（`Conversations::ServerSkillResolver`），跟一般 HTTP API 端點是兩條不同的路——**外部 MCP client 目前完全碰不到這個能力**，這是本計畫要補的最大缺口（見下方「搜」）。

### slima-mcp-server（本 repo，本次首次調查）

- `src/core/tools/` 下 15 個既有工具，双執行環境（CLI stdio + Cloudflare Worker remote HTTP）共用同一份工具定義（`src/core/tools/index.ts`）。
- 認證：Bearer token（CLI 走 `SLIMA_API_TOKEN`/`~/.slima/credentials.json`，Worker 走完整 OAuth 2.0 + PKCE，兩者最終都是對 Rails 送 `Authorization: Bearer {token}`）。
- `SlimaApiClient`（`src/core/api/client.ts`）是唯一跟 Rails REST API 對話的地方，每個工具都透過它呼叫。
- **零團隊相關程式碼**（廣泛 grep 確認）——這是全新開發，沒有半成品可以延續。
- 已有獨立的 test 環境（`wrangler.toml` 的 `env.test`：`test-mcp.slima.ai` → `test-api.slima.ai`），跟 `slima_rails` 的 test/prod 分離慣例對齊，**這就是本計畫的驗收環境**，不用另外搭。
- `docs/dev/` 已有三份既存規劃文件（`remote-mcp-server-plan.md`/`worker-transport-refactor-plan.md`/`oauth-proxy-plan.md`），都是 transport/auth 架構，跟本計畫互補不衝突。

---

## 設計：三個子問題，各自獨立

### 1. 發現（Discovery）——team 知識庫 token 怎麼讓 AI 知道

**新增 2 個工具**（`src/core/tools/teams.ts`，新檔案，仿 `books.ts` 的 `list_books`/`get_book` 寫法）：

- `list_teams` — 呼叫既有 `GET /api/v1/teams`（Rails 端零改動，已經回傳 `knowledgeBookToken`）。回傳「使用者屬於哪些團隊 + 每個團隊的知識庫 book token」。
- `get_team` — 呼叫既有 `GET /api/v1/teams/:token`（同上，零 Rails 改動）。

**這一步做完，既有的 7 個檔案工具（`read_file`/`write_file`/`create_file`/`delete_file`/`append_to_file`/`edit_file`/`search_content`）對知識庫書就直接可用**（前提是知識庫寫入權限修復已上線——見上方「現況」）。這是最小可行的第一片交付，工程量很小、零 Rails 新路由。

### 2. 搜（語意檢索）——真正的缺口

`semantic_search` 目前只活在站內對話流程裡（`Ai::BookSemanticQuery` 被 `Conversations::ServerSkillResolver` 呼叫，綁定 conversation 的節流/計費邏輯）。要讓外部 MCP client 也能用，**需要一個新的、獨立於對話情境的 Rails 端點**：

**Rails 側新增**（不是「鏡像 teams/:token/mcp」，是給任意書一個直接可呼叫的語意檢索端點）：
```ruby
scope 'books/:book_token/mcp' do
  post 'semantic_search', to: 'mcp/semantic_search#create'
end
```
- 新 controller 直接呼叫 `Ai::BookSemanticQuery.new(book:, user:, query:).call`——**不透過 `ServerSkillResolver`**（那條路徑綁死 conversation 節流/去重，MCP 呼叫沒有 conversation 概念）。
- **B11 週上限（editor team pool 週上限）跟這個新端點的關係要想清楚**：如果 MCP 呼叫的使用者是 editor 角色，該不該套用一樣的 team pool 週上限？建議套用同一套邏輯（`Ai::BookSemanticQuery#check_credits!` 已經內建這個判斷，直接重用零額外程式碼）。
- **`requires_scope 'mcp:books'`**（沿用既有 scope，這是書級操作，不是團隊級——語意檢索作用在某一本書，跟 `read_file`/`search_content` 同一個 scope 分類）。
- 回應格式沿用 `format_search_results` 現成的 `[[§N@file_token]]` 引用格式（2026-07-12 才修好的跨檔案消歧義格式，MCP 這條新路徑天生受益，不用重新設計）。

**slima-mcp-server 側**：新增 `semantic_search` 工具（`src/core/tools/knowledge.ts` 或併入 `files.ts`），呼叫上述新端點，工具描述文字直接照抄 Rails `ToolRegistry` 裡 `semantic_search` 工具描述的最新版本（含 `[[§N@file_token]]` 引用規則說明），維持兩邊 AI 使用體驗一致。

### 3. 團隊記憶/技能/規則（選配，非本輪必要）

`team_memories`/`team_skills`/`team_rules` 目前只有 REST API（`GET /api/v1/teams/:token/{memories,skills,rules}`），沒有對應 MCP 工具。**建議列為本計畫完成核心（發現+搜）之後的第二輪**，不是同批必要項——這三者的讀取權限本來就對任何 active 成員開放，加 `list_team_memories`/`list_team_skills`/`list_team_rules` 三個唯讀工具工程量不大，但不是 Phase 5.2 卡住的核心問題，先不列入第一輪範圍以免拖慢交付。

---

## 交付順序建議

1. **Rails**：知識庫寫入權限修復（已在委派實作中，本文件完成時應該已經合併）。
2. **Rails**：新 `POST /books/:book_token/mcp/semantic_search` 端點（獨立於對話情境，重用 `Ai::BookSemanticQuery`）。
3. **slima-mcp-server**：`list_teams`/`get_team` 工具（零 Rails 依賴，可以最先做，立刻解鎖「發現」這一步）。
4. **slima-mcp-server**：`semantic_search` 工具（依賴步驟 2）。
5. **端到端驗證**：用 `test-mcp.slima.ai` → `test-api.slima.ai` 這組既有的 test 環境（跟 `slima_rails` 的 `slima-rails-test` 是同一個後端），走一次真實流程：`list_teams` 拿到知識庫 token → `search_content`/`semantic_search` → `read_file`/`create_file` 寫入。
6. （選配，第二輪）`list_team_memories`/`list_team_skills`/`list_team_rules` 唯讀工具。

## 明確排除（本輪不做）

- 團隊知識庫的**寫入**權限收緊/放寬以外的任何團隊治理功能（權限已經由 Rails 端 §5.5 矩陣定案，MCP 這邊只是消費既有規則，不重新設計）。
- `access_events` 稽核（Phase 5.4）——這是 Rails 端已經獨立完成的通用稽核基礎設施（`slima_rails` `TEAM_BACKEND_DEV_PLAN.md` §14.22），MCP 呼叫本來就會經過 `Api::V1::BaseController`，天然被涵蓋，這邊不需要任何額外工作。
- `chapter_stuck`/`chapter_submitted` 通知整合——跟 MCP 工具無關，是站內通知系統的事。
