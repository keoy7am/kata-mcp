# Security

## Reporting a vulnerability

Report privately through [GitHub's security advisories](https://github.com/keoy7am/kata-mcp/security/advisories/new).
Please do not open a public issue for anything exploitable. Expect a first
response within a week.

## What this software does, in security terms

kata reads Markdown files from disk and returns their contents to a model. It
runs no code from those files, makes no network requests of its own, and writes
only to the two locations below. That keeps the surface small, but there are
three properties worth being explicit about.

**Chain files are prompt injection by design.** A chain is instruction text
that gets placed in front of a model. Anyone who can write to your chain
directories — or push to a chain library you cloned — can change what your agent
is told to do. Treat cloning a chain library like adding a dependency, and
review chains you did not write. Returned chain content is labelled with its
scope and carries an explicit note that it must not override system, security or
user instructions, but that is a mitigation, not a guarantee.

**The `SessionStart` hook runs `git pull --ff-only`** in your global chain
directory when it is a git checkout. It never merges and never touches anything
else, but it does mean upstream changes arrive without you asking. Point
`KATA_GLOBAL_DIR` at a directory with no `.git` to disable it entirely.

**Traces are plaintext.** Staged and freeform runs append JSONL under
`<project>/.claude/thinking-traces/`, containing whatever the model submitted as
stage output. Add that directory to `.gitignore` and do not paste secrets into
stage outputs. The traces are a diagnostic transcript, not a tamper-proof audit
trail: anything with write access to the project can edit them.

## Writes

- `save_chain` writes `<name>.md` into the global or project chain directory —
  validated first, written atomically, and refusing to overwrite without
  `overwrite: true`. Names are restricted to a lowercase ASCII slug, built-in
  names are rejected, and Windows reserved device names (`con`, `aux`, `com1`…)
  are rejected so a chain file can never claim one.
- Trace files under `<project>/.claude/thinking-traces/`.
- `<project>/.claude/kata-observations.jsonl`, **only when `KATA_OBSERVE` is
  set** — off by default. At `KATA_OBSERVE=1` it records what the hook offered
  plus the prompt's length and a truncated hash; at `KATA_OBSERVE=full` it also
  records the prompt text verbatim. Treat that file the way you would treat a
  shell history: gitignore it, and do not enable `full` on a machine where you
  paste credentials into prompts.
- `<project>/.claude/kata-gate.json` and `<project>/.claude/kata-gate.jsonl`,
  **only when `KATA_GATE=1`** — off by default. The first holds per-session
  armed/disarmed state; the second logs each refused tool call (tool name,
  session and prompt ids, no prompt text). Gitignore both.

Nothing else on your filesystem is written, and no path outside those
directories is ever constructed from user- or model-supplied input.
