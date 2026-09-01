// `import type` is load-bearing, not tidiness: Node strips types without
// resolving them, so a type imported as a value becomes a missing export at
// runtime. Same rule in every file the server and the hook load.
import { LIMITS } from "./types.ts";
import type { LoadResult } from "./types.ts";

/**
 * One-line hint for a chain in the UserPromptSubmit hook, where the byte budget
 * only allows a fragment of the description.
 *
 * Chain descriptions are authored as "<what it does>. Use when <task shapes>"
 * (see skills/kata/SKILL.md). The leading summary mostly restates the
 * chain name, which the hook already prints on the same line; the "Use when"
 * clause is the only part that lets a task be matched to a chain. A head-first
 * slice therefore keeps the redundant half: measured against the 14-chain
 * library, a 60-char head slice cut the trigger clause off every single chain,
 * leaving chain names as the only routable signal in the prompt.
 */
/**
 * Words too common to carry routing signal on their own. Deliberately short:
 * the score threshold, not this list, is what keeps noise out.
 */
const STOPWORDS = new Set([
  "when", "use", "used", "using", "this", "that", "these", "those", "them", "they", "their",
  "with", "without", "from", "into", "your", "you", "yours", "have", "has", "been", "than",
  "then", "there", "what", "which", "while", "would", "could", "should", "about", "after",
  "before", "because", "only", "also", "just", "even", "more", "most", "some", "such", "very",
  "over", "under", "between", "through", "during", "against", "within", "across", "upon",
  "onto", "each", "every", "both", "other", "another", "same", "still", "already", "does",
  "doing", "done", "needs", "need", "make", "makes", "made", "take", "takes", "here",
]);

const QUOTED = /"([^"]{3,})"/g;
const WORD = /[a-z][a-z0-9'-]{3,}/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How strongly one chain's trigger clause matches a prompt. Quoted literals and
 * the chain's own name score 3 (either alone clears the threshold); an
 * individual significant word scores 1, so two of them are needed. Nothing here
 * is semantic — a prompt in a language the chain was not written in scores 0,
 * and that is the intended behaviour, because zero matches means "fall back to
 * the full list" rather than "guess".
 */
export function scoreChain(chain: { name: string; description: string }, prompt: string): number {
  const lower = prompt.toLowerCase();
  const desc = chain.description ?? "";
  const at = desc.search(/Use when/i);
  const trigger = (at >= 0 ? desc.slice(at + "Use when".length) : desc).toLowerCase();

  let score = 0;
  for (const m of trigger.matchAll(QUOTED)) {
    if (lower.includes(m[1].trim())) score += 3;
  }
  const name = chain.name.toLowerCase();
  if (lower.includes(name) || lower.includes(name.replace(/-/g, " "))) score += 3;

  const seen = new Set<string>();
  for (const w of trigger.match(WORD) ?? []) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    if (new RegExp(`\\b${escapeRe(w)}\\b`).test(lower)) score += 1;
  }
  return score;
}

export const MATCH_MIN_SCORE = 2;

/**
 * Split chains into the ones whose triggers appear in the prompt and the rest.
 * An empty `matched` is the normal, safe outcome: the caller then shows every
 * chain exactly as it would without matching at all.
 */
export function matchChains<T extends { name: string; description: string }>(
  chains: T[],
  prompt: string,
  minScore: number = MATCH_MIN_SCORE,
): { matched: T[]; rest: T[] } {
  if (!prompt || !prompt.trim()) return { matched: [], rest: chains };
  const scored = chains.map((chain) => ({ chain, score: scoreChain(chain, prompt) }));
  const matched = scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || a.chain.name.localeCompare(b.chain.name))
    .map((s) => s.chain);
  const hit = new Set(matched.map((c) => c.name));
  return { matched, rest: chains.filter((c) => !hit.has(c.name)) };
}

export function chainHint(description: string, maxChars: number = LIMITS.HOOK_MAX_DESC_CHARS): string {
  const at = description.search(/Use when/i);
  const src = at > 0 ? description.slice(at) : description;
  return src.length > maxChars ? src.slice(0, maxChars) + "…" : src;
}

/**
 * The two built-in chains. All of this server's leverage lives in prompt
 * quality — treat these texts as the product, not as boilerplate.
 */

