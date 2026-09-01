# Working on kata-mcp

This file is for an agent working *on* this repository. The README is written
for a person deciding whether to install it. They say the same things at
different depths; where they disagree, this file is the one to trust and the
README is the one to fix.

## What is established, what is inferred, what may not be claimed

**Established** (measured in this repo or a live session; reproduce before
relying on a number that matters):

- The hook injects the whole chain catalog every prompt. It never reads the
  prompt. 2,313 bytes for the 15-chain reference library; ceiling 3,250.
- A staged chain enforces disclosure order only. `skip` / `x` walks any chain
  to `done: true`. Traces record skips faithfully; nothing reads them but the
  repeat-signal counter, which parses filenames.
- `run_chain("master")` opens no session and leaves no trace.
- Across 225 interactive turns after install, 35 called a chain (15.6%), the
  same in two unrelated projects. Denominator is every turn, not turns where a
  chain applied.
- The hook's import graph is dependency-free and Node-runnable from a bare
  checkout; the npm package must ship `dist/` because Node refuses to strip
  types under `node_modules`. Both are tested.
- Codex CLI runs the same hook unchanged once trusted under `/hooks`.

**Not established, and not to be written up as if it were:**

- Whether the tool changes outcomes. There is no A/B. The owner's own
  impression is deliberately kept out of this repository: it is one person's
  feel of one setup, and it does not transfer.
- Whether the per-prompt list is what matters, or the chain content, or
  neither. `KATA_HOOK=0` exists so the two can be separated by ablation;
  nobody has run one yet.
- Whether any of this helps a harness that already carries the same
  disciplines in its own instructions. The chains encode checks a user could
  equally keep in `CLAUDE.md`; where they do, the hook is a second copy of the
  same text on a minority of turns, and its marginal value is the file format
  (versioned, diffable, shareable), not the reminder.

**May not be claimed** in code comments, docs, commit messages or tool
descriptions, because each was tried and refuted in review:

- that the hook selects, routes, or matches chains to the prompt;
- that a staged chain enforces work, reasoning, or quality;
- that traces are an audit trail, or that anyone reads them;
- that the tool improves rule-following, output quality, or "attention" —
  there is no A/B, and the observation report deliberately prints no headline
  rate;
- that "N% of turns called a chain" means anything without saying what the
  denominator is;
- that the three numbers in `src/types.ts` (155 chars, the 60-char slice, the
  ~30k-token estimate) are reproducible measurements — they are recorded
  estimates without a script.

## How to check the thing you are about to say

Numbers: `node hooks/inject-chains.mjs` for bytes; `node
scripts/observe-report.mjs` for offers versus calls once
`KATA_OBSERVE=1` has run for a while. Behaviour: run it. A claim about what
the model does on a turn needs a transcript or an observation record, not a
reading of the code.

Ablation is the only way to answer "does any of this help": `KATA_HOOK=0`
turns the injection off with the server still up, so the list and the chains
can be tested separately. The protocol is in the README.

## Constraints that fail silently

Enforced by tests; listed here so a change is made knowingly:

- `hooks/inject-chains.mjs`, `src/loader.ts`, `src/types.ts`, `src/builtins.ts`
  import only `node:` builtins and relative paths.
- No non-erasable TypeScript anywhere in `src/` — no `enum`, no parameter
  properties, `import type` for type-only imports.
- `package.json`, `.claude-plugin/plugin.json` and the pin in `plugin.mcp.json`
  carry one version; `npm version` keeps them aligned. Do not bump without
  publishing — the pin must name a release that exists on npm.
- `KATA_OBSERVE=full` records prompt text. Tests strip the ambient value; a
  developer with it on globally would otherwise fail "writes nothing by
  default".

## Open design question, deliberately undecided

Advisory versus gate. Today the hook advises and nothing enforces. The first
observation sample appeared to contain a prompt that matched a chain's trigger
verbatim and called nothing; on inspection it was a local slash command that
never reached the model at all, which is now excluded by the report and is
itself the lesson — check the transcript before calling anything a miss. A
gate is feasible on both hosts — a `UserPromptSubmit`
hook marks a turn non-trivial by a rule that does not involve the model, a
`PostToolUse` hook on `run_chain` marks that a chain ran, and a `PreToolUse`
hook on `Edit|Write` denies until it has. It would guarantee a call, not a
careful walk, and it would change what this project claims to be. It is not
built. The decision waits on a short observation sample from real work, and
on checking whether slash-command expansions are simply crowding the injected
list out of the model's attention — a fixable cause that would come first.

## Owner's decisions, so they are not relitigated

- No headline invocation rate anywhere. Recommendations with evidence only.
- No literal prompt matching: a matcher that fires only when the user already
  typed the trigger phrase serves the case that needs it least. Reverted once.
- No UI. No fetching chains from URLs. No chains in this repo — the library
  is `kata-chains`.
- Commit messages describe the change and its reason; no session
  identifiers, no agent workflow narration.
