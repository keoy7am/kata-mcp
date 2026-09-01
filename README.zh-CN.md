<div align="center">

<img src="assets/logo.svg" width="72" height="72" alt="">

# kata

**给 coding agent 的可复用思考套路。**

[![CI](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kata-mcp.svg)](https://www.npmjs.com/package/kata-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [繁體中文](README.zh-TW.md) · 简体中文

</div>

## TL;DR — 先看这段，不合就别再往下读

- **它是什么。** 把你的做事流程写成 Markdown 文件，每个 prompt 重新列到模型面前；多阶段的那种另外有工具带着逐阶段走。
- **它不做什么。** 它**不会帮你挑**该用哪条。hook 从不读你的 prompt——它只是重复一份有界的目录，配对全部由模型做，跟 Agent Skill 的情况一样。
- **代价。** 用参考链库（15 条）时，每个 prompt 2313 bytes 的 context。**成本永久，收益偶发。**
- **有效性证据。** **没有。** 没有 A/B，没有量过对规则遵守率或产出质量的影响。这里写的全部是机制，不是疗效。
- **这些情况请直接跳过**：你要的是能帮你选对流程的东西、要保证模型会照做、或要看到数据支撑。
- **可能值得试的情况**：你本来就在写方法论笔记，想让它们可版本控制、可 diff、可分享，而且每轮自动回到模型面前，不用每个 session 重打一次。

## 这想解决什么问题

现在的模型思考能力没问题。它做不到的是——**在该用的那一刻真的把对的流程调出来**：宣称完成前该检查什么、一个陌生的 bug 该从哪里下刀、一个抽象值不值得写。

那些规矩你心里有。你解释过了。下一个 session 你还得再解释一次，再下一个也是，因为没有东西把它们带过去。而且**「规矩在但没被调出来」跟「规矩正确地不适用」，从外面看长得一模一样**，两者都不报错。

**kata 把那些规矩变成文件**，并在每个 prompt 把一份**有界的目录**摆到模型面前——一份带触发语的短清单，而不是一大段要它重读的指令。一条链要么是一次返回整份的 checklist，要么是逐阶段的 staged 流程：这一阶段的产出提交之后，才拿得到下一阶段的提示。

有一点必须讲精确，因为整个价值主张都挂在上面：**kata 不判断哪条链相关。** hook 从不读你的 prompt。它加载全部的链，按 scope 与名称排序，列出前 `HOOK_MAX_CHAINS` 条与它们的触发语句。**配对是模型做的**，每一轮都是，跟 skill 的情况一样。触发语句买到的是**比较容易产生联想**，不是「帮你选好了」——这个 codebase 里没有任何字面匹配器。

这是一个**策略注入器与流程驱动器**，刻意**不是**「让模型多想一点」的工具。后者现在的模型靠内置的交错思考已经覆盖了——这也是为什么路由器会把琐碎任务直接判 PASS。

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

## 要付出什么代价

每个 prompt 都会夹带一份链清单，所以这不是免费的。**成本是永久的，收益是偶发的**——这个取舍值得在安装之前先看清楚：

- `UserPromptSubmit` hook 最多注入 `HOOK_MAX_CHAINS`（16）条链，总量受 `HOOK_MAX_BYTES` 限制，每条的触发语句裁到 `HOOK_MAX_DESC_CHARS`（155）字符。超出预算的链只列名字。**对参考链库（15 条）实测：每个 prompt 2313 bytes**，程序算出来的上限是 3250 bytes。用 `node hooks/inject-chains.mjs` 可以在你自己的链库上重跑这个数字。
- checklist 链花一次 round trip。staged 链每个阶段各一次，而且每个阶段的提示与产出都留在 context 里。只有在「每一步真的卡住下一步」时才选 staged。
- 「把每条 description 的**摘要**半段也一起注入」估过：50 个 turn 多约 30k context tokens——约等于 19 次 `master` 调用，只为了省下一个 session 实际只会做 1–3 次的 `master` 调用。这就是 description 要拆两半的原因。**但这个数字请当成量级估算，不是测量**：没有保留 tokenizer、原始快照或计算脚本，不可复现。
- 这些数值与它们的设定依据都在 `src/types.ts`，那是所有上限的单一事实来源。

路由器存在的意义就是维持这份诚实：琐碎任务应该返回 PASS，除了那份注入清单之外不再多付。至于实际上有没有发生——那是模型的决定，而且没有任何东西记录它，见下一节。

## 这是实验性的，有效性无法证明

kata 是一个实验，诚实的总结是：**它的核心主张未经证实**。要装，请当成实验来装。

- **没有 A/B 数据。** 没有量过「有 kata vs 没有」的规则遵守率或结果质量。以下所有叙述都是机制，不是疗效。
- **hook 不做路由。** 它只是重复一份有界目录；配对仍然全部由模型做。跟写在 `CLAUDE.md` 的规则或一个 Agent Skill 相比，差别只有位置、重复频率、篇幅有界、文案更密——**同一种药加大剂量，不是换了一种机制。**
- **staged 链强制的是揭示顺序，不是工作。** engine 会拒绝错的 `expected_stage_index`，所以下一段提示不能提前看到。但它不检查你提交了什么：`stage_output` 没有最小长度，任何 `skip_reason` 都能推进，整条链可以用占位字符走到 `done: true`。它约束的是「自愿使用它的调用者」，而没有任何东西强制那个选择。
- **PASS 不留痕迹。** `run_chain("master")` 不开 session、什么都不记录，所以「正确判断不需要」「橡皮图章跳过」「根本没调用 master」三者事后无法区分。
- **轨迹没有读者。** staged 执行会写 JSONL，但程序面唯一的消费者只从**文件名**解析重复信号，**从不读阶段内容**。没有审阅工具、没有质量 gate、没有完成检查。轨迹记的是模型**声称**它做了什么。
- **16 条是容量选择，不是量出来的甜蜜点。** 没有人测过 8／12／16／24 条时的路由命中率。超过上限之后，哪些链保有触发语句由 scope 与名称决定——**不是由跟当前任务的相关性决定**。
- **它只找得到已经存在的链。** 没有任何机制能发现「这个任务需要一条还没被写出来的流程」。
- **与 Agent Skills 的重叠是真的。** 对 checklist 型的链，skill 做的事情差不多。站得住的差异只有 staged 的揭示顺序、轨迹，以及「链是可版本控制、可 diff、可分享的文件」——而只有最后这项是毫无疑问有价值的。

### 可选：观测模式

**默认关闭。** `KATA_OBSERVE=1` 会为每个 prompt 在 `<项目>/.claude/kata-observations.jsonl` 追加一行 JSONL：提供了哪些链、哪几条保有触发语句、注入的字节数、prompt 的长度与短哈希，以及 session 与 prompt 的 id。`KATA_OBSERVE=full` 会另外存下 prompt 原文。

它存在是因为一个否则补不上的缺口：**transcript 不会记录 hook 注入了什么**，所以「这一轮清单到底有没有摆在模型面前」事后无法回答。那正是上一节每一个问题所缺的另一半。

```bash
node scripts/observe-report.mjs            # --project <dir>  --sample N  --json
```

报表把这份记录、Claude Code 的 transcript（调用）与轨迹文件（staged 运行的情况）接在一起，打印的是**建议，不是统计**——每一行都点名一条链，以及对它该做的一个编辑：

| 它会说 | 因为 | 阈值 |
|---|---|---|
| 移除、降到 pack、或改写 `Use when` | 跨多个 session 以完整触发语被提供了很多次，从未被调用 | `--min-offered 20`、`--min-sessions 3` |
| 改写 `Use when` 的开头 | 有被调用，但每次都是 `master` 先把它完整列出之后——注入的那句没在做路由 | 被调用 ≥ 3 次 |
| 改成 checklist | staged 运行大多数阶段都被跳过 | `--skip-rate 0.5` |
| 缩短它 | staged 运行开始了却没有完成 | 完成率 ≤ 50% |

阈值是主观决定，所以每份报表开头都会打印出来，不藏。**session 那道闸门很重要**：一个长 session 没用到某条链，对那条链什么都说明不了——所以「从未被调用」在观测到足够多 session 之前会被扣住，报表会明说。

**刻意没有总调用率。** 多数轮次本来就不该套链——那正是 PASS 的用途——所以「N% 的轮次调用了链」既不是成功也不是失败，打印出来只会被当成其中一种来读。数据判断不了的，报表就说判断不了：`master` 被调用之后没有任何链，可能是正确的 PASS，也可能是一条还不存在的链；报表列出那个数字，不下结论。

这一切都回答不了的唯一问题是：那一轮**是否应该**调用一条链。那是判断题。`--sample N` 会打印 N 个这样的轮次（prompt 原文需要 `KATA_OBSERVE=full`），让人去判断。这里刻意没有任何东西自动化它。

把这个 log 加进 .gitignore。`=full` 之下它包含你敲过的每一个字。

<details>
<summary>这个模式存在之前的第一次概测</summary>

直接从本机 2202 个 transcript 数 `run_chain` 调用：plugin 安装之后的 225 个交互式轮次中，有 35 轮调用了链——**15.6%**，而且量到的两个项目几乎一致（15.9% 与 15.1%）。**当成量级看待就好**：分母是「所有轮次」而不是「清单有被展示的轮次」，两个项目都属于作者本人，其中一个就是这个仓库。

</details>

`hooks/inject-chains.mjs` 开头的注释记录了塑造这个 hook 文案的那起事故：链的清单注入了、名字打印出来了，模型仍然把工具搜索花在别的地方，零次调用。**那证明问题是真的，也同样证明这个解法什么都不保证**——而且它只是一条注释，不是被保存下来的 transcript，所以你能验证的是「这条注释存在」，不是「那个 session 发生过」。

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
