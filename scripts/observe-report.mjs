// Reads what observation mode recorded and joins it against the Claude Code
// transcript to answer the one question this project could never answer:
// on the turns where the chain list was actually in front of the model, how
// often did a chain get called, and which chains never get called at all?
//
//   node scripts/observe-report.mjs [--project <dir>] [--json]
//
// The offer side comes from <project>/.claude/kata-observations.jsonl, written
// by the prompt hook when KATA_OBSERVE is set. The use side comes from the
// transcript, located by session id. `prompt_id` joins them.
//
// What this measures is invocation, not appropriateness. A low rate is not a
// failure: most turns are not supposed to need a chain. The number that means
// something without any judgement call is the per-chain one — a chain offered
// hundreds of times and never called has triggers that do not work.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const projectAt = args.indexOf("--project");
const project = projectAt >= 0 ? args[projectAt + 1] : process.cwd();

const logPath = join(project, ".claude", "kata-observations.jsonl");
if (!existsSync(logPath)) {
  console.error(`No observations at ${logPath}`);
  console.error("Enable them with KATA_OBSERVE=1 (or =full to record prompt text) and use the agent for a while.");
  process.exit(1);
}

const records = readFileSync(logPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

/** session id -> transcript path, searched once across the projects tree. */
function transcriptIndex(sessionIds) {
  const base = join(homedir(), ".claude", "projects");
  const wanted = new Set([...sessionIds].map((id) => `${id}.jsonl`));
  const found = new Map();
  let dirs = [];
  try {
    dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return found;
  }
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(join(base, dir.name));
    } catch {
      continue;
    }
    for (const name of names) {
      if (wanted.has(name)) found.set(name.replace(/\.jsonl$/, ""), join(base, dir.name, name));
    }
  }
  return found;
}

/**
 * prompt_id -> chain names called during that exchange.
 *
 * Only `user` entries carry `promptId`; assistant entries carry none, so the
 * id has to be carried forward in transcript order. Tool results are `user`
 * entries too and repeat the same id, which is what makes the boundary land in
 * the right place: the id only changes when a new prompt is submitted.
 */
function chainsCalled(transcriptPath) {
  const byPrompt = new Map();
  let text;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return byPrompt;
  }
  let current = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "user" && entry.promptId) {
      current = entry.promptId;
      continue;
    }
    if (entry.type !== "assistant" || !current) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || !/run_chain/.test(block.name ?? "")) continue;
      const name = block.input?.name;
      if (typeof name !== "string") continue;
      if (!byPrompt.has(current)) byPrompt.set(current, new Set());
      byPrompt.get(current).add(name);
    }
  }
  return byPrompt;
}

const sessions = new Set(records.map((r) => r.session_id).filter(Boolean));
const transcripts = transcriptIndex(sessions);
const called = new Map();
for (const [sessionId, path] of transcripts) {
  for (const [promptId, names] of chainsCalled(path)) called.set(promptId, names);
  void sessionId;
}

let turnsWithCall = 0;
const offeredCount = new Map();
const calledCount = new Map();
const bytes = [];

for (const r of records) {
  bytes.push(r.injected_bytes ?? 0);
  for (const o of r.offered ?? []) offeredCount.set(o.name, (offeredCount.get(o.name) ?? 0) + 1);
  const names = called.get(r.prompt_id);
  if (!names || names.size === 0) continue;
  turnsWithCall += 1;
  for (const n of names) calledCount.set(n, (calledCount.get(n) ?? 0) + 1);
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

// Union, not just the offered names: the built-in chains (master, default) are
// never in the hook's offer list, so keying off it alone counts their calls in
// the headline and then hides them from the table that explains it.
const perChain = [...new Set([...offeredCount.keys(), ...calledCount.keys()])]
  .map((name) => ({ name, offered: offeredCount.get(name) ?? 0, called: calledCount.get(name) ?? 0 }))
  .sort((a, b) => b.called - a.called || a.name.localeCompare(b.name));

const unmatchedTranscripts = sessions.size - transcripts.size;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        turns: records.length,
        sessions: sessions.size,
        sessions_without_transcript: unmatchedTranscripts,
        turns_with_chain_call: turnsWithCall,
        median_injected_bytes: median(bytes),
        chains: perChain,
      },
      null,
      2,
    ),
  );
} else {
  const pct = records.length ? ((100 * turnsWithCall) / records.length).toFixed(1) : "0.0";
  console.log(`observed turns          : ${records.length}  (${sessions.size} sessions)`);
  if (unmatchedTranscripts > 0) {
    console.log(`  transcripts not found : ${unmatchedTranscripts} sessions — their turns count as no-call`);
  }
  console.log(`turns that called a chain: ${turnsWithCall}  (${pct}%)`);
  console.log(`median injected bytes    : ${median(bytes)}`);
  console.log();
  console.log("per chain (offered / called):");
  for (const c of perChain) {
    // A built-in is called without ever appearing in the offer list, so a rate
    // would be dividing by zero dressed up as 0.0%.
    const rate = c.offered ? `${((100 * c.called) / c.offered).toFixed(1)}%`.padStart(6) : " built-in";
    console.log(`  ${String(c.offered).padStart(5)} / ${String(c.called).padEnd(5)}${rate}  ${c.name}`);
  }
  const dead = perChain.filter((c) => c.called === 0 && c.offered >= 20);
  if (dead.length) {
    console.log();
    console.log("offered at least 20 times and never called — the triggers are not working:");
    for (const c of dead) console.log(`  ${c.name}`);
  }
}
