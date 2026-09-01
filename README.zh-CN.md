<div align="center">

<img src="assets/logo.svg" width="72" height="72" alt="">

# kata

**给 coding agent 的可复用思考套路。**

[![CI](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kata-mcp.svg)](https://www.npmjs.com/package/kata-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [繁體中文](README.zh-TW.md) · 简体中文

</div>

## 这解决什么问题

现在的模型思考能力没问题。它做不到的是——**在关键那一刻想起这个任务该用哪套流程**：宣称完成前该检查什么、一个陌生的 bug 该从哪里下刀、一个抽象值不值得写。

那些规矩你心里有。你解释过了。下一个 session 你还得再解释一次，再下一个也是，因为没有东西把它们带过去。

**kata 把那些规矩变成文件。** 写一次、进版本控制，然后由一个路由器在每个 prompt 把相关的那几条摆到模型面前——以一份**有界的清单**呈现，而不是一大段要它重读的指令。一条链可以是「一次返回整份的 checklist」，也可以是「逐阶段走的 staged 流程」：每个阶段的产出必须先写下来，才会看到下一阶段的提示。

这是一个**策略注入器与流程驱动器**，刻意**不是**「让模型多想一点」的工具。后者现在的模型靠内置的交错思考已经覆盖了——这也正是为什么路由器会把琐碎任务直接判 PASS，让你什么都不用付。

## 概念

| 链 | 种类 | 做什么 |
|---|---|---|
| `master` | 内置路由 | 非琐碎任务的入口。决定 PASS（不套链）、`default`、或哪几条自定义链。 |
| `default` | 内置 freeform | 逐步思考，可修正，最后以明确的假设／验证收尾。 |
| 你的链 | `*.md` 文件 | `checklist`（一次返回整份）或 `staged`（逐阶段走）。 |

链文件分三层，同名时高层遮蔽低层（project > pack > global）：

- **global** — `~/.claude/kata/*.md`，到处都适用的链
- **pack** — `~/.claude/kata/packs/<pack>/*.md`，特定技术栈的链，由项目自己用提交进仓库的 `<项目>/.claude/kata.json` → `{ "packs": ["laravel"] }` 选择启用
- **project** — `<项目>/.claude/kata/*.md`

**不会有任何东西被复制进你的项目。** 声明了但磁盘上不存在的 pack 会被报告为 invalid，而不是悄悄当成零条链；同一个链名出现在两个 pack，两边都不加载；一个**无效的**项目层文件如果遮蔽了下层的链，那个名字会被**拦下**（fail-closed），而不是安静地跑旧版本。

## 安装

需要 **Node 22.18 以上**——这是第一个不用加标志就能直接运行 TypeScript 的版本，也是插件能在「什么都没装、什么都没编译」的 checkout 里工作的原因。

在 Claude Code 里（这两行是你自己敲的命令；agent 不能替你敲，但它可以在 shell 里运行对应的 `claude plugin ...`）：

```
/plugin marketplace add keoy7am/kata-mcp
/plugin install kata@kata
```

然后获取链。链库是独立的仓库，所以它有自己的历史，你也可以 fork：

```bash
git clone https://github.com/keoy7am/kata-chains.git ~/.claude/kata
```

安装到此为止。即使你跳过链库，kata 仍然带着两条内置链工作，并且会告诉你其余的该放哪里。

**验证**：在新 session 调用 `list_chains`。它会报告 `master`、`default`、找到的每一条链，以及它解析出来的层级路径。如果工具根本不存在，说明 server 没起来——先确认 `node --version`。

<details>
<summary>或者把这段丢给 agent</summary>

> 在 Claude Code 里安装 kata：运行 `claude plugin marketplace add keoy7am/kata-mcp` 与 `claude plugin install kata@kata`，确认 `node --version` 至少 22.18，然后把 `https://github.com/keoy7am/kata-chains.git` clone 到 `~/.claude/kata`。做完汇报 `list_chains` 的结果。

</details>

## 这要付出什么成本

每个 prompt 都会夹带一份链清单，所以这不是免费的，数字直接讲清楚：

- `UserPromptSubmit` hook 最多注入 `HOOK_MAX_CHAINS`（16）条链，总量受 `HOOK_MAX_BYTES` 限制，每条的触发语句裁到 `HOOK_MAX_DESC_CHARS`（155）字符。超出预算的链只列名字。大约是**每个 prompt 1–3 KB 的 context**，而这就是全部的路由信号。
- 「把每条 description 的**摘要**半段也一起注入」实测过：**50 个 turn 多花约 30k context tokens**——约等于 19 次 `master` 调用，只为了省下一个 session 实际只会做 1–3 次的 `master` 调用。这就是 description 要拆两半、而且只注入触发半段的原因。
- checklist 链花一次 round trip。staged 链每个阶段各一次，而且每个阶段的提示与产出都留在 context 里。只有在「每一步真的卡住下一步」时才选 staged。
- 这些数值与它们的设定依据都在 `src/types.ts`，那是所有上限的单一事实来源。

路由器存在的意义就是维持这份诚实：琐碎任务应该返回 PASS，除了那份注入清单之外不再多付。

## 写你自己的链

内置的链库是起点，不是产品本身。**产品是你为你的团队一再重犯的那个错误所写的那条链。**

```markdown
---
name: my-chain            # 小写 slug = 文件名 = save_chain 的参数
description: 做什么，加上何时该跳过。Use when <你真的会敲出来的字>。
mode: checklist           # 或 staged
domain: frontend          # 选填，仅显示用
language: zh-CN           # 选填 BCP 47；锁定输出语言
schema_version: 1
---

checklist 的正文——或者，staged 链用 2–12 个段落：

## Stage: 标题
这个阶段必须产出什么。（围栏代码块里的标题会被忽略。）
```

保存到 `~/.claude/kata/my-chain.md`，或者让模型写完后调用 `save_chain`——它会先验证再写入，且不会静默覆盖。

### `description` 字段就是全部的路由信号

它被两个不同的消费者读取，并且在第一个 `Use when` 处拆开：

- **在它之前**——只有 `run_chain("master")` 会显示，而且是完整显示。对 prompt hook 而言完全免费，所以摘要放这里，还有交叉引用（*「环境类的静默失败改用 root-cause-isolation」*）与「何时不要用」的说明。
- **从 `Use when` 开始**——**每个** prompt 都会注入，且会被截断。这是模型在调用任何东西之前唯一拥有的路由信号，所以**开头要放最有辨识度、用户真的会敲出来的字面短语**（`"worked yesterday, broken today"`、`"find the holes"`、`"TDD"`），把笼统的任务形状放最后——那里被截断才不心疼。

hook 会把链名打印在同一行，所以只是复述名字的摘要等于浪费预算——这正是「拆两半」而不是「单纯从头截断」的理由。完全省略 `Use when` 会让 hook 退回从头截断；`list_chains` 会把这些链列在 `no_trigger_clause` 下面。

内容语言不决定输出语言：响应带有 `output_language` 字段，默认跟随对话的语言。

## 分享链

一条链就是一个 Markdown 文件，所以低技术含量的路径就成立：`export_chain` 返回原始内容加上 sha256，对方读进去再调用 `save_chain`。

规模再大一点，就照参考链库的方式分享——一个 git 仓库，clone 到 `~/.claude/kata`，特定技术栈的链放在 `packs/` 下面。`SessionStart` hook 会尽力 fast-forward 那个 checkout，所以团队的链不需要任何人手动 pull 就保持最新。

在你把它指向**别人的**仓库之前，这个自动拉取值得先想清楚：链文件是会注入到你模型里的 prompt 文本，所以谁能 push 到那个仓库，谁就能改变你的 agent 被告知什么。**clone 一个链库是一个信任决定，和加一个依赖同性质。**

## 工具

- **`list_chains`** — 内置链加上每一层、声明的 pack（含 `found`）、无效文件与原因、pack 冲突、遮蔽关系，以及解析出来的路径。
- **`run_chain {name}`** — 启动一条链。checklist：整份内容，无 session。staged/freeform：开一个 session，并把链内容快照下来，运行中修改链文件不会影响进行中的流程。
- **`advance_chain {session_id, expected_stage_index, stage_output? | skip_reason?, done?}`** — 提交一个阶段并取得下一个。`expected_stage_index` 让超时重试具备幂等性：重发前一个 index 会重放同样的响应，而不会重复写入轨迹。
- **`save_chain {name, scope, content, overwrite?}`** — 写入 agent 撰写的链。完整校验、原子写入、不静默覆盖。
- **`export_chain {name, scope?}`** — 原始 Markdown 加 sha256，用于分享。

Session 存在内存中（上限 32，LRU 淘汰）；server 重启后会返回 `SESSION_LOST`。staged 与 freeform 的运行会在 `<项目>/.claude/thinking-traces/` 追加 JSONL 轨迹——那是**诊断用的记录，不是防篡改的审计日志**。把它加进 .gitignore，也不要把密钥贴进阶段产出。

## 独立 MCP（任何客户端）

```json
{ "mcpServers": { "kata": { "command": "npx", "args": ["-y", "kata-mcp"] } } }
```

prompt hook 与触发 skill 是 Claude Code 的插件功能，独立注册拿不到它们——那时 `master` 得手动调用。`KATA_PROJECT_ROOT`、`KATA_GLOBAL_DIR`、`KATA_PACKS_DIR` 可覆盖各层的默认位置（项目根目录默认为 server 进程的 cwd，`list_chains` 会报告它实际解析到了什么）。

## 更新

Claude Code 会刷新 marketplace 与插件本身；链库通过 `SessionStart` 的 fast-forward 自行更新。要用上新的 server 版本请重启 session——链文件每次调用都重新读取，prompt hook 每个 prompt 都是全新进程，但 MCP server 是常驻的，它握着启动那一刻的代码。

## 开发

```bash
npm ci
npm test         # vitest
npm run typecheck
```

需要 Node 22.18 以上。在这个仓库里工作永远不需要 build：插件、hook、测试都直接读 `src/`。

发布的 npm 包是唯一的例外，而且这不是偏好问题——**Node 拒绝对 `node_modules` 下的文件做类型擦除**（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），所以一个发布原始 TypeScript 的包会装得很顺、然后起不来。`prepublishOnly` 会把 `src/` 编译成 `dist/`，那才是 `bin` 指向的地方；`dist/` 已进 .gitignore，所以仓库里永远不会有会过期的编译产物。

发版：`npm version patch|minor|major`。`package.json` 是版本的单一来源——`src/index.ts` 启动时读取它，所以 server 报告给客户端的版本是派生的；`version` 生命周期脚本会写入 `.claude-plugin/plugin.json` 与 `plugin.mcp.json` 里锁定的版本。这几份一旦不一致，或出现第四份副本，测试就会失败。

有两条约束特别容易不小心破坏，已由测试强制执行：**prompt hook 引入到的一切必须零依赖，且不得使用不可擦除的 TypeScript**（不能有 `enum`、不能有构造函数参数属性），因为那些代码执行时，插件 checkout 的依赖不保证装过——裸 `git clone`、离线机器、或宿主跳过／装失败，结果都一样。

## 设计笔记

见 [docs/design-notes.md](docs/design-notes.md)：链格式、路由与失败模式为何是这个形状——包含几个出自对抗式评审的决定：CAS 式重试语义、fail-closed 遮蔽、规范化命名、原子写入。

## 许可

MIT — 见 [LICENSE](LICENSE)。