export function buildMasterContent(load: LoadResult, deepeningAlerts: string[] = []): string {
  const rows = load.chains
    .map(
      (c) =>
        `- ${c.name} (${c.mode}${c.mode === "staged" ? `, ${c.stages.length} stages` : ""}, ${c.scope}): ${c.description}`,
    )
    .join("\n");

  // An empty library and a deliberately chain-free project look identical from
  // here, and the hooks fail silent by design — so this message has to name the
  // directories that were searched, or a machine that never got the library just
  // routes PASS/default forever with nothing to explain why.
  const extras = rows
    ? `Available custom chains:\n${rows}`
    : `No custom chains loaded — only PASS or "default" apply. Nothing was found in ${load.globalDir} (global) or ${load.projectDir} (project). If this machine never received the chain library, that is the cause: the SessionStart hook only fast-forwards an existing checkout, it never creates one.`;

  return `# Master Thinking Router

You are at the routing step. Decide — based on the task you are about to do right now — which thinking chains (if any) to activate. Then act on that decision immediately; do not report the decision back to this server.

Decision rules, in order:

1. PASS — the task is simple: a single-step edit, a direct factual answer, one obvious tool call, or plain instruction-following with few constraints. Activate NO chains and just do the task. Forcing chains onto trivial work only adds cost.
2. DEFAULT — the task needs genuine multi-step reasoning: planning, debugging with unclear root cause, design trade-offs, or anything where you may need to revise course midway. Call run_chain("default") and think step by step through it.
3. EXTRA — the task's shape matches one or more custom chains below (read their descriptions; they state when to use them). Call run_chain("<name>") for each match. A checklist chain returns one complete checklist to apply; a staged chain walks you through stages via advance_chain. Extra chains may be combined with "default" (typically: default for the reasoning, extra chains as passes/checkpoints on the result).

${extras}

Repeat-signal contract:
- A deepening_alert returned by any later run_chain is a count of traced staged/freeform session starts, not proof that the work is going in the wrong direction.
- Before advance_chain on an alerted session, perform one direction-level stop/go review. Choose any matching review/stop chain from the live descriptions above; if none fits, inline identify the external signal advanced, decide continue/redirect/escalate, and set a concrete stop point.
- If the alerted chain is itself the selected review chain, continue that current session once; do not start the same chain again merely to satisfy this contract.
${
  deepeningAlerts.length
    ? `\nREPEAT FACTS — observed traced session starts in this project (${deepeningAlerts.join(
        "; ",
      )}). Apply the standing repeat-signal contract before continuing an alerted session.\n`
    : ""
}
Pick the cheapest option that genuinely covers the task. When in doubt between PASS and DEFAULT, consider: would a wrong first approach be expensive to unwind? If yes, DEFAULT.`;
}

export function buildDefaultInstructions(): string {
  return `# Default Sequential Thinking (freeform)

Work through the problem as a sequence of explicit thoughts. Each thought is one call to advance_chain({session_id, expected_stage_index, stage_output}).

Guidelines:
- Start by estimating how many thoughts you will need; adjust the estimate freely as understanding deepens — going past it is normal.
- Each thought can be an analysis step, a question about a previous decision, a realization that more analysis is needed, or a change of approach.
- You may revise earlier thinking: say explicitly which earlier thought you are revising and why.
- Express uncertainty when it exists. Explore alternatives; backtrack when a path dead-ends.
- Before finishing: state a solution hypothesis, then verify it against your chain of thoughts. If verification fails, keep thinking.
- Only when the hypothesis is verified and the answer is correct, send your final thought with done: true.
- Not every thought needs to build linearly — but every thought must move understanding forward. No filler steps.`;
}

/**
 * Metadata rows so built-ins appear in list_chains (scope: "builtin").
 * Their modes are the ones run_chain actually returns ("router"/"freeform"),
 * not the file-chain modes — a client picking its call flow from this
 * metadata must not be misled into staged semantics.
 */
export function builtinListEntries(): {
  name: string;
  description: string;
  mode: "router" | "freeform";
  scope: "builtin";
}[] {
  return [
    {
      name: "master",
      description:
        "Master thinking router — the arbiter when the task shape does not clearly match a chain, or when it needs multi-step reasoning: decides PASS (no chains) / default (freeform sequential thinking) / extra chains, and reports this project's repeat facts.",
      mode: "router",
      scope: "builtin",
    },
    {
      name: "default",
      description:
        "Freeform sequential thinking (official-style): step-by-step thoughts with revision, uncertainty, hypothesis and verification. Open-ended; finish with done: true.",
      mode: "freeform",
      scope: "builtin",
    },
  ];
}
