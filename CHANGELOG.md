# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
