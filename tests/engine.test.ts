import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chainHint } from "../src/builtins";
import { Engine, EngineError } from "../src/engine";
import { LIMITS } from "../src/types";

const tmps: string[] = [];
function tmpdir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ptc-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup() {
  const opts = { globalDir: tmpdir(), projectRoot: tmpdir() };
  return { opts, engine: new Engine(opts) };
}

const STAGED = `---
name: flow
description: Test flow. Use when testing.
mode: staged
language: zh-TW
---
## Stage: One
first
## Stage: Two
second
## Stage: Three
third
`;

function writeGlobal(opts: { globalDir: string }, file: string, content: string) {
  fs.mkdirSync(opts.globalDir, { recursive: true });
  fs.writeFileSync(path.join(opts.globalDir, file), content, "utf8");
}

function code(fn: () => unknown): string {
  try {
    fn();
    return "(no error)";
  } catch (e) {
    return (e as EngineError).code;
  }
}

describe("builtins", () => {
  it("master returns router content including live chain list", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("master") as any;
    expect(r.mode).toBe("router");
    expect(r.content).toContain("PASS");
    expect(r.content).toContain("flow (staged, 3 stages, global)");
  });

  it("master with no custom chains still routes PASS/default", () => {
    const { engine } = setup();
    const r = engine.runChain("master") as any;
    expect(r.content).toContain("No custom chains loaded");
    // Names the searched dirs: a machine that never got the library must not
    // read as a deliberately chain-free project.
    expect(r.content).toContain(".claude");
    expect(r.content).toContain("Repeat-signal contract");
    expect(r.content).not.toContain('run_chain("direction-check")');
  });

  it("default opens a freeform session; done:true completes with trace", () => {
    const { engine } = setup();
    const r = engine.runChain("default") as any;
    expect(r.mode).toBe("freeform");
    const s1 = engine.advanceChain({
      session_id: r.session_id,
      expected_stage_index: 1,
      stage_output: "thought 1",
    }) as any;
    expect(s1.stage_index).toBe(2);
    const end = engine.advanceChain({
      session_id: r.session_id,
      expected_stage_index: 2,
      stage_output: "final verified thought",
      done: true,
    }) as any;
    expect(end.done).toBe(true);
    expect(end.thoughts).toBe(2);
    const lines = fs.readFileSync(end.trace_path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(["started", "advanced", "advanced", "completed"]);
  });

  it("freeform rejects skip_reason", () => {
    const { engine } = setup();
    const r = engine.runChain("default") as any;
    expect(
      code(() =>
        engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, skip_reason: "no" }),
      ),
    ).toBe("INVALID_ARGS");
  });
});

