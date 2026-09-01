<div align="center">

<img src="assets/logo.svg" width="72" height="72" alt="">

# kata

**給 coding agent 的可重用思考套路。**

[![CI](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kata-mcp.svg)](https://www.npmjs.com/package/kata-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · 繁體中文 · [简体中文](README.zh-CN.md)

</div>

## 這解決什麼問題

現在的模型思考能力沒問題。它做不到的是——**在關鍵那一刻想起這個任務該用哪套程序**：宣稱完成前該檢查什麼、一個陌生的 bug 該從哪裡下刀、一個抽象值不值得寫。

那些規矩你心裡有。你解釋過了。下一個 session 你還得再解釋一次，再下一個也是，因為沒有東西把它們帶過去。

**kata 把那些規矩變成檔案。** 寫一次、進版控，然後由一個路由器在每個 prompt 把相關的那幾條擺到模型面前——以一份**有界的清單**呈現，不是一大段要它重讀的指令。一條鏈可以是「一次回傳整份的 checklist」，也可以是「逐階段走的 staged 程序」：每一階段的產出必須先寫下來，才會看到下一階段的提示。

這是一個**政策注入器與流程驅動器**，刻意**不是**「讓模型多想一點」的工具。後者現在的模型靠內建的交錯思考已經覆蓋了——這也正是為什麼路由器會把瑣碎任務直接判 PASS，讓你什麼都不用付。

## 概念

| 鏈 | 種類 | 做什麼 |
|---|---|---|
| `master` | 內建路由 | 非瑣碎任務的進入點。決定 PASS（不套鏈）、`default`、或哪幾條自訂鏈。 |
| `default` | 內建 freeform | 逐步思考，可修正，最後以明確的假設／驗證收尾。 |
| 你的鏈 | `*.md` 檔 | `checklist`（一次回傳整份）或 `staged`（逐階段走）。 |

鏈檔分三層，同名時高層遮蔽低層（project > pack > global）：

- **global** — `~/.claude/kata/*.md`，到處都適用的鏈
- **pack** — `~/.claude/kata/packs/<pack>/*.md`，特定技術棧的鏈，由專案自己以入庫的 `<專案>/.claude/kata.json` → `{ "packs": ["laravel"] }` 選擇啟用
- **project** — `<專案>/.claude/kata/*.md`

**不會有任何東西被複製進你的專案。** 宣告了但磁碟上不存在的 pack 會被回報為 invalid，而不是靜靜當成零條鏈；同一個鏈名出現在兩個 pack，兩邊都不載入；一個**無效的**專案層檔案若遮蔽了下層的鏈，那個名字會被**擋下**（fail-closed），而不是安靜地跑舊版本。

## 安裝

需要 **Node 22.18 以上**——這是第一個不用加旗標就能直接跑 TypeScript 的版本，也是 plugin 能在「什麼都沒裝、什麼都沒編譯」的 checkout 裡運作的原因。

在 Claude Code 裡（這兩行是你自己打的指令；agent 不能替你打，但它可以在 shell 跑對應的 `claude plugin ...`）：

```
/plugin marketplace add keoy7am/kata-mcp
/plugin install kata@kata
```

然後取得鏈。鏈庫是獨立的 repo，所以它有自己的歷史，你也可以 fork：

```bash
git clone https://github.com/keoy7am/kata-chains.git ~/.claude/kata
```

安裝到此為止。就算你跳過鏈庫，kata 仍然帶著兩條內建鏈運作，並且會告訴你其餘的該放哪裡。

**驗證**：在新 session 呼叫 `list_chains`。它會回報 `master`、`default`、找到的每一條鏈，以及它解析出來的層級路徑。如果工具根本不存在，代表 server 沒起來——先確認 `node --version`。

<details>
<summary>或者把這段丟給 agent</summary>

> 在 Claude Code 裡安裝 kata：執行 `claude plugin marketplace add keoy7am/kata-mcp` 與 `claude plugin install kata@kata`，確認 `node --version` 至少 22.18，然後把 `https://github.com/keoy7am/kata-chains.git` clone 到 `~/.claude/kata`。做完回報 `list_chains` 的結果。

</details>

## 這要付出什麼成本

每個 prompt 都會夾帶一份鏈清單，所以這不是免費的，數字直接講清楚：

- `UserPromptSubmit` hook 最多注入 `HOOK_MAX_CHAINS`（16）條鏈，總量受 `HOOK_MAX_BYTES` 限制，每條的觸發語句裁到 `HOOK_MAX_DESC_CHARS`（155）字。超出預算的鏈只列名字。大約是**每個 prompt 1–3 KB 的 context**，而這就是全部的路由訊號。
- 「把每條 description 的**摘要**半段也一起注入」實測過：**50 個 turn 多花約 30k context tokens**——約等於 19 次 `master` 呼叫，只為了省下一個 session 實際只會做 1–3 次的 `master` 呼叫。這就是 description 要拆兩半、而且只注入觸發半段的原因。
- checklist 鏈花一次 round trip。staged 鏈每個階段各一次，而且每個階段的提示與產出都留在 context 裡。只有在「每一步真的閘住下一步」時才選 staged。
- 這些數值與它們的訂定依據都在 `src/types.ts`，那是所有上限的單一事實來源。

路由器存在的意義就是維持這份誠實：瑣碎任務應該回 PASS，除了那份注入清單之外不再多付。

## 寫你自己的鏈

內附的鏈庫是起點，不是產品本身。**產品是你為你的團隊一再重犯的那個錯誤所寫的那條鏈。**

```markdown
---
name: my-chain            # 小寫 slug = 檔名 = save_chain 的參數
description: 做什麼，加上何時該跳過。Use when <你真的會打出來的字>。
mode: checklist           # 或 staged
domain: frontend          # 選填，僅顯示用
language: zh-TW           # 選填 BCP 47；釘住輸出語言
schema_version: 1
---

checklist 的內文——或者，staged 鏈用 2–12 個段落：

## Stage: 標題
這個階段必須產出什麼。（圍籬代碼區塊裡的標題會被忽略。）
```

存到 `~/.claude/kata/my-chain.md`，或讓模型寫完後呼叫 `save_chain`——它會先驗證再寫入，且不會靜默覆蓋。

### `description` 欄位就是全部的路由訊號

它被兩個不同的消費者讀，並且在第一個 `Use when` 處拆開：

- **在它之前**——只有 `run_chain("master")` 會顯示，而且是完整顯示。對 prompt hook 而言完全免費，所以摘要放這裡，還有交叉引用（*「環境類的靜默失敗改用 root-cause-isolation」*）與「何時不要用」的註記。
- **從 `Use when` 開始**——**每個** prompt 都會注入，且會被截斷。這是模型在呼叫任何東西之前唯一有的路由訊號，所以**開頭要放最有辨識度、使用者真的會打出來的字面片語**（`"worked yesterday, broken today"`、`"find the holes"`、`"TDD"`），把籠統的任務形狀放最後——那裡被截斷才不心疼。

hook 會把鏈名印在同一行，所以只是複述名字的摘要等於浪費預算——這正是「拆兩半」而不是「單純從頭截斷」的理由。完全省略 `Use when` 會讓 hook 退回從頭截斷；`list_chains` 會把這些鏈列在 `no_trigger_clause` 底下。

內容語言不決定輸出語言：回應帶有 `output_language` 欄位，預設跟隨對話的語言。

## 分享鏈

一條鏈就是一個 Markdown 檔，所以低技術含量的路徑就成立：`export_chain` 回傳原始內容加上 sha256，對方讀進去再呼叫 `save_chain`。

規模再大一點，就照參考鏈庫的方式分享——一個 git repo，clone 到 `~/.claude/kata`，特定技術棧的鏈放在 `packs/` 底下。`SessionStart` hook 會盡力 fast-forward 那個 checkout，所以團隊的鏈不需要任何人手動 pull 就保持最新。

在你把它指向**別人的** repo 之前，這個自動拉取值得先想清楚：鏈檔是會注入到你模型裡的 prompt 文字，所以誰能 push 到那個 repo，誰就能改變你的 agent 被告知什麼。**clone 一個鏈庫是一個信任決定，和加一個依賴同性質。**

## 工具

- **`list_chains`** — 內建鏈加上每一層、宣告的 pack（含 `found`）、無效檔案與理由、pack 衝突、遮蔽關係，以及解析出來的路徑。
- **`run_chain {name}`** — 啟動一條鏈。checklist：整份內容，無 session。staged/freeform：開一個 session，並把鏈內容快照起來，執行中修改鏈檔不會影響進行中的流程。
- **`advance_chain {session_id, expected_stage_index, stage_output? | skip_reason?, done?}`** — 提交一個階段並取得下一個。`expected_stage_index` 讓逾時重試具冪等性：重送前一個 index 會重播同樣的回應，而不會重複寫入軌跡。
- **`save_chain {name, scope, content, overwrite?}`** — 寫入 agent 撰寫的鏈。完整驗證、原子寫入、不靜默覆蓋。
- **`export_chain {name, scope?}`** — 原始 Markdown 加 sha256，用於分享。

Session 存在記憶體（上限 32，LRU 淘汰）；server 重啟後會回 `SESSION_LOST`。staged 與 freeform 的執行會在 `<專案>/.claude/thinking-traces/` 附加 JSONL 軌跡——那是**診斷用的逐字稿，不是防竄改的稽核紀錄**。把它加進 .gitignore，也不要把機密貼進階段產出。

## 獨立 MCP（任何客戶端）

```json
{ "mcpServers": { "kata": { "command": "npx", "args": ["-y", "kata-mcp"] } } }
```

prompt hook 與觸發 skill 是 Claude Code 的 plugin 功能，獨立註冊拿不到它們——那時 `master` 得手動呼叫。`KATA_PROJECT_ROOT`、`KATA_GLOBAL_DIR`、`KATA_PACKS_DIR` 可覆蓋層級的預設位置（專案根目錄預設為 server 行程的 cwd，`list_chains` 會回報它實際解析到什麼）。

## 更新

Claude Code 會刷新 marketplace 與 plugin 本身；鏈庫透過 `SessionStart` 的 fast-forward 自行更新。要吃到新的 server 版本請重啟 session——鏈檔每次呼叫都重讀，prompt hook 每個 prompt 都是全新行程，但 MCP server 是長駐的，它握著啟動當下的那份程式碼。

## 開發

```bash
npm ci
npm test         # vitest
npm run typecheck
```

需要 Node 22.18 以上。在這個 repo 裡工作永遠不需要 build：plugin、hook、測試都直接讀 `src/`。

發佈的 npm 套件是唯一的例外，而且這不是偏好問題——**Node 拒絕對 `node_modules` 底下的檔案做型別剝離**（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），所以一個發原始 TypeScript 的套件會裝得很順、然後起不來。`prepublishOnly` 會把 `src/` 編譯成 `dist/`，那才是 `bin` 指到的地方；`dist/` 有進 .gitignore，所以 repo 裡永遠不會有會過期的編譯產物。

發版：`npm version patch|minor|major`。`package.json` 是版本的單一來源——`src/index.ts` 啟動時讀它，所以 server 回報給客戶端的版本是衍生的；`version` 生命週期腳本會寫入 `.claude-plugin/plugin.json` 與 `plugin.mcp.json` 裡釘住的版本。這幾份一旦不一致，或出現第四份副本，測試就會失敗。

有兩條約束特別容易不小心破壞，已由測試強制執行：**prompt hook 匯入到的一切必須零依賴，且不得使用不可抹除的 TypeScript**（不能有 `enum`、不能有 constructor 參數屬性），因為那些程式碼執行時，plugin checkout 的依賴不保證裝過——裸 `git clone`、離線機器、或宿主跳過／裝失敗，結果都一樣。

## 設計筆記

見 [docs/design-notes.md](docs/design-notes.md)：鏈格式、路由與失敗模式為何長這樣——包含幾個出自對抗式審查的決定：CAS 式重試語意、fail-closed 遮蔽、正規化命名、原子寫入。

## 授權

MIT — 見 [LICENSE](LICENSE)。
