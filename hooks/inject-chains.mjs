// UserPromptSubmit hook: inject a bounded list of available thinking chains.
// Never blocks the user's prompt — but a failure says what failed rather than
// degrading to a chain-free HEAD that looks like normal operation.

// Derived from the plugin name (.claude-plugin/plugin.json) + the MCP server
// name (plugin.mcp.json). Both are fixed, so this name is deterministic; it is
// spelled out so the model can load the tool in one round-trip instead of
// guessing a search query. The hook only runs under the plugin, so the
// standalone name (mcp__kata__*) is deliberately not listed.
const TOOL_PREFIX = "mcp__plugin_kata_chains__";

// The ToolSearch leads, because it is the step that was actually being skipped:
// the tools are deferred, so a model that decides to run a chain still cannot
// call one, and a trailing "Deferred:" footnote read as an aside rather than a
// prerequisite (observed: chains named in the injected list, ToolSearch spent on
// an unrelated server, zero run_chain calls). "Non-trivial" keeps the escape —
// a trivial task should still pay no round-trip.
// master is the arbiter, not a turnstile. The list below already carries each
// chain's trigger phrases, so a recognised task shape can call its chain
// directly; routing through master first would cost a second round-trip to
// re-read what this list already said. master still owns what the list cannot
// carry: the PASS/DEFAULT judgement, the "default" freeform chain, the repeat
// facts from trace history, and the full descriptions with their cross-
// references ("for this shape, use that chain instead").
// Every byte here is a byte no chain gets, so it stays terse: against
// HOOK_MAX_BYTES this ~440-byte HEAD is already a chunk of the budget.
const HEAD = [
  `kata (tools deferred). Non-trivial task → step 1: ToolSearch("select:${TOOL_PREFIX}run_chain,${TOOL_PREFIX}advance_chain").`,
  'Step 2: task matches a chain below → run_chain("<name>"); no match, or multi-step reasoning / planning / hard debugging → run_chain("master") routes it (also holds "default" + repeat facts). Trivial task → no chain.',
].join("\n");

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
}

try {
  // Shares the real loader and LIMITS (single source for validation and caps),
  // resolved relative to this script. TypeScript straight from src: Node strips
  // the types (>= 22.18), and this import path is dependency-free on purpose —
  // the hook has to work in a plugin checkout where nothing was ever installed.
  const { loadAll, resolveOptions } = await import(new URL("../src/loader.ts", import.meta.url));
  const { LIMITS } = await import(new URL("../src/types.ts", import.meta.url));
  const { chainHint } = await import(new URL("../src/builtins.ts", import.meta.url));
  const opts = resolveOptions({
    ...process.env,
    KATA_PROJECT_ROOT: process.env.KATA_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  });
  const load = loadAll(opts);

  // project > pack > global, then by name. Ordering only decides who keeps a
  // hint when the budget runs out, so it must not depend on anything as
  // incidental as file mtime: a library-wide reformat rewrites every file and
  // silently reshuffles which chains stay routable.
  const rank = (s) => (s === "project" ? 0 : s.startsWith("pack:") ? 1 : 2);
  const chains = [...load.chains].sort(
    (a, b) => rank(a.scope) - rank(b.scope) || a.name.localeCompare(b.name),
  );

  // Names + a trimmed hint are enough here — run_chain("master") carries the
  // full descriptions. Trimming lets many chains fit instead of a verbose few;
  // chainHint keeps the "Use when" trigger half, since the summary half only
  // restates the name printed beside it.
  const lines = [HEAD];
  const shown = new Set();
  for (const c of chains.slice(0, LIMITS.HOOK_MAX_CHAINS)) {
    const candidate = `- ${c.name}: ${chainHint(c.description)}`;
    if (Buffer.byteLength([...lines, candidate].join("\n"), "utf8") > LIMITS.HOOK_MAX_BYTES) break;
    lines.push(candidate);
    shown.add(c.name);
  }
  // Chains that did not fit with a description still get named (names are
  // ~20 bytes; visibility matters more than the hint). If the name list itself
  // does not fit, described lines are demoted to names until everything fits.
  const rest = chains.filter((c) => !shown.has(c.name)).map((c) => c.name);
  if (rest.length) {
    const tail = () => `- also: ${rest.join(", ")}`;
    const over = () =>
      Buffer.byteLength([...lines, tail()].join("\n"), "utf8") > LIMITS.HOOK_MAX_BYTES;
    while (over() && lines.length > 1) {
      const demoted = lines.pop();
      rest.unshift(demoted.slice(2, demoted.indexOf(":")));
    }
    if (!over()) lines.push(tail());
  }
  emit(lines.join("\n"));
} catch (err) {
  // Still never block the prompt — but say so. A bare HEAD with no chain list is
  // indistinguishable from "this machine has no chains", and that ambiguity is
  // what let a loader failure pass for normal operation.
  emit(
    `${HEAD}\n(chain list unavailable — could not load the chain loader: ${err?.message ?? err}. The chains themselves may be fine; routing is running blind.)`,
  );
}
