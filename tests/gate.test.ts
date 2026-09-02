import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isGitCommit, isTrivialPrompt } from "../src/gate.ts";

const root = path.resolve(import.meta.dirname, "..");
const gate = path.join(root, "hooks", "gate.mjs");
const prompt = path.join(root, "hooks", "inject-chains.mjs");

// Ambient KATA_GATE / KATA_GATE_TRACE / KATA_OBSERVE on a developer machine
// must not leak in: with the trace on, every invocation adds a log line and
// the refusal counts below stop meaning anything.
// CLAUDE_PROJECT_DIR is set when the tests run under Claude Code itself and
// would redirect every state file to the real project.
const { KATA_GATE: _g, KATA_GATE_TRACE: _t, KATA_OBSERVE: _o, CLAUDE_PROJECT_DIR: _p, ...inherited } = process.env;
void _g;
void _t;
void _o;
void _p;

const chainDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-c-"));
fs.writeFileSync(
  path.join(chainDir, "probe.md"),
  "---\nname: probe\ndescription: Probe. Use when verifying.\nmode: checklist\n---\nbody\n",
  "utf8",
);

function fresh() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gate-p-"));
}

function submit(cwd: string, text: string, env: Record<string, string> = { KATA_GATE: "1" }) {
  execFileSync(process.execPath, [prompt], {
    encoding: "utf8",
    env: { ...inherited, KATA_GLOBAL_DIR: chainDir, KATA_PROJECT_ROOT: cwd, ...env },
    input: JSON.stringify({ session_id: "s", prompt_id: "p", cwd, hook_event_name: "UserPromptSubmit", prompt: text }),
  });
}

function tool(
  cwd: string,
  event: "PreToolUse" | "PostToolUse",
  name: string,
  input: Record<string, unknown> = {},
  env: Record<string, string> = { KATA_GATE: "1" },
) {
  return execFileSync(process.execPath, [gate], {
    encoding: "utf8",
    env: { ...inherited, ...env },
    input: JSON.stringify({ session_id: "s", cwd, hook_event_name: event, tool_name: name, tool_input: input }),
  });
}

const LONG = "Refactor the loader so packs resolve before global chains and add a regression test.";
const denied = (out: string) => out.includes('"permissionDecision":"deny"');

describe("gate rule", () => {
  it("treats acknowledgements and short prompts as trivial", () => {
    for (const p of ["ok", "好", "繼續", "请继续", "yes.", "", "fix it"]) expect(isTrivialPrompt(p)).toBe(true);
    expect(isTrivialPrompt(LONG)).toBe(false);
    expect(isTrivialPrompt("twelve chars", 5)).toBe(false);
  });

  it("recognises a commit inside a compound command but not a mention of one", () => {
    expect(isGitCommit("git add -A && git commit -F msg.txt")).toBe(true);
    expect(isGitCommit("git status; git commit")).toBe(true);
    expect(isGitCommit("git log --oneline")).toBe(false);
    expect(isGitCommit(undefined)).toBe(false);
  });
});

