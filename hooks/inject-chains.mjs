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

/**
 * Observation mode (KATA_OBSERVE=1, or =full to include the prompt text).
 *
 * The transcript does not record what a hook injected, so "was the list even in
 * front of the model on this turn?" is unanswerable after the fact — which is
 * why this project has never been able to say anything about whether chains get
 * used when they should. Writing the offer down is the only way to get that
 * side of the pair; the other side is already in the transcript, and
 * `prompt_id` joins them.
 *
 * Off by default. It records what your agent was offered and, at =full, what
 * you typed — so it is a file worth reading before enabling and worth
 * gitignoring after.
 */
async function readPayload() {
  if (!process.env.KATA_OBSERVE && process.env.KATA_GATE !== "1") return null;
  try {
    const raw = await Promise.race([
      new Promise((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (c) => (data += c));
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", () => resolve(""));
      }),
      new Promise((resolve) => setTimeout(() => resolve(""), 300)),
    ]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Routing gate (KATA_GATE=1): arm on a non-trivial prompt. A trivial prompt
 * leaves the marker as it is rather than disarming it: the first sample of
 * real work had a six-character "continue the task" followed by 153 tool
 * calls, so a short prompt inherits the blast radius of the task before it,
 * and the only thing that should clear the gate is a chain call. The rule
 * lives in src/gate.ts; the enforcement lives in hooks/gate.mjs.
 */
async function arm(payload) {
  if (process.env.KATA_GATE !== "1" || !payload) return;
  try {
    const { isTrivialPrompt, writeGate, GATE_MIN_CHARS_DEFAULT } = await import(new URL("../src/gate.ts", import.meta.url));
    const min = Number(process.env.KATA_GATE_MIN_CHARS) || GATE_MIN_CHARS_DEFAULT;
    if (isTrivialPrompt(typeof payload.prompt === "string" ? payload.prompt : "", min)) return;
    const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    writeGate(cwd, payload.session_id || "unknown", {
      armed: true,
      reason: "prompt",
      prompt_id: payload.prompt_id ?? payload.turn_id ?? null,
    });
  } catch {
    /* the gate must never cost the user their chain list */
  }
}

async function observe(payload, offered, context) {
  if (!payload || !process.env.KATA_OBSERVE) return;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { createHash } = await import("node:crypto");
    const root = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const dir = path.join(root, ".claude");
    fs.mkdirSync(dir, { recursive: true });
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    const record = {
      ts: new Date().toISOString(),
      session_id: payload.session_id ?? null,
      // Joins to `promptId` in the Claude Code transcript, which is where the
      // run_chain calls for this same turn live. Codex sends the same idea
      // under `turn_id`; recorded under one name so the report has one key.
      prompt_id: payload.prompt_id ?? payload.turn_id ?? null,
      cwd: root,
      injected_bytes: Buffer.byteLength(context, "utf8"),
      prompt_chars: prompt.length,
      prompt_sha256: prompt ? createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16) : null,
      offered,
      ...(process.env.KATA_OBSERVE === "full" ? { prompt } : {}),
    };
    fs.appendFileSync(path.join(dir, "kata-observations.jsonl"), JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* observation must never cost the user their chain list */
  }
}

// KATA_HOOK=0 switches the injection off while leaving the MCP server up. It
// exists so the two halves of this plugin can be tested separately: whether
// the per-prompt list changes anything is a different question from whether
// the chains do, and with the plugin as the only switch they cannot be told
// apart. Emitting nothing is the whole behaviour — no header, no note — so an
// ablation compares against a genuine absence rather than a different prompt.
if (process.env.KATA_HOOK === "0") process.exit(0);

// Read before anything else can fail: an observation of a run that then threw
// is still worth having, and stdin is only consumed when observing is on.
const payload = await readPayload();
await arm(payload);

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
  const context = lines.join("\n");
  emit(context);
  await observe(
    payload,
    chains.map((c) => ({ name: c.name, scope: c.scope, full: shown.has(c.name) })),
    context,
  );
} catch (err) {
  // Still never block the prompt — but say so. A bare HEAD with no chain list is
  // indistinguishable from "this machine has no chains", and that ambiguity is
  // what let a loader failure pass for normal operation.
  emit(
    `${HEAD}\n(chain list unavailable — could not load the chain loader: ${err?.message ?? err}. The chains themselves may be fine; routing is running blind.)`,
  );
}
