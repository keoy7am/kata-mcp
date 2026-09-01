// Turns what observation mode recorded into decisions about the chain library.
//
//   node scripts/observe-report.mjs [--project <dir>] [--min-offered 20]
//                                   [--min-sessions 3] [--skip-rate 0.5]
//                                   [--sample N] [--json]
//
// Three sources, all already on disk:
//   offers  <project>/.claude/kata-observations.jsonl   (KATA_OBSERVE=1|full)
//   calls   the Claude Code transcript for each observed session
//   runs    <project>/.claude/thinking-traces/*.jsonl    (staged/freeform sessions)
//
// Every line this prints is meant to map to one edit of the chain library.
// An invocation rate on its own does not: most turns are not supposed to need
// a chain, so "15% of turns called one" is neither success nor failure. The
// signals below each correspond to a concrete action, and the thresholds that
// gate them are printed rather than hidden, because they are judgement calls.
//
// What no signal here can tell you is whether a chain *should* have been
// called on a turn where none was. --sample prints such turns (needs
// KATA_OBSERVE=full for the prompt text) so a person can decide.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---- args -------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const asJson = args.includes("--json");
const project = flag("--project", process.cwd());
const MIN_OFFERED = Number(flag("--min-offered", 20));
// A chain unused across one long session is not a signal — that session just
// did not need it. Unused across several sessions is.
const MIN_SESSIONS = Number(flag("--min-sessions", 3));
const SKIP_RATE = Number(flag("--skip-rate", 0.5));
const SAMPLE = Number(flag("--sample", 0));
const transcriptsBase = process.env.KATA_TRANSCRIPTS_DIR || join(homedir(), ".claude", "projects");

// ---- offers -----------------------------------------------------------------

const logPath = join(project, ".claude", "kata-observations.jsonl");
if (!existsSync(logPath)) {
  console.error(`No observations at ${logPath}`);
  console.error("Enable them with KATA_OBSERVE=1 (or =full to record prompt text) and use the agent for a while.");
  process.exit(1);
}
const records = readJsonl(logPath);

// ---- calls (from transcripts) ----------------------------------------------

const sessions = new Set(records.map((r) => r.session_id).filter(Boolean));
const transcripts = transcriptIndex(sessions);
/** prompt_id -> ordered list of chain names called in that exchange. */
const callsByPrompt = new Map();
for (const path of transcripts.values()) {
  for (const [promptId, names] of chainsCalled(path)) callsByPrompt.set(promptId, names);
}

// ---- runs (from traces) -----------------------------------------------------

const runs = readTraces(join(project, ".claude", "thinking-traces"));

// ---- aggregate --------------------------------------------------------------

const offered = new Map(); // chain -> turns offered with a full clause
const offeredAny = new Map(); // chain -> turns offered at all
const called = new Map(); // chain -> turns called
const calledOnlyAfterMaster = new Map(); // chain -> turns called where master came first
let turnsWithCall = 0;
let masterTurns = 0;
let masterThenNothing = 0;
let totalBytes = 0;
const bytes = [];

for (const r of records) {
  bytes.push(r.injected_bytes ?? 0);
  totalBytes += r.injected_bytes ?? 0;
  for (const o of r.offered ?? []) {
    inc(offeredAny, o.name);
    if (o.full) inc(offered, o.name);
  }
  const names = callsByPrompt.get(r.prompt_id) ?? [];
  if (names.length) turnsWithCall += 1;
  const masterAt = names.indexOf("master");
  if (masterAt >= 0) {
    masterTurns += 1;
    if (names.filter((n) => n !== "master").length === 0) masterThenNothing += 1;
  }
  for (const n of new Set(names)) {
    inc(called, n);
    if (n !== "master" && masterAt >= 0 && masterAt < names.indexOf(n)) inc(calledOnlyAfterMaster, n);
  }
}

// ---- recommendations --------------------------------------------------------

const recs = [];

const thinWindow = sessions.size < MIN_SESSIONS;
for (const [chain, n] of [...offered.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= MIN_OFFERED && !called.has(chain) && !thinWindow) {
    recs.push({
      action: "remove, demote to a pack, or rewrite its `Use when`",
      chain,
      evidence: `offered with its full trigger clause on ${n} turns across ${sessions.size} sessions, never called`,
    });
  }
}

for (const [chain, n] of called) {
  if (chain === "master" || chain === "default") continue;
  const viaMaster = calledOnlyAfterMaster.get(chain) ?? 0;
  if (n >= 3 && viaMaster === n) {
    recs.push({
      action: "rewrite the start of its `Use when` — the injected clause is not routing",
      chain,
      evidence: `called ${n} times, every time only after master had listed it in full`,
    });
  }
}

for (const [chain, s] of runs) {
  if (s.mode !== "staged") continue;
  const stages = s.advanced + s.skipped;
  if (s.started >= 3 && stages > 0 && s.skipped / stages >= SKIP_RATE) {
    recs.push({
      action: "convert to a checklist, or drop the stages that keep being skipped",
      chain,
      evidence: `${s.started} staged runs, ${Math.round((100 * s.skipped) / stages)}% of stages skipped`,
    });
  }
  if (s.started >= 3 && s.completed / s.started <= 0.5) {
    recs.push({
      action: "shorten it — runs are abandoned midway",
      chain,
      evidence: `${s.started} runs started, ${s.completed} completed`,
    });
  }
}

// ---- output -----------------------------------------------------------------