describe("gate hook", () => {
  it("does nothing when KATA_GATE is unset, and writes no file", () => {
    // This hook is wired to every Edit/Write/Bash call; the off path is what
    // every non-participant runs, so it must be silent and side-effect free.
    const cwd = fresh();
    submit(cwd, LONG, {});
    expect(fs.existsSync(path.join(cwd, ".claude", "kata-gate.json"))).toBe(false);
    expect(tool(cwd, "PreToolUse", "Edit", {}, {})).toBe("");
  });

  it("refuses the first edit after a non-trivial prompt until a chain runs", () => {
    const cwd = fresh();
    submit(cwd, LONG);
    expect(denied(tool(cwd, "PreToolUse", "Edit"))).toBe(true);
    expect(denied(tool(cwd, "PreToolUse", "Write"))).toBe(true);
    expect(denied(tool(cwd, "PreToolUse", "Bash", { command: "git commit -m x" }))).toBe(true);
    // Reads and ordinary shell are never gated.
    expect(tool(cwd, "PreToolUse", "Read")).toBe("");
    expect(tool(cwd, "PreToolUse", "Bash", { command: "git status" })).toBe("");
    // A refusal is logged so the experiment can be counted afterwards.
    const log = fs.readFileSync(path.join(cwd, ".claude", "kata-gate.jsonl"), "utf8").trim().split("\n");
    expect(log).toHaveLength(3);
    expect(JSON.parse(log[0]).prompt_id).toBe("p");

    tool(cwd, "PostToolUse", "mcp__plugin_kata_chains__run_chain", { name: "master" });
    expect(tool(cwd, "PreToolUse", "Edit")).toBe("");
  });

  it("a trivial follow-up inherits the gate the previous prompt left", () => {
    // "continue" after a task is the task; only a chain call clears the gate.
    const cwd = fresh();
    submit(cwd, "ok");
    expect(fs.existsSync(path.join(cwd, ".claude", "kata-gate.json"))).toBe(false);
    submit(cwd, LONG);
    submit(cwd, "ok");
    expect(denied(tool(cwd, "PreToolUse", "Edit"))).toBe(true);
    tool(cwd, "PostToolUse", "mcp__plugin_kata_chains__run_chain", { name: "master" });
    submit(cwd, "繼續完成任務");
    expect(tool(cwd, "PreToolUse", "Edit")).toBe("");
  });

  it("re-arms after a commit, so a multi-stage run is gated per stage", () => {
    const cwd = fresh();
    submit(cwd, LONG);
    tool(cwd, "PostToolUse", "mcp__plugin_kata_chains__run_chain", { name: "master" });
    expect(tool(cwd, "PreToolUse", "Bash", { command: "git commit -m stage1" })).toBe("");
    tool(cwd, "PostToolUse", "Bash", { command: "git commit -m stage1" });
    const out = tool(cwd, "PreToolUse", "Bash", { command: "git commit -m stage2" });
    expect(denied(out)).toBe(true);
    expect(out).toContain("committed");
    // Edits between commits are gated too, since the stage has no chain yet.
    expect(denied(tool(cwd, "PreToolUse", "Edit"))).toBe(true);
  });

  it("keys state on the project root, so a call from a subdirectory sees the same gate", () => {
    // A workflow worker spawned into <project>/app reports that as its cwd.
    const root = fresh();
    const sub = path.join(root, "app");
    fs.mkdirSync(sub);
    execFileSync(process.execPath, [prompt], {
      encoding: "utf8",
      env: { ...inherited, KATA_GLOBAL_DIR: chainDir, KATA_PROJECT_ROOT: root, KATA_GATE: "1", CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ session_id: "s", prompt_id: "p", cwd: root, hook_event_name: "UserPromptSubmit", prompt: LONG }),
    });
    const out = execFileSync(process.execPath, [gate], {
      encoding: "utf8",
      env: { ...inherited, KATA_GATE: "1", CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ session_id: "s", cwd: sub, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: {} }),
    });
    expect(denied(out)).toBe(true);
    expect(fs.existsSync(path.join(sub, ".claude"))).toBe(false);
  });

  it("never blocks on unreadable input, and says so instead of allowing silently", () => {
    // A gate that lets everything through is indistinguishable from one that
    // was never wired up, so the failure is written down as its own state.
    const cwd = fresh();
    const out = execFileSync(process.execPath, [gate], {
      encoding: "utf8",
      env: { ...inherited, KATA_GATE: "1", CLAUDE_PROJECT_DIR: cwd },
      input: "not json",
    });
    expect(out).toBe("");
    const rec = JSON.parse(fs.readFileSync(path.join(cwd, ".claude", "kata-gate.jsonl"), "utf8").trim());
    expect(rec.event).toBe("unreadable-input");
  });

  it("exits as soon as stdin closes rather than waiting out its deadline", () => {
    const cwd = fresh();
    const t0 = Date.now();
    tool(cwd, "PreToolUse", "Read");
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
