<div align="center">

<img src="assets/logo.svg" width="72" height="72" alt="">

# kata

**Reusable thinking routines for coding agents.**

[![CI](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/keoy7am/kata-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kata-mcp.svg)](https://www.npmjs.com/package/kata-mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

</div>

## The problem

Modern models think perfectly well on their own. What they do not do is
reliably remember, at the moment it matters, *which procedure this particular
task deserves* — what to check before calling something done, where to cut into
an unfamiliar bug, whether an abstraction is earning its place.

You know those routines. You have explained them before. You will explain them
again in the next session, and the one after that, because nothing carries them
across.

**kata makes those routines files.** You write them once, keep them in version
control, and a router puts the relevant ones in front of the model on every
prompt — as a bounded list it can act on, not a wall of instructions it has to
re-read. A chain can be a checklist returned whole, or a staged procedure that
walks the model through one step at a time, each step's output written before
the next step's prompt is seen.

This is a *policy injector and process driver*, deliberately not a "make the
model think harder" tool. That half is already covered by interleaved thinking
in current models, which is why the router sends trivial tasks straight to PASS
and costs you nothing.

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

Every prompt carries an injected list of your chains, so this is not free and
the numbers are worth stating plainly:

- The `UserPromptSubmit` hook injects at most `HOOK_MAX_CHAINS` (16) chains
  within `HOOK_MAX_BYTES`, each trigger clause trimmed to `HOOK_MAX_DESC_CHARS`
  (155). Chains past the budget are listed by name only. That is roughly
  **1–3 KB of context per prompt**, and it is the entire routing signal.
- Injecting the *summary* half of every description as well was measured at
  **~30k extra context tokens over 50 turns** — about 19 `master` calls' worth,
  to avoid the 1–3 `master` calls a session actually makes. That is why the
  description format splits, and why only the trigger half is injected.
- A checklist chain costs one round trip. A staged chain costs one per stage,
  and every stage prompt and output stays in context. Choose staged only when
  each step genuinely gates the next.
- The values and their sizing rationale live in `src/types.ts`, which is the
  single source of truth for every limit here.

The router exists to keep this honest: trivial tasks are supposed to return
PASS and pay nothing beyond the injected list.

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

The prompt hook and the trigger skill are Claude Code plugin features, so a
standalone registration does not get them — `master` then has to be called by
hand. `KATA_PROJECT_ROOT`, `KATA_GLOBAL_DIR` and `KATA_PACKS_DIR` override the
default layer locations (the project root defaults to the server process cwd,
and `list_chains` reports what it resolved).

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