describe("staged state machine", () => {
  it("walks all stages, appends trace, completes", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("flow") as any;
    expect(r.stage_total).toBe(3);
    expect(r.stage_prompt).toContain("One");
    expect(r.output_language).toBe("zh-TW");

    const s2 = engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "a" }) as any;
    expect(s2.stage_prompt).toContain("Two");
    const s3 = engine.advanceChain({ session_id: r.session_id, expected_stage_index: 2, skip_reason: "not applicable" }) as any;
    expect(s3.stage_prompt).toContain("Three");
    const end = engine.advanceChain({ session_id: r.session_id, expected_stage_index: 3, stage_output: "c" }) as any;
    expect(end.done).toBe(true);

    const lines = fs.readFileSync(end.trace_path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(["started", "advanced", "skipped", "advanced", "completed"]);
    expect(lines[2].reason).toBe("not applicable");
    expect(lines[0].sha256).toBe(r.chain_sha256);
  });

  it("re-sending the previous index replays idempotently without duplicate trace", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("flow") as any;
    const first = engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "a" }) as any;
    const replay = engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "a" }) as any;
    expect(replay).toEqual(first);
    const trace = fs.readFileSync(
      (engine.advanceChain({ session_id: r.session_id, expected_stage_index: 2, stage_output: "b" }),
      engine.advanceChain({ session_id: r.session_id, expected_stage_index: 3, stage_output: "c" }) as any).trace_path,
      "utf8",
    );
    const events = trace.trim().split("\n").map((l) => JSON.parse(l).event);
    expect(events.filter((e) => e === "advanced")).toHaveLength(3); // no duplicate from replay
  });

  it("replaying the previous index with DIFFERENT content is a conflict, not a retry", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("flow") as any;
    engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "a" });
    expect(
      code(() =>
        engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "DIFFERENT" }),
      ),
    ).toBe("REPLAY_CONTENT_MISMATCH");
  });

  it("wrong index returns structured mismatch with current state", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("flow") as any;
    try {
      engine.advanceChain({ session_id: r.session_id, expected_stage_index: 3, stage_output: "x" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("STAGE_INDEX_MISMATCH");
      expect(((e as EngineError).data as any).current_stage_index).toBe(1);
    }
  });

  it("stage_output and skip_reason are mutually exclusive", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("flow") as any;
    expect(code(() => engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "a", skip_reason: "b" }))).toBe("INVALID_ARGS");
    expect(code(() => engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1 }))).toBe("INVALID_ARGS");
  });

  it("unknown session -> SESSION_LOST", () => {
    const { engine } = setup();
    expect(code(() => engine.advanceChain({ session_id: "nope", expected_stage_index: 1, stage_output: "x" }))).toBe("SESSION_LOST");
  });

  it("session snapshots the chain: overwriting the file mid-run does not change stages", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.runChain("flow") as any;
    writeGlobal(opts, "flow.md", STAGED.replace("second", "REPLACED"));
    const s2 = engine.advanceChain({ session_id: r.session_id, expected_stage_index: 1, stage_output: "a" }) as any;
    expect(s2.stage_prompt).toContain("second");
    expect(s2.stage_prompt).not.toContain("REPLACED");
  });

  it("evicts the least-recently-used session past the cap", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const first = engine.runChain("flow") as any;
    for (let i = 0; i < LIMITS.MAX_SESSIONS; i++) engine.runChain("default");
    expect(code(() => engine.advanceChain({ session_id: first.session_id, expected_stage_index: 1, stage_output: "x" }))).toBe("SESSION_LOST");
    const aborted = fs
      .readFileSync((first as any).session_id ? findTrace(opts.projectRoot, "flow") : "", "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).event);
    expect(aborted).toContain("aborted");
  });
});

function findTrace(projectRoot: string, chain: string): string {
  const dir = path.join(projectRoot, ".claude", "thinking-traces");
  const f = fs.readdirSync(dir).find((x) => x.startsWith(chain + "-"));
  return path.join(dir, f!);
}

