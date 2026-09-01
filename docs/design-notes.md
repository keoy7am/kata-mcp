# Design notes

Why the pieces are shaped the way they are. Each section states the failure it
is defending against, because that is the part that gets lost first.

## Chains are files, not server code

The official `sequentialthinking` server's entire value lives in its tool
description: it counts thoughts and hands them back. Anything domain-specific
has to be re-explained by the user, every session.

kata inverts that. The server is a loader and a driver; the content lives in
Markdown files you own, version, and diff. A chain is reviewable in a pull
request, and a bad chain is a revert rather than a patch release.

The consequence worth accepting: this project ships no chains. The reference
library is a separate repository with its own history. Two copies of the same
chain would drift, and the drift would be silent — the user's copy and the
repo's copy are never compared by anything.

## The description field splits at `Use when`

Two consumers read a chain description. `run_chain("master")` prints it whole;
the `UserPromptSubmit` hook injects a truncated slice on every prompt.

A head-first trim gave the hook the worst possible half: measured against a
14-chain library, a 60-character head slice cut the trigger clause off *every*
chain, leaving nothing but names to route on. Splitting at `Use when` lets the
summary be as long as it needs to be while the injected half stays dense with
literal trigger phrases.

Injecting both halves was measured too: roughly 30k additional context tokens
over 50 turns, to save the one to three `master` calls a session actually makes.
The split is cheaper than either extreme.

## Budgets are derived, not hand-set

`HOOK_MAX_BYTES` is computed from `HOOK_MAX_CHAINS` and `HOOK_MAX_DESC_CHARS`
rather than typed in. When it was a fixed 2400, a 15-chain library had 16 bytes
of headroom, and the sixteenth chain would have silently degraded to a name with
nothing reporting it. A cap that can quietly undercut another cap is a bug with
no error message.

All limits live in one object in `src/types.ts` so the hook, the loader and the
tool descriptions cannot disagree about them.

## Failure is closed, not quiet

Every ambiguous state resolves toward refusing rather than guessing:

- An **invalid project chain file** whose name shadows a working global chain
  blocks that name entirely. Falling back to the global version would run a
  different procedure than the one the project asked for, and nothing would say
  so.
- The **same chain name in two declared packs** loads neither. There is no
  defensible winner, and picking one silently makes the loser's absence
  invisible.
- A **declared pack that is not on disk** is reported as invalid — meaning the
  library needs a pull — rather than treated as zero chains. "Missing" and
  "empty" are different answers.
- A **directory that cannot be read** (permissions, I/O) is reported, not
  treated as empty. "Could not tell" is a third outcome, and collapsing it into
  "no chains" produces a confident wrong answer.
- When the prompt hook cannot load the chain list, it still never blocks the
  prompt — but it says the list is unavailable. A bare header with no chains is
  indistinguishable from a machine that simply has none, and that ambiguity let
  a loader failure pass for normal operation once already.

## Retries are idempotent, sessions are snapshots

`advance_chain` takes an `expected_stage_index`. Re-sending the previous index
replays the same response instead of appending a second trace entry and skipping
a stage — a timeout that already reached the server would otherwise silently
advance the chain twice.

`run_chain` snapshots the chain content into the session. Editing a chain file
mid-run cannot change a procedure that is already underway, and the trace
records the sha256 of what actually ran.

## Names are canonical, writes are atomic

`save_chain` accepts a lowercase ASCII slug only, rejects built-in names, and
rejects Windows reserved device names (`con`, `aux`, `com1`…) so a chain file
can never claim one. It writes to a temporary file and renames — or, without
`overwrite: true`, creates exclusively and fails with `CHAIN_EXISTS`. A partially
written chain file would be an invalid file that blocks the name it shadows,
which is the fail-closed rule turning into a footgun.

## The repeat signal is a count, not a verdict

A `deepening_alert` reports how many traced sessions of a chain started in the
last 48 hours. That is evidence of repetition, not proof that the work is going
in the wrong direction — the distinction is stated in the payload, because a
count presented as a judgement invites the model to change course on no
information.

## One runtime, no committed build output, no dependencies where it matters

Node runs the TypeScript directly (22.18+). No build artifact is committed, so
there is no way for a stale build to run code that no longer matches the source
— a failure mode with no error message and no diff.

The npm package is compiled, and that split is forced rather than chosen: Node
refuses to strip types from files under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a package shipping raw
TypeScript installs successfully and then fails to start — the worst shape of
failure, discovered by users rather than by CI. The compile happens in
`prepublishOnly` and its output is gitignored, which keeps the property that
matters: nothing in the repository can be older than the source beside it.

The hook's import graph — `hooks/inject-chains.mjs`, `src/loader.ts`,
`src/types.ts`, `src/builtins.ts` — is dependency-free, because the plugin
checkout cannot count on ever getting an `npm install` — a bare `git clone`, an
offline machine, or a host that skipped or failed the install all reach the same
state. That is why frontmatter is parsed by hand
instead of with a YAML library, and why the loader's validation does not use the
schema library the MCP server uses. A test asserts the property directly; CI
runs the hook in a checkout with no `node_modules`, which is the only place the
real condition exists.

Non-erasable TypeScript is banned for the same reason: Node strips types without
resolving them, so `enum`, parameter properties and a type imported as a value
all fail at runtime rather than at compile time.

## Deliberately not built

- **Session persistence across restarts.** Sessions are in-memory and answer
  `SESSION_LOST` after a restart. The minimum honest implementation is a
  persisted snapshot plus a last-submission key; until someone actually hits the
  case, it is speculative state.
- **A statistics UI.** The traces are JSONL on disk and anything can read them.
  A dashboard would reintroduce a server, a build, and an install step, which is
  most of what this project spent its design budget avoiding.
- **Fetching chains from URLs.** Chains are prompt text. Auto-installing someone
  else's chains widens the injection surface without the user ever making a
  trust decision. Cloning a library is that decision, made explicitly.