const period = records.length ? `${records[0].ts?.slice(0, 10)} → ${records.at(-1).ts?.slice(0, 10)}` : "—";
const inconclusive =
  masterThenNothing > 0
    ? {
        master_turns: masterTurns,
        master_then_nothing: masterThenNothing,
        note: "master was called and no chain followed. Either a correct PASS or a chain that does not exist yet — the data cannot tell which. Use --sample to look at the prompts.",
      }
    : null;

const sample =
  SAMPLE > 0
    ? shuffle(
        records.filter(
          (r) =>
            !(callsByPrompt.get(r.prompt_id) ?? []).length &&
            // Claude Code echoes its own local-command output through the hook
            // as a prompt; it is not something a person typed.
            !/^\s*<(local-command-caveat|command-name)/.test(r.prompt ?? ""),
        ),
      ).slice(0, SAMPLE)
    : [];
const sampleHasText = sample.some((r) => typeof r.prompt === "string");

if (asJson) {
  console.log(
    JSON.stringify(
      {
        project,
        period,
        turns: records.length,
        sessions: sessions.size,
        sessions_without_transcript: sessions.size - transcripts.size,
        turns_with_chain_call: turnsWithCall,
        injected_bytes_total: totalBytes,
        injected_bytes_median: median(bytes),
        thresholds: { min_offered: MIN_OFFERED, min_sessions: MIN_SESSIONS, skip_rate: SKIP_RATE },
        thin_window: thinWindow,
        recommendations: recs,
        inconclusive,
        sample: sample.map((r) => ({ prompt_id: r.prompt_id, prompt: r.prompt ?? null, prompt_chars: r.prompt_chars })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`kata observation report — ${project}`);
console.log(`period ${period} · ${records.length} turns · ${sessions.size} sessions · ${turnsWithCall} turns called a chain`);
if (sessions.size - transcripts.size > 0) {
  console.log(`(${sessions.size - transcripts.size} sessions have no transcript on this machine; their turns count as no-call)`);
}
console.log(`injected ${(totalBytes / 1024).toFixed(1)} KB over the period, median ${median(bytes)} bytes per prompt`);
console.log(`thresholds: --min-offered ${MIN_OFFERED} · --min-sessions ${MIN_SESSIONS} · --skip-rate ${SKIP_RATE}`);
if (thinWindow) {
  console.log(
    `only ${sessions.size} session${sessions.size === 1 ? "" : "s"} observed — "never called" is withheld until ${MIN_SESSIONS}: one session not needing a chain says nothing about the chain`,
  );
}
console.log();

console.log("RECOMMENDATIONS");
if (!recs.length) {
  console.log("  nothing to recommend at these thresholds");
} else {
  recs.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.chain} — ${r.action}`);
    console.log(`     ${r.evidence}`);
  });
}
console.log();

if (inconclusive) {
  console.log("NOT CONCLUSIVE");
  console.log(`  master called on ${masterTurns} turns; on ${masterThenNothing} of them no chain followed.`);
  console.log(`  ${inconclusive.note}`);
  console.log();
}

if (SAMPLE > 0) {
  console.log(`SAMPLE — ${sample.length} turns where no chain was called, for you to judge`);
  if (!sampleHasText) {
    console.log("  prompts were not recorded. Set KATA_OBSERVE=full to capture them; --sample needs the text.");
  } else {
    for (const r of sample) {
      const text = (r.prompt ?? "").replace(/\s+/g, " ").trim();
      console.log(`  · ${text.length > 160 ? text.slice(0, 157) + "…" : text}`);
    }
  }
  console.log();
}

// ---- helpers ----------------------------------------------------------------

function inc(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function shuffle(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
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
}

/** session id -> transcript path, one directory walk. */
function transcriptIndex(sessionIds) {
  const wanted = new Set([...sessionIds].map((id) => `${id}.jsonl`));
  const found = new Map();
  let dirs = [];
  try {
    dirs = readdirSync(transcriptsBase, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return found;
  }
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(join(transcriptsBase, dir.name));
    } catch {
      continue;
    }
    for (const name of names) {
      if (wanted.has(name)) found.set(name.replace(/\.jsonl$/, ""), join(transcriptsBase, dir.name, name));
    }
  }
  return found;
}

/**
 * prompt_id -> chain names called in that exchange, in call order.
 *
 * Only `user` entries carry `promptId`; assistant entries carry none, so the id
 * is carried forward in transcript order. Tool results are `user` entries too
 * and repeat the same id, which is what makes the boundary land in the right
 * place: it only changes when a new prompt is submitted.
 */
function chainsCalled(transcriptPath) {
  const byPrompt = new Map();
  let current = null;
  for (const entry of readJsonl(transcriptPath)) {
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
      if (!byPrompt.has(current)) byPrompt.set(current, []);
      byPrompt.get(current).push(name);
    }
  }
  return byPrompt;
}

/** chain -> { mode, started, completed, advanced, skipped } from trace files. */
function readTraces(dir) {
  const out = new Map();
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return out;
  }
  for (const name of names) {
    const events = readJsonl(join(dir, name));
    const head = events.find((e) => e.event === "started");
    if (!head?.chain) continue;
    const s = out.get(head.chain) ?? { mode: head.mode, started: 0, completed: 0, advanced: 0, skipped: 0 };
    s.started += 1;
    for (const e of events) {
      if (e.event === "completed") s.completed += 1;
      else if (e.event === "advanced") s.advanced += 1;
      else if (e.event === "skipped") s.skipped += 1;
    }
    out.set(head.chain, s);
  }
  return out;
}