describe("deepening detection", () => {
  function fakeTrace(projectRoot: string, chain: string, ageMs: number, id: string) {
    const dir = path.join(projectRoot, ".claude", "thinking-traces");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${chain}-${Date.now() - ageMs}-${id}.jsonl`), "", "utf8");
  }

  it("third run reports a repeat fact under the master's standing review contract", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    fakeTrace(opts.projectRoot, "flow", 1000, "aaaaaaaa");
    fakeTrace(opts.projectRoot, "flow", 2000, "bbbbbbbb");

    const beforeThreshold = engine.runChain("master") as any;
    expect(beforeThreshold.content).toContain("Repeat-signal contract");
    expect(beforeThreshold.content).not.toContain("REPEAT FACTS");

    const r = engine.runChain("flow") as any;
    expect(r.deepening_alert).toContain('3 traced staged/freeform session starts for "flow"');
    expect(r.deepening_alert).toContain("including this run");
    expect(r.deepening_alert).not.toContain("wrong-direction");
    expect(r.deepening_alert).not.toContain("run_chain");

    const master = engine.runChain("master") as any;
    expect(master.content).toContain("REPEAT FACTS");
    expect(master.content).toContain("flow: 3 traced session starts");
    expect(master.content).toContain("do not start the same chain again");
    expect(master.content).not.toContain('run_chain("direction-check")');
  });

  it("runs outside the window do not count and no alert appears", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const staleMs = 49 * 3_600_000;
    fakeTrace(opts.projectRoot, "flow", staleMs, "aaaaaaaa");
    fakeTrace(opts.projectRoot, "flow", staleMs, "bbbbbbbb");
    const r = engine.runChain("flow") as any;
    expect(r.deepening_alert).toBeUndefined();
    const master = engine.runChain("master") as any;
    expect(master.content).not.toContain("REPEAT FACTS");
    expect(master.content).toContain("Repeat-signal contract");
  });

  it("fails closed when trace history exists but cannot be read", () => {
    const { opts, engine } = setup();
    const traceDir = path.join(opts.projectRoot, ".claude", "thinking-traces");
    fs.mkdirSync(path.dirname(traceDir), { recursive: true });
    fs.writeFileSync(traceDir, "not a directory", "utf8");

    expect(code(() => engine.runChain("master"))).toBe("TRACE_HISTORY_UNREADABLE");
  });
});

describe("checklist + shadowing behavior", () => {
  it("checklist runs single-shot with provenance and no session", () => {
    const { opts, engine } = setup();
    writeGlobal(
      opts,
      "check.md",
      `---\nname: check\ndescription: d. Use when testing.\nmode: checklist\n---\n- do it`,
    );
    const r = engine.runChain("check") as any;
    expect(r.mode).toBe("checklist");
    expect(r.session_id).toBeUndefined();
    expect(r.provenance).toContain("must not override");
    expect(r.content).toContain("- do it");
  });

  it("run_chain fails closed on invalid project override", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const pdir = path.join(opts.projectRoot, ".claude", "kata");
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, "flow.md"), "garbage", "utf8");
    expect(code(() => engine.runChain("flow"))).toBe("CHAIN_SHADOWED_BY_INVALID_OVERRIDE");
  });

  it("unknown chain -> CHAIN_NOT_FOUND listing availables", () => {
    const { engine } = setup();
    expect(code(() => engine.runChain("ghost"))).toBe("CHAIN_NOT_FOUND");
  });

  it("list_chains includes builtins and stage counts", () => {
    const { opts, engine } = setup();
    writeGlobal(opts, "flow.md", STAGED);
    const r = engine.listChains() as any;
    const names = r.chains.map((c: any) => c.name);
    expect(names).toContain("master");
    expect(names).toContain("default");
    expect(r.chains.find((c: any) => c.name === "flow").stage_count).toBe(3);
    expect(r.project_root).toBeTruthy();
  });

  it("builtin list metadata reports the modes run_chain actually uses", () => {
    const { engine } = setup();
    const r = engine.listChains() as any;
    expect(r.chains.find((c: any) => c.name === "master").mode).toBe("router");
    expect(r.chains.find((c: any) => c.name === "default").mode).toBe("freeform");
  });
});

describe("chainHint (prompt-hook trimming)", () => {
  const REAL =
    "Root-cause isolation for environment/config-class problems. Use when a feature \"silently fails,\" \"worked yesterday, broken today,\" or a hook/setting isn't taking effect.";

  it("keeps the trigger clause, not the summary that restates the name", () => {
    const hint = chainHint(REAL);
    expect(hint.startsWith("Use when")).toBe(true);
    expect(hint).not.toContain("Root-cause isolation for");
  });

  it("still trims to the hook budget", () => {
    const hint = chainHint(REAL);
    expect(hint.length).toBeLessThanOrEqual(LIMITS.HOOK_MAX_DESC_CHARS + 1); // + ellipsis
  });

  it("falls back to the head when there is no trigger clause", () => {
    expect(chainHint("Just a summary, no trigger clause.", 80)).toBe(
      "Just a summary, no trigger clause.",
    );
  });

  it("regression: at a tight budget a head-first slice loses the trigger, chainHint does not", () => {
    // Pinned to 60 — the budget in force when the bug shipped — rather than the
    // live LIMITS value, so raising the budget cannot quietly retire the check.
    const shipped = 60;
    expect(REAL.slice(0, shipped)).not.toContain("Use when");
    expect(chainHint(REAL, shipped).startsWith("Use when")).toBe(true);
  });
});

describe("list_chains no_trigger_clause", () => {
  it("reports a description with no Use-when marker, and stays quiet for one that has it", () => {
    const { opts, engine } = setup();
    writeGlobal(
      opts,
      "vague.md",
      STAGED.replace("name: flow", "name: vague").replace(
        "description: Test flow. Use when testing.",
        "description: A chain that never says when to reach for it.",
      ),
    );
    writeGlobal(opts, "flow.md", STAGED); // has "Use when": must NOT be reported
    const r = engine.listChains() as any;
    const names = r.no_trigger_clause.map((h: any) => h.name);
    expect(names).toEqual(["vague"]);
    // Falls back to a head-first slice, i.e. the failure the rule prevents.
    expect(r.no_trigger_clause[0].shown_in_hook.startsWith("A chain that never")).toBe(true);
  });
});
