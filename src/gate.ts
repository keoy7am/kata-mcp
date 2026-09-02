// The routing gate (KATA_GATE=1). Shared by the prompt hook, which arms it, and
// the tool hook, which enforces it. Dependency-free and erasable-TypeScript
// only: both hooks run from a bare plugin checkout.
//
// What it is: on a non-trivial prompt, the first Edit/Write and every
// `git commit` are refused until a chain has been called — any chain, master
// included — in that prompt (for commits: since the previous commit). That
// turns "the model was shown the list" into "the model called something",
// which is a different guarantee and a deliberately smaller one than "the
// model followed a procedure": a chain can still be skipped through.
//
// What decides "non-trivial" is a rule, not the model, because the model's own
// judgement is the thing being tested. The rule is crude on purpose and its
// threshold is an environment variable, not a constant.
import * as fs from "node:fs";
import * as path from "node:path";

export const GATE_MIN_CHARS_DEFAULT = 40;

/** Short acknowledgements in the languages this project's users write. */
const ACK = /^(ok|okay|yes|y|no|go|continue|好|好的|對|对|是|繼續|继续|請繼續|请继续|請|请|收到|嗯)[\s.!。！]*$/i;

export function isTrivialPrompt(prompt: string, minChars: number = GATE_MIN_CHARS_DEFAULT): boolean {
  const p = (prompt ?? "").trim();
  if (!p) return true;
  if (ACK.test(p)) return true;
  return p.length < minChars;
}

// ponytail: text match, so a quoted "git commit" also counts; the false
// positive refuses one extra call while armed, which is the safe direction.
export function isGitCommit(command: unknown): boolean {
  return typeof command === "string" && /\bgit\b[^|;&]*\bcommit\b/.test(command);
}

export const GATED_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function isGatedCall(toolName: string, toolInput: Record<string, unknown> | undefined): boolean {
  if (GATED_TOOLS.has(toolName)) return true;
  if (toolName === "Bash") return isGitCommit(toolInput?.command);
  return false;
}

export interface GateState {
  armed: boolean;
  /** Why it is armed: "prompt" or "commit". */
  reason?: string;
  prompt_id?: string | null;
  ts?: string;
}

export function gatePath(cwd: string): string {
  return path.join(cwd, ".claude", "kata-gate.json");
}

export function readGate(cwd: string, sessionId: string): GateState {
  try {
    const all = JSON.parse(fs.readFileSync(gatePath(cwd), "utf8"));
    const s = all?.[sessionId];
    return s && typeof s.armed === "boolean" ? s : { armed: false };
  } catch {
    return { armed: false };
  }
}

export function writeGate(cwd: string, sessionId: string, state: GateState): void {
  const file = gatePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let all: Record<string, GateState> = {};
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    /* fresh file */
  }
  all[sessionId] = { ...state, ts: new Date().toISOString() };
  // Write-then-rename so a reader never sees a half-written file: several
  // workers can hit this at once, and a torn JSON reads back as "not armed".
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function denyPayload(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}
