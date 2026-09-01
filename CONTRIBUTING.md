# Contributing

Bug reports and small fixes are welcome without ceremony. For anything that
changes behaviour, open an issue first — this is a small tool with a deliberately
narrow scope, and the fastest way to waste an afternoon is to build something
that gets declined on scope.

## Setup

```bash
npm ci
npm test
npm run typecheck
```

Node 22.18 or newer. Nothing you run here needs a build — the plugin, the hook
and the tests all read `src/` directly. `npm run build` exists only for
publishing (`prepublishOnly`), because Node cannot strip types under
`node_modules`; its output is gitignored.

## Two constraints that break silently

Both are enforced by tests, and both exist because the prompt hook runs inside a
plugin checkout where `npm install` has never been run.

1. **`hooks/inject-chains.mjs`, `src/loader.ts`, `src/types.ts` and
   `src/builtins.ts` may import only `node:` builtins and relative paths.**
   Adding a package to that graph passes every test on your machine and breaks
   on every user's.
2. **No non-erasable TypeScript anywhere in `src/`** — no `enum`, no
   constructor parameter properties, no decorators, and type-only imports must
   use `import type`. Node strips types without resolving them, so a type
   imported as a value is a runtime error rather than a compile error.

## Scope

kata injects procedures and drives them. It is not a place for:

- Making the model "think more" — current models already do, and the router
  sends trivial tasks to PASS for exactly that reason.
- Dashboards, web UIs, or anything that reintroduces an install step. Reading
  the JSONL traces is a fine thing to build; build it as a separate tool.
- Fetching chains from arbitrary URLs. Chains are prompt text, so anything that
  auto-installs someone else's chains widens the injection surface without a
  user ever making a trust decision.

New chains belong in [kata-chains](https://github.com/keoy7am/kata-chains), not
here. This repo ships no chains on purpose: one source of truth, no copies to
drift.

## Pull requests

- One concern per pull request.
- A behaviour change comes with a test that fails before it.
- Comments should say *why*, not restate the code. Several comments in this
  codebase record a measured number or a failure that actually happened —
  that is the bar.
- Keep the README honest. If a change alters what installation requires or what
  it costs per prompt, the README's "Install" and "What it costs" sections are
  part of the change.
