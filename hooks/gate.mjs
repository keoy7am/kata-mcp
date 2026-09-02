// PreToolUse / PostToolUse hook for the routing gate (KATA_GATE=1).
//
// Off by default, and the off path must be the cheapest thing in this file:
// this hook is wired to every Edit, Write and Bash call for every user of the
// plugin, so it exits before touching stdin unless the experiment is on.
//
//   PreToolUse   Edit|Write|MultiEdit|NotebookEdit, or Bash running git commit:
//                refused while the session's gate is armed.
//   PostToolUse  run_chain: disarms.  Bash git commit: re-arms for the next
//                commit, so a multi-stage autonomous run is gated per stage,
//                not once at the top.
//
// The prompt hook arms the gate on a non-trivial prompt (see src/gate.ts).
if (process.env.KATA_GATE !== "1") process.exit(0);

const fs = await import("node:fs");
const path = await import("node:path");

// Every silent exit below is a gate that let a call through, and a gate that
// lets everything through looks exactly like a gate that was never wired up.
// So the failure states are written down: "unreadable input" is a third
// answer, not a quiet "allow". KATA_GATE_TRACE=1 additionally logs every
// invocation, for telling "hook not registered" from "hook exits early".
function trace(cwd, record) {
  try {
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.appendFileSync(
      path.join(cwd, ".claude", "kata-gate.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n",
      "utf8",
    );
  } catch {
    /* logging must never decide the outcome */
  }
}
const fallbackCwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const raw = await Promise.race([
  new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  }),
  // unref: the timer is a deadline, not a reason to keep the process alive for
  // two seconds after stdin has already closed (the host waits for exit).
  new Promise((resolve) => setTimeout(() => resolve(null), 2000).unref()),
]);

let payload;
try {
  if (raw === null) throw new Error("stdin timeout");
  payload = JSON.parse(raw);
} catch (err) {
  // Never block a tool because the gate could not read its input — but say so.
  trace(fallbackCwd, { event: "unreadable-input", reason: err?.message ?? String(err), raw_len: raw?.length ?? 0 });
  process.exit(0);
}
if (process.env.KATA_GATE_TRACE) {
  trace(payload.cwd || fallbackCwd, { event: "invoked", hook: payload.hook_event_name, tool: payload.tool_name, session_id: payload.session_id });
}

const { readGate, writeGate, isGatedCall, isGitCommit, denyPayload } = await import(
  new URL("../src/gate.ts", import.meta.url)
);

const cwd = payload.cwd || fallbackCwd;
const session = payload.session_id || "unknown";
const tool = payload.tool_name || "";
const input = payload.tool_input || {};
const state = readGate(cwd, session);

if (payload.hook_event_name === "PostToolUse") {
  if (/run_chain$/.test(tool)) {
    writeGate(cwd, session, { armed: false, reason: `disarmed by ${tool}`, prompt_id: state.prompt_id ?? null });
  } else if (tool === "Bash" && isGitCommit(input.command)) {
    writeGate(cwd, session, { armed: true, reason: "commit", prompt_id: state.prompt_id ?? null });
  }
  process.exit(0);
}

if (payload.hook_event_name === "PreToolUse" && state.armed && isGatedCall(tool, input)) {
  const reason =
    state.reason === "commit"
      ? "kata gate: a stage was committed and no chain has run since. Run a chain (run_chain(\"master\") is enough) before the next commit."
      : "kata gate: this prompt is non-trivial and no chain has run yet. Run a chain (run_chain(\"master\") is enough) before editing.";
  try {
    fs.appendFileSync(
      path.join(cwd, ".claude", "kata-gate.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), session_id: session, prompt_id: state.prompt_id ?? null, tool, reason: state.reason }) + "\n",
      "utf8",
    );
  } catch {
    /* logging must never decide the outcome */
  }
  process.stdout.write(denyPayload(reason));
}
