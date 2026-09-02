<div align="center">

<img src="assets/logo.svg" width="72" height="72" alt="">

# kata

**給 coding agent 的可重用思考套路。**

[![CI](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kata-mcp.svg)](https://www.npmjs.com/package/kata-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · 繁體中文 · [简体中文](README.zh-CN.md)

</div>

## TL;DR — 先看這段，不合就別再往下讀

- **它是什麼。** 把你的做事程序寫成 Markdown 檔，每個 prompt 重新列到模型面前；多階段的那種另外有工具帶著逐階段走。
- **它不做什麼。** 它**不會幫你挑**該用哪條。hook 從不讀你的 prompt——它只是重複一份有界的目錄，配對全部由模型做，跟 Agent Skill 的情況一樣。
- **代價。** 用參考鏈庫（15 條）時，每個 prompt 2313 bytes 的 context。**成本永久，收益偶發。**
- **有效性證據。** **沒有。** 沒有 A/B，沒有量過對規則遵守率或產出品質的影響。這裡寫的全部是機制，不是療效。
- **這些情況請直接跳過**：你要的是能幫你選對程序的東西、要保證模型會照做、或要看到數據支撐。
- **可能值得試的情況**：你本來就在寫方法論筆記，想讓它們可版控、可 diff、可分享，而且每輪自動回到模型面前，不用每個 session 重打一次。
- **這不是推薦。** 它是為一個人的環境做的，在那裡感覺有用。沒有任何東西顯示這能移植；一個已經把同樣紀律寫在自己指令裡的 harness，可能從它這裡什麼都拿不到。

## 這想解決什麼問題

現在的模型思考能力沒問題。它做不到的是——**在該用的那一刻真的把對的程序叫出來**：宣稱完成前該檢查什麼、一個陌生的 bug 該從哪裡下刀、一個抽象值不值得寫。

那些規矩你心裡有。你解釋過了。下一個 session 你還得再解釋一次，再下一個也是，因為沒有東西把它們帶過去。而且**「規矩在但沒被叫出來」跟「規矩正確地不適用」，從外面看長得一模一樣**，兩者都不報錯。

**kata 把那些規矩變成檔案**，並在每個 prompt 把一份**有界的目錄**擺到模型面前——一份帶觸發語的短清單，不是一大段要它重讀的指令。一條鏈要嘛是一次回傳整份的 checklist，要嘛是逐階段的 staged 程序：這一階段的產出提交之後，才拿得到下一階段的提示。

有一點必須講精確，因為整個價值主張都掛在上面：**kata 不判斷哪條鏈相關。** hook 從不讀你的 prompt。它載入全部的鏈，按 scope 與名稱排序，列出前 `HOOK_MAX_CHAINS` 條與它們的觸發語句。**配對是模型做的**，每一輪都是，跟 skill 的情況一樣。觸發語句買到的是**比較容易產生聯想**，不是「幫你選好了」——這個 codebase 裡沒有任何字面比對器。

這是一個**政策注入器與流程驅動器**，刻意**不是**「讓模型多想一點」的工具。後者現在的模型靠內建的交錯思考已經覆蓋了——這也是為什麼路由器會把瑣碎任務直接判 PASS。

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

## 要付出什麼代價

每個 prompt 都會夾帶一份鏈清單，所以這不是免費的。**成本是永久的，收益是偶發的**——這個取捨值得在安裝之前先看清楚：

- `UserPromptSubmit` hook 最多注入 `HOOK_MAX_CHAINS`（16）條鏈，總量受 `HOOK_MAX_BYTES` 限制，每條的觸發語句裁到 `HOOK_MAX_DESC_CHARS`（155）字。超出預算的鏈只列名字。**對參考鏈庫（15 條）實測：每個 prompt 2313 bytes**，程式算出來的上限是 3250 bytes。用 `node hooks/inject-chains.mjs` 可以在你自己的鏈庫上重跑這個數字。
- checklist 鏈花一次 round trip。staged 鏈每個階段各一次，而且每個階段的提示與產出都留在 context 裡。只有在「每一步真的閘住下一步」時才選 staged。
- 「把每條 description 的**摘要**半段也一起注入」估過：50 個 turn 多約 30k context tokens——約等於 19 次 `master` 呼叫，只為了省下一個 session 實際只會做 1–3 次的 `master` 呼叫。這就是 description 要拆兩半的原因。**但這個數字請當成量級估算，不是量測**：沒有保留 tokenizer、原始快照或計算腳本，不可重現。
- 這些數值與它們的訂定依據都在 `src/types.ts`，那是所有上限的單一事實來源。

路由器存在的意義就是維持這份誠實：瑣碎任務應該回 PASS，除了那份注入清單之外不再多付。至於實際上有沒有發生——那是模型的決定，而且沒有任何東西記錄它，見下一節。

## 這是實驗性的，有效性無法證明

kata 是一個實驗，誠實的總結是：**它的核心主張未經證實**。要裝，請當成實驗來裝。

- **沒有 A/B 數據。** 沒有量過「有 kata vs 沒有」的規則遵守率或結果品質。以下所有敘述都是機制，不是療效。
- **hook 不做路由。** 它只是重複一份有界目錄；配對仍然全部由模型做。跟寫在 `CLAUDE.md` 的規則或一個 Agent Skill 相比，差別只有位置、重複頻率、篇幅有界、文案更密——**同一種藥加大劑量，不是換了一種機制。**
- **staged 鏈強制的是揭露順序，不是工作。** engine 會拒絕錯的 `expected_stage_index`，所以下一段提示不能提前看到。但它不檢查你提交了什麼：`stage_output` 沒有最小長度，任何 `skip_reason` 都能推進，整條鏈可以用佔位字元走到 `done: true`。它約束的是「自願使用它的呼叫者」，而沒有任何東西強制那個選擇。
- **PASS 不留痕跡。** `run_chain("master")` 不開 session、什麼都不記錄，所以「正確判斷不需要」「橡皮章跳過」「根本沒呼叫 master」三者事後無法區分。
- **軌跡沒有讀者。** staged 執行會寫 JSONL，但程式面唯一的消費者只從**檔名**解析重複訊號，**從不讀階段內容**。沒有審閱工具、沒有品質 gate、沒有完成檢查。軌跡記的是模型**聲稱**它做了什麼。
- **16 條是容量選擇，不是量出來的甜蜜點。** 沒有人測過 8／12／16／24 條時的路由命中率。超過上限之後，哪些鏈保有觸發語句由 scope 與名稱決定——**不是由跟當前任務的相關性決定**。
- **它只找得到已經存在的鏈。** 沒有任何機制能發現「這個任務需要一條還沒被寫出來的程序」。
- **與 Agent Skills 的重疊是真的。** 對 checklist 型的鏈，skill 做的事情差不多。站得住的差異只有 staged 的揭露順序、軌跡，以及「鏈是可版控、可 diff、可分享的檔案」——而只有最後這項是毫無疑問有價值的。
- **如果你自己的指令已經寫了這些，這就是第二份副本。** 鏈裡編碼的檢查，`CLAUDE.md` 一樣裝得下。在已經裝了的情況下，hook 只是在少數輪次把同一段文字再展示一次，剩下的價值只有檔案格式。
- **對作者自己的 transcript 做前後對比，什麼都沒找到。** 約 4000 個互動輪次，按模型分層，排除建這個工具的那些 session：一個模型的使用者修正率降了（11.6% → 2.5%，n=119），另一個升了（6.3% → 11.4%，n=35），工具錯誤率沒動，而且每一個「後」的輪次跑的 Claude Code 都比多數「前」的更新。這些是代理指標，不是品質——但裡面沒有任何可以拿來宣傳的訊號。改在**同樣的上下文深度**下重跑——只取模型看到 ≥200k tokens 的輪次，也就是作者真正的痛點——分裂一模一樣：一個模型每項代理指標都變好，另一個每項都變差。所以這不是 session 長短造成的假象，但仍然不是訊號。腳本在 `scripts/before-after.py` 與 `scripts/before-after-by-context.py`，讀的都是本機 Claude Code 的 transcript，任何人都能對自己的跑一次。

### 選用：觀測模式

**預設關閉。** `KATA_OBSERVE=1` 會為每個 prompt 在 `<專案>/.claude/kata-observations.jsonl` 追加一行 JSONL：提供了哪些鏈、哪幾條保有觸發語句、注入的位元組數、prompt 的長度與短雜湊，以及 session 與 prompt 的 id。`KATA_OBSERVE=full` 會另外存下 prompt 原文。

它存在是因為一個否則補不起來的缺口：**transcript 不會記錄 hook 注入了什麼**，所以「這一輪清單到底有沒有擺在模型面前」事後無法回答。那正是上一節每一個問題所缺的另一半。

```bash
node scripts/observe-report.mjs            # --project <dir>  --sample N  --json
```

報表把這份記錄、Claude Code 的 transcript（呼叫）與軌跡檔（staged 執行的情況）接在一起，印出的是**建議，不是統計**——每一行都點名一條鏈，以及對它該做的一個編輯：

| 它會說 | 因為 | 門檻 |
|---|---|---|
| 移除、降到 pack、或改寫 `Use when` | 跨多個 session 以完整觸發語被提供了很多次，從未被呼叫 | `--min-offered 20`、`--min-sessions 3` |
| 改寫 `Use when` 的開頭 | 有被呼叫，但每次都是 `master` 先把它完整列出之後——注入的那句沒在做路由 | 被呼叫 ≥ 3 次 |
| 改成 checklist | staged 執行大多數階段都被跳過 | `--skip-rate 0.5` |
| 縮短它 | staged 執行開始了卻沒有完成 | 完成率 ≤ 50% |

門檻是主觀決定，所以每份報表開頭都會印出來，不藏。**session 那道閘門很重要**：一個長 session 沒用到某條鏈，對那條鏈什麼都說明不了——所以「從未被呼叫」在觀測到足夠多 session 之前會被扣住，報表會明說。

**刻意沒有總調用率。** 多數輪次本來就不該套鏈——那正是 PASS 的用途——所以「N% 的輪次呼叫了鏈」既不是成功也不是失敗，印出來只會被當成其中一種來讀。資料判斷不了的，報表就說判斷不了：`master` 被呼叫之後沒有任何鏈，可能是正確的 PASS，也可能是一條還不存在的鏈；報表列出那個數字，不下結論。

這一切都回答不了的唯一問題是：那一輪**是否應該**呼叫一條鏈。那是判斷題。`--sample N` 會印出 N 個這樣的輪次（prompt 原文需要 `KATA_OBSERVE=full`），讓人去判斷。這裡刻意沒有任何東西自動化它。

把這個 log 加進 .gitignore。`=full` 之下它包含你打過的每一個字。

<details>
<summary>這個模式存在之前的第一次概測</summary>

直接從本機 2202 個 transcript 數 `run_chain` 呼叫：plugin 安裝之後的 225 個互動式輪次中，有 35 輪呼叫了鏈——**15.6%**，而且量到的兩個專案幾乎一致（15.9% 與 15.1%）。**當成量級看待就好**：分母是「所有輪次」而不是「清單有被展示的輪次」，兩個專案都屬於作者本人，其中一個就是這個 repo。

</details>

`hooks/inject-chains.mjs` 開頭的註解記錄了塑造這個 hook 文案的那起事故：鏈的清單注入了、名字印出來了，模型仍然把工具搜尋花在別的地方，零次呼叫。**那證明問題是真的，也同樣證明這個解法什麼都不保證**——而且它只是一則註解，不是被保存下來的 transcript，所以你能驗證的是「這則註解存在」，不是「那個 session 發生過」。

### 測試它對你有沒有用

唯一知道的方法是關掉它然後看。有兩個開關，因為有兩個假設：

- `KATA_HOOK=0` —— 關掉注入，MCP server 照常。什麼都不輸出，不是印一句「已關閉」，所以對照的是真正的缺席。測的是「每輪那份清單重不重要」。
- 停用 plugin —— 全關。測的是「鏈本身重不重要」。

一週內做得完的協議：關 hook、全關、全開各幾天，用在你平常的工作上，每天記一行；然後比較。**各組之間要固定模型與 Claude Code 版本**，否則你量到的是那兩樣。作者自己的前後對比正是被這樣混淆的，所以上面寫的是「什麼都沒找到」，不是「找到了什麼」。

### 實驗：沒跑過鏈就拒絕編輯

**預設關閉。** `KATA_GATE=1` 把提醒變成閘門：非瑣碎的 prompt 之後，第一次 `Edit`/`Write` 與每一次 `git commit` 都會被 `PreToolUse` hook 拒絕，直到這一輪呼叫過任何一條鏈——`run_chain("master")` 就夠，判 PASS 也算。commit 之後閘門重新上膛，所以一段長的自主執行是**每個 commit 階段各擋一次**，不是只在開頭擋一次。

「非瑣碎」是規則不是模型：40 個字元以上（`KATA_GATE_MIN_CHARS`）且不是純粹的應答（`ok`、`好`、`繼續`……）。它刻意粗糙。模型自己「何時該路由」的判斷正是受測物，所以不能同時當裁判。瑣碎的 prompt **不會解除**閘門：任務之後的一句「繼續」就是那個任務——實跑的第一批樣本裡，一句六個字的續作指令後面跟著 153 次工具呼叫。

它保證的是模型在動手寫之前**呼叫過**什麼——不保證它照著鏈走；staged 鏈仍然可以一路 skip 過去。每次拒絕會追加到 `<專案>/.claude/kata-gate.jsonl`，上膛狀態放在 `<專案>/.claude/kata-gate.json`；兩個都要 gitignore。只支援 Claude Code：Codex 的 hook API 尚未驗證能否回傳 deny。用 `Agent` 工具派出的子代理也在範圍內：它們的工具呼叫走同一組 hook、掛在父 session 的 id 底下，所以子代理的第一次編輯會被擋，直到這個 session 裡有誰呼叫過鏈；子代理自己呼叫也算，解除對所有人生效。trace 會記 `agent_id` 與 `agent_type`，事後分得出是誰。

工具 hook 是 Claude Code 程序啟動時讀的，所以開啟之後要開一個新 session；已經在跑的 session 會繼續全部放行，而且不會有任何訊息。`KATA_GATE_TRACE=1` 會把每次呼叫都記進同一個檔，用來分辨「沒接上」與「接上了但放行」：一筆記錄都沒有就是前者。

代價：每個被擋的階段多一次工具往返，以及模型忘記時要從一次拒絕中恢復。這樣換不換得到什麼，正是這個開關存在要問的問題；這裡沒有任何地方宣稱它換得到。

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

觸發 skill 是 Claude Code 的 plugin 功能，獨立註冊拿不到。`KATA_PROJECT_ROOT`、`KATA_GLOBAL_DIR`、`KATA_PACKS_DIR` 可覆蓋層級的預設位置（專案根目錄預設為 server 行程的 cwd，`list_chains` 會回報它實際解析到什麼）。

**prompt hook 並非 Claude Code 專屬。Codex CLI** 有同名的 `UserPromptSubmit` 事件、stdin 上同樣有 `prompt` 欄位、回應同樣是 `hookSpecificOutput.additionalContext`，所以這支 hook 腳本原封不動就能跑。它在 git checkout 裡而不在 npm 套件裡（它直接 import `src/`），所以請 clone repo 後指向它：

```toml
# ~/.codex/config.toml
[[hooks.UserPromptSubmit]]

[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = 'node "/path/to/kata-mcp/hooks/inject-chains.mjs"'
timeout = 5
```

兩件 Codex 專屬的事，都在實際執行中驗證過：

- **Codex 會靜默跳過它還沒被告知要信任的 hook。** 上面那段宣告寫了之後什麼都不會發生，直到你開互動式 `codex`、在 `/hooks` 裡核准它；非互動的 `codex exec` 可以用 `--dangerously-bypass-hook-trust` 單次繞過。如果鏈清單一直沒出現，原因就是這個。
- `[shell_environment_policy.set]` 裡的環境變數會傳到 hook，所以 `KATA_OBSERVE` 可以設在那裡。Codex 把回合叫做 `turn_id`，Claude Code 叫 `prompt_id`；觀測記錄兩者都記成 `prompt_id`。但報表只會讀 Claude Code 的 transcript，所以 Codex 的觀測只能算「提供了什麼」，無法對到「呼叫了什麼」。

注入文字裡的工具前綴是為 Claude Code plugin 寫的，所以在其他 client 上那行 ToolSearch 不會對應到你的工具名稱——但鏈的清單本身仍然正確。

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
