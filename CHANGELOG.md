# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.1]: https://github.com/keoy7am/kata-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/keoy7am/kata-mcp/releases/tag/v1.0.0
