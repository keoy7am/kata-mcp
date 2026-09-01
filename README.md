<div align="center">

<img src="assets/logo.svg" width="72" height="72" alt="">

# kata

**Reusable thinking routines for coding agents.**

[![CI](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kata-mcp.svg)](https://www.npmjs.com/package/kata-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

</div>

## TL;DR — read this before spending more time

- **What it is.** Your procedures as Markdown files, re-listed in front of the
  model on every prompt, plus a tool that walks the multi-step ones one stage at
  a time.
- **What it does not do.** It does not pick the procedure for you. The hook
  never reads your prompt — it repeats a bounded catalog, and the model does all
  the matching, the same way it would for an Agent Skill.
- **What it costs.** 2,313 bytes of context on every prompt with the reference
  library (15 chains). Permanent cost, occasional benefit.
- **Evidence that it helps.** None. No A/B, no measured effect on rule-following
  or output quality. Everything documented here is mechanism, not efficacy.
- **Skip it if** you want something that selects the right procedure for you,
  guarantees the model follows one, or comes with data behind it.
- **Maybe worth it if** you already keep methodology notes and want them
  versioned, diffable, shareable, and put back in front of the model every turn
  instead of retyped every session.

## The problem

Modern models think perfectly well on their own. What they do not reliably do is
**invoke the right procedure at the moment it applies** — what to check before
calling something done, where to cut into an unfamiliar bug, whether an
abstraction is earning its place.

You know those routines. You have explained them before. You will explain them
again in the next session, and the one after that, because nothing carries them
across. And a rule that is present but not invoked fails exactly like a rule
that correctly did not apply: silently, and identically from the outside.

**kata makes those routines files**, and puts a bounded catalog of them in front
of the model on every prompt — a short list with trigger phrases, not a wall of
instructions to re-read. A chain is either a checklist returned whole, or a
staged procedure where each step's output must be submitted before the next
step's prompt is handed back.

One thing to be precise about, because the whole value proposition hinges on it:
**kata does not decide which chain is relevant.** The hook never reads your
prompt. It loads every chain, sorts them by scope and name, and lists the first
`HOOK_MAX_CHAINS` with their trigger clauses. The matching is done by the model,
on every turn, exactly as it would be for a skill. What the trigger phrases buy
is *ease of association*, not selection — there is no literal matcher anywhere
in this codebase.

This is a *policy injector and process driver*, deliberately not a "make the
model think harder" tool. That half is already covered by interleaved thinking
in current models, which is why the router sends trivial tasks straight to PASS.

## Concepts

| Chain | Kind | What it does |
|---|---|---|
| `master` | built-in router | Entry point for a non-trivial task. Decides PASS (no chains), `default`, and/or custom chains. |
| `default` | built-in freeform | Step-by-step thoughts with revision and an explicit hypothesis/verification finish. |
| your chains | `*.md` files | `checklist` (returned whole, one call) or `staged` (walked stage by stage). |

Chain files live in three layers; higher shadows lower by name (project > pack
> global):

- **global** — `~/.claude/kata/*.md`, chains that apply everywhere
- **pack** — `~/.claude/kata/packs/<pack>/*.md`, stack-specific chains, opted
  into per project by a committed `<project>/.claude/kata.json` →
  `{ "packs": ["laravel"] }`
- **project** — `<project>/.claude/kata/*.md`

Nothing is ever copied into your projects. A declared pack missing on disk is
reported as invalid rather than silently empty, the same chain name in two packs
loads neither, and an **invalid** project file that shadows a lower-layer chain
blocks it (fail-closed) instead of quietly running the older version.

## Install

Requires **Node 22.18 or newer** — the first release that runs TypeScript
without a flag, which is how the plugin runs from its checkout with nothing
installed and nothing compiled.

In Claude Code (these are commands you type; an agent cannot type them for you,
though it can run the `claude plugin ...` equivalents in a shell):

```
/plugin marketplace add keoy7am/kata-mcp
/plugin install kata@kata
```

Then get some chains. The library is a separate repo, so it has its own history
and you can fork it:

```bash
git clone https://github.com/keoy7am/kata-chains.git ~/.claude/kata
```

That is the whole install. If you skip the library, kata still runs with its two
built-in chains and tells you where to put the rest.

**Verify** in a new session: call `list_chains`. It reports `master`, `default`,
every chain it found, and the layer paths it resolved. If the tool does not
exist, the server never started — check `node --version`.

<details>
<summary>Give this to an agent instead</summary>

> Install kata in Claude Code: run `claude plugin marketplace add keoy7am/kata-mcp`
> and `claude plugin install kata@kata`, check that `node --version` is at least
> 22.18, then clone `https://github.com/keoy7am/kata-chains.git` into
> `~/.claude/kata`. Report what `list_chains` returns afterwards.

</details>

## What it costs

Every prompt carries an injected list of your chains, so this is not free. The
cost is permanent and the benefit is occasional, which is the trade worth
looking at before installing anything:

- The `UserPromptSubmit` hook injects at most `HOOK_MAX_CHAINS` (16) chains
  within `HOOK_MAX_BYTES`, each trigger clause trimmed to `HOOK_MAX_DESC_CHARS`
  (155). Chains past the budget are listed by name only. **Measured against the
  reference library (15 chains): 2,313 bytes per prompt.** The computed ceiling
  is 3,250 bytes. Reproduce it on your own library with
  `node hooks/inject-chains.mjs`.
- A checklist chain costs one round trip. A staged chain costs one per stage,
  and every stage prompt and output stays in context. Choose staged only when
  each step genuinely gates the next.
- Injecting the *summary* half of every description as well was estimated at
  ~30k extra context tokens over 50 turns — about 19 `master` calls' worth, to
  avoid the 1–3 `master` calls a session actually makes. That is why the
  description format splits. **Treat that number as an order-of-magnitude
  estimate, not a measurement**: no tokenizer, snapshot or script was kept, so
  it is not reproducible.
- The values and their sizing rationale live in `src/types.ts`, which is the
  single source of truth for every limit here.

The router exists to keep this honest: trivial tasks are supposed to return
PASS and pay nothing beyond the injected list. Whether that actually happens is
the model's decision, and nothing records it — see below.

## What this does not prove

kata is an experiment, and the honest summary is that **its central claim is
unproven**. If you install it, install it as an experiment.

- **No A/B data.** There is no measurement of rule-following or outcome quality
  with kata versus without. Everything below is mechanism, not efficacy.
- **The hook does not route.** It repeats a bounded catalog; the model still
  does all the matching. Compared with a rule in `CLAUDE.md` or an Agent Skill,
  the differences are position, repetition, boundedness and denser wording —
  the same medicine at a higher dose, not a different mechanism.
- **A staged chain enforces disclosure order, not work.** The engine rejects a
  wrong `expected_stage_index`, so the next prompt cannot be read early. It does
  not check what you submit: `stage_output` has no minimum length, any
  `skip_reason` advances the stage, and a whole chain can be walked to
  `done: true` with placeholder text. It constrains a caller who chose to use
  it; nothing forces that choice.
- **PASS leaves no trace.** `run_chain("master")` opens no session and records
  nothing, so "correctly decided no chain was needed", "rubber-stamped it" and
  "never called master at all" are indistinguishable after the fact.
- **Traces have no reader.** Staged runs write JSONL, but the only code that
  consumes them parses filenames for the repeat signal — nothing reads stage
  content. There is no review tool, quality gate, or completion check. Traces
  record what the model *claimed* it did.
- **16 chains is a capacity choice, not a measured sweet spot.** Nobody has
  tested routing accuracy at 8, 12, 16 or 24 chains. Past the cap, which chains
  keep their trigger clause is decided by scope and name — not by relevance to
  the task at hand.
- **It only surfaces chains that already exist.** Nothing detects that a task
  needed a routine nobody has written yet.
- **Overlap with Agent Skills is real.** For a checklist chain, a skill does
  much the same job. The defensible differences are the staged disclosure
  order, the traces, and the fact that chains are versioned, diffable,
  shareable files — and only the last of those is unambiguously worth
  something.

### Optional: observation mode

**Off by default.** `KATA_OBSERVE=1` appends one JSONL line per prompt to
`<project>/.claude/kata-observations.jsonl`: which chains were offered, which
kept their trigger clause, the injected byte count, the prompt's length and a
short hash, and the session and prompt ids. `KATA_OBSERVE=full` adds the prompt
text itself.

It exists because of a gap that is otherwise unfixable: **the transcript does
not record what a hook injected**, so "was the list even in front of the model
on this turn?" cannot be answered after the fact. That is the missing half of
every question in the section above.

```bash
node scripts/observe-report.mjs            # --project <dir>  --sample N  --json
```

The report joins that log with the Claude Code transcript (calls) and the trace
files (how staged runs went), and prints **recommendations, not statistics** —
every line names a chain and one edit to make to it:

| It says | Because | Threshold |
|---|---|---|
| remove, demote to a pack, or rewrite `Use when` | offered with its full clause on many turns across several sessions, never called | `--min-offered 20`, `--min-sessions 3` |
| rewrite the start of `Use when` | called, but only ever after `master` had listed it in full — the injected clause is not doing the routing | called ≥ 3 times |
| convert to a checklist | staged runs skip most of their stages | `--skip-rate 0.5` |
| shorten it | staged runs are started and not completed | ≤ 50% completed |

The thresholds are judgement calls, so they are printed at the top of every
report rather than hidden. The session gate matters: a chain that one long
session never needed says nothing about the chain, so "never called" is
withheld until several sessions have been observed, and the report says so.

There is deliberately no headline invocation rate. Most turns are not supposed
to need a chain — that is what PASS is for — so "N% of turns called one" is
neither success nor failure and would only invite reading it as one. What the
data cannot decide it says it cannot decide: `master` called and no chain after
it is either a correct PASS or a chain that does not exist yet, and the report
lists that count without a verdict.

The one question none of this answers is whether a chain *should* have been
called on a turn where none was. That is a judgement, and `--sample N` prints
that many such turns (prompt text needs `KATA_OBSERVE=full`) for a person to
make it. Nothing here automates it, on purpose.

Gitignore the log. At `=full` it contains everything you typed.

<details>
<summary>A first look, before this mode existed</summary>

Counting `run_chain` calls straight out of 2,202 local transcripts: of 225
interactive turns after the plugin was installed, 35 called a chain — 15.6%,
and near-identical in the two projects measured (15.9% and 15.1%). Treat it as
an order of magnitude and nothing more: the denominator is every turn rather
than every turn where the list was shown, both projects belong to the author,
and one of them is this repository.

</details>

The comment at the top of `hooks/inject-chains.mjs` records the incident that
shaped the hook's wording: the chain list was injected, the names were printed,
and the model still spent its tool search elsewhere and made zero chain calls.
That is evidence the problem is real. It is equally evidence that this fix
guarantees nothing — and it is a comment, not a captured transcript, so what
you can verify is that the note exists, not that the session happened.

## Writing your own chain

The shipped library is a starting point, not the product. The product is the
chain *you* write for the mistake *your* team keeps making.

```markdown
---
name: my-chain            # lowercase slug = filename = save_chain argument
description: What it does, plus skip-when notes. Use when <the phrases you type>.
mode: checklist           # or: staged
domain: frontend          # optional, display only
language: zh-TW           # optional BCP 47; pins output language
schema_version: 1
---

The checklist body — or, for a staged chain, 2–12 sections:

## Stage: Title
What this stage must produce. (Headings inside fenced code blocks are ignored.)
```

Save it to `~/.claude/kata/my-chain.md`, or have the model write it and call
`save_chain` — which validates before writing and refuses to clobber silently.

### The `description` field is the whole routing signal

It is read by two different consumers, and it splits at the first `Use when`:

- **Before it** — shown only by `run_chain("master")`, which prints descriptions
  in full. Free as far as the prompt hook is concerned, so this is where the
  summary goes, along with cross-references (*"for environment-class silent
  failures use root-cause-isolation instead"*) and skip-when notes.
- **From `Use when` onward** — injected on **every** prompt, truncated. This is
  the only routing signal a model has before it calls anything, so **lead with
  the most distinctive literal phrases someone would actually type**
  (`"worked yesterday, broken today"`, `"find the holes"`, `"TDD"`) and put
  broad task shapes last, where truncation can eat them.

The hook prints the chain name on the same line, so a summary that merely
restates the name is wasted budget — that is why the split exists rather than a
plain head-first trim. Omitting `Use when` entirely drops the hook back to a
head-first slice; `list_chains` reports those under `no_trigger_clause`.

Content language never dictates output language: responses carry an
`output_language` field, defaulting to the language of the conversation.

## Sharing chains

A chain is one Markdown file, so the low-tech path works: `export_chain` returns
the raw source plus a sha256, the receiver reads it and calls `save_chain`.

For anything bigger, share the way the reference library does — a git repo that
someone clones to `~/.claude/kata`, with stack-specific chains under `packs/`.
The `SessionStart` hook fast-forwards that checkout best-effort, so a team's
chains stay current without anyone pulling by hand.

That auto-pull is worth understanding before you point it at someone else's
repo: chain files are prompt text injected into your model, so whoever can push
to that repo can change what your agent is told. Cloning a library is a trust
decision, the same as adding a dependency.

## Tools

- **`list_chains`** — built-ins plus every layer, declared packs (with `found`),
  invalid files with reasons, pack conflicts, shadowing, and the resolved paths.
- **`run_chain {name}`** — start a chain. Checklist: the whole content, no
  session. Staged/freeform: opens a session, snapshotting the chain so edits
  mid-run cannot change it.
- **`advance_chain {session_id, expected_stage_index, stage_output? | skip_reason?, done?}`**
  — submit a stage, get the next. `expected_stage_index` makes timeout retries
  idempotent: re-sending the previous index replays the same response instead of
  duplicating trace entries.
- **`save_chain {name, scope, content, overwrite?}`** — write an
  agent-authored chain. Full validation, atomic write, no silent clobbering.
- **`export_chain {name, scope?}`** — raw Markdown plus sha256, for sharing.

Sessions are in-memory (max 32, LRU-evicted); after a server restart they answer
`SESSION_LOST`. Staged and freeform runs append a JSONL trace under
`<project>/.claude/thinking-traces/` — a diagnostic transcript, not a tamper-proof
audit trail. Gitignore it, and do not paste secrets into stage outputs.

## Standalone MCP (any client)

```json
{ "mcpServers": { "kata": { "command": "npx", "args": ["-y", "kata-mcp"] } } }
```

The trigger skill is a Claude Code plugin feature and a standalone registration
does not get it. `KATA_PROJECT_ROOT`, `KATA_GLOBAL_DIR` and `KATA_PACKS_DIR`
override the default layer locations (the project root defaults to the server
process cwd, and `list_chains` reports what it resolved).

The prompt hook is not exclusive to Claude Code. **Codex CLI** has the same
`UserPromptSubmit` event, with the same `prompt` field on stdin and the same
`hookSpecificOutput.additionalContext` response, so the hook script runs there
unchanged. It lives in the git checkout rather than the npm package (it imports
`src/` directly), so clone the repo and point at it:

```toml
# ~/.codex/config.toml
[[hooks.UserPromptSubmit]]

[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = 'node "/path/to/kata-mcp/hooks/inject-chains.mjs"'
timeout = 5
```

Two Codex specifics, both verified against a live run:

- **Codex skips hooks it has not been told to trust, silently.** Declaring the
  block above does nothing until you open `codex` interactively and approve it
  under `/hooks`; a non-interactive `codex exec` can bypass that once with
  `--dangerously-bypass-hook-trust`. If the chain list never appears, this is
  why.
- Environment variables from `[shell_environment_policy.set]` reach the hook,
  so `KATA_OBSERVE` can be set there. Codex names the turn `turn_id` where
  Claude Code says `prompt_id`; the observation log records either as
  `prompt_id`. The report only knows how to read Claude Code transcripts,
  though, so Codex observations count offers but cannot be joined to calls.

The tool prefix in the injected text is written for the Claude Code plugin, so
on other hosts the ToolSearch line will not match your tool names — the chain
list itself is still correct.

## Updating

Claude Code refreshes the marketplace and the plugin itself; the chain library
updates on its own through the `SessionStart` fast-forward. Restart the session
to pick up a new server version — chain files are re-read on every call and the
prompt hook is a fresh process per prompt, but the MCP server is long-lived and
holds the code it started with.

## Development

```bash
npm ci
npm test         # vitest
npm run typecheck
```

Working on this repo never requires a build: the plugin, the hook and the tests
all read `src/` directly. The published npm package is the one exception, and it
is not a preference — Node refuses to strip types from anything under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a package
shipping raw TypeScript installs cleanly and then fails to start. `prepublishOnly`
compiles `src/` into `dist/`, which is what `bin` points at, and `dist/` is
gitignored so no build output ever sits in the repository going stale.

Releasing: `npm version patch|minor|major`. `package.json` is the single source
of the version — `src/index.ts` reads it at startup, so what the server reports
to clients is derived, and the `version` lifecycle script writes
`.claude-plugin/plugin.json` and the pinned release in `plugin.mcp.json`. The
test suite fails if any of those drift, or if a fourth copy appears.

Two constraints are easy to break by accident and are enforced by tests:
everything the prompt hook imports must stay dependency-free and free of
non-erasable TypeScript (no `enum`, no parameter properties), because that code
runs from a plugin checkout whose dependencies may never have been installed
— a bare `git clone`, an offline machine, a host that skipped or failed the
install.

## Design notes

See [docs/design-notes.md](docs/design-notes.md) for why the chain format,
routing and failure modes are shaped this way — including the ones that came out
of an adversarial review: CAS-style retry semantics, fail-closed shadowing,
canonical naming, atomic writes.

## License

MIT — see [LICENSE](LICENSE).
