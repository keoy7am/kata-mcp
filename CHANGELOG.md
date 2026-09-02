# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `KATA_GATE=1` (experiment, off by default): a `PreToolUse` hook refuses the
  first `Edit`/`Write` and every `git commit` after a non-trivial prompt until
  a chain has been called in that prompt, and re-arms after each commit.
  "Non-trivial" is a length-and-acknowledgement rule, not the model; a
  trivial prompt leaves the gate as it is, since a short "continue" inherits
  the task before it. Refusals
  are logged to `<project>/.claude/kata-gate.jsonl`. It guarantees a call,
  not a followed procedure, and nothing about its effect is claimed. The
  off path exits before reading stdin and is tested to write nothing.
- `KATA_HOOK=0` switches the prompt injection off while the MCP server stays
  up, and emits nothing at all rather than an "off" note, so an ablation
  compares against genuine absence. With the plugin as the only switch, "does
  the per-prompt list change anything" and "do the chains change anything"
  could not be separated. Tested.
- A `CLAUDE.md` for agents working on this repository: what is established,
  what is not, and a list of claims that were each tried and refuted in
  review and may not be made again.
- `scripts/before-after.py`, the analysis behind the README's statement that
  a before/after on the author's transcripts found no consistent signal. It
  reads local Claude Code transcripts and stratifies by model and version;
  the README bullet quotes its output.
- `scripts/before-after-by-context.py`, the same comparison at matched
  context depth, bucketing each turn by the prompt size the model actually saw
  (`usage` on the first assistant reply). The before period is dominated by
  one-turn sessions with a 42k median peak context and the after period by
  five-turn sessions at 158k, so an unmatched comparison mostly measures that.
  In the one bucket both periods populate (≥200k tokens) the split is the
  same as before: one model better on every proxy, the other worse.

### Fixed

- The observation report no longer counts a prompt the model never answered
  as a turn where no chain was called. Local slash commands (`/goal`, `/model`)
  still fire `UserPromptSubmit` and get observed, but no assistant entry ever
  follows them; the transcript now decides, and such prompts are excluded and
  counted separately. The first real sample produced a false "matched trigger,
  called nothing" from exactly this.

### Changed

- `skills/kata/SKILL.md` no longer says master must be called before any
  other tool or that deciding a task is trivial without it does not count.
  Chains are procedures the model chooses to run; PASS, and not calling at
  all, are legitimate. The old wording was stronger than anything the README
  is willing to claim, and was itself manufacturing part of the measured
  invocation rate.

- Observation mode (`KATA_OBSERVE=1`, or `=full` to include the prompt text).
  Off by default. Appends one JSONL line per prompt to
  `<project>/.claude/kata-observations.jsonl` recording which chains were
  offered, which kept their trigger clause, the injected byte count, the
  prompt's length and a short hash, and the session and prompt ids.
  The Claude Code transcript does not record what a hook injected, so without
  this there is no way to ask afterwards whether the list was even in front of
  the model on a given turn.
- `scripts/observe-report.mjs`, which joins that log with the transcript and
  the trace files and prints recommendations rather than statistics: a chain
  never called across enough sessions, a chain only ever reached through
  `master`, a staged chain whose stages are mostly skipped, a staged chain whose
  runs are abandoned. Thresholds (`--min-offered`, `--min-sessions`,
  `--skip-rate`) are printed on every report. There is no headline invocation
  rate on purpose; `--sample N` prints turns with no call for a person to judge.
  Assistant transcript entries carry no prompt id, so calls are attributed by
  transcript order; only `user` entries carry the id, and tool results repeat
  it, which puts the boundary in the right place.
- The observation record takes Codex's `turn_id` as `prompt_id` when Claude
  Code's field is absent, so the two hosts log one key. Documented that the
  prompt hook runs unchanged under Codex CLI, that Codex silently skips a hook
  until it is trusted under `/hooks`, and that `[shell_environment_policy.set]`
  is where `KATA_OBSERVE` goes there — all three checked against a live
  `codex exec`.

## [1.0.2] — 2026-09-01

### Changed

- Documentation only. The README stopped claiming the hook selects relevant
  chains — it does not read the prompt at all — and gained a TL;DR plus a
  section stating that the central claim is unproven. Published so the page on
  npm carries the corrected text rather than the claim it replaced.

## [1.0.1] — 2026-09-01

### Fixed

- A chain library's own documentation is no longer reported as invalid chain
  files. `README.md` was already skipped, but its translations
  (`README.zh-TW.md`) and the rest of a repository's paperwork
  (`CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`…) were not, so every clone
  of a normal library carried permanent noise in `list_chains`. Those names are
  now skipped only when the file has no frontmatter, so a chain legitimately
  named `security.md` still loads and a chain that lost its frontmatter is
  still reported.

## [1.0.0] — 2026-09-01

First public release.

### Added

- MCP server exposing `list_chains`, `run_chain`, `advance_chain`, `save_chain`
  and `export_chain`.
- Built-in `master` routing chain (PASS / `default` / custom chains) and
  `default` freeform chain.
- File-defined chains across three layers — global, pack, project — with
  project > pack > global shadowing, fail-closed handling of invalid overrides,
  and pack conflicts that load neither side.
- Claude Code plugin: `UserPromptSubmit` hook injecting a bounded chain list,
  `SessionStart` hook fast-forwarding the chain library, and a trigger skill.
- JSONL execution traces per staged/freeform run, with a repeat signal over a
  48-hour window.

[1.0.2]: https://github.com/keoy7am/kata-mcp/releases/tag/v1.0.2
[1.0.1]: https://github.com/keoy7am/kata-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/keoy7am/kata-mcp/releases/tag/v1.0.0
