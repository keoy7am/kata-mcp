import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The report joins three files that only ever meet on a user's disk, so it is
// exercised here against fixtures shaped like the real ones: an observation log
// written by the hook, a Claude Code transcript (only `user` entries carry
// promptId), and staged-run traces.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "observe-report.mjs");

function fixture(opts: { sessions: number; turnsPerSession: number; calls?: Record<string, string[]> }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "obsrep-p-"));
  const transcripts = fs.mkdtempSync(path.join(os.tmpdir(), "obsrep-t-"));
  fs.mkdirSync(path.join(project, ".claude", "thinking-traces"), { recursive: true });

  const obs: string[] = [];
  for (let s = 0; s < opts.sessions; s++) {
    const sessionId = `sess-${s}`;
    const lines: string[] = [];
    for (let t = 0; t < opts.turnsPerSession; t++) {
      const promptId = `${sessionId}-p${t}`;
      obs.push(
        JSON.stringify({
          ts: `2026-09-0${s + 1}T00:00:0${t}Z`,
          session_id: sessionId,
          prompt_id: promptId,
          cwd: project,
          injected_bytes: 2000,
          prompt_chars: 5,
          prompt_sha256: "x",
          prompt: `prompt ${t}`,
          offered: [
            { name: "dead", scope: "global", full: true },
            { name: "alive", scope: "global", full: true },
            { name: "leaning", scope: "global", full: true },
          ],
        }),
      );
      lines.push(JSON.stringify({ type: "user", promptId, message: { content: `prompt ${t}` } }));
      for (const chain of opts.calls?.[promptId] ?? []) {
        lines.push(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", name: "mcp__x__run_chain", input: { name: chain } }] },
          }),
        );
        // A tool result comes back as a `user` entry carrying the same promptId.
        lines.push(JSON.stringify({ type: "user", promptId, message: { content: [{ type: "tool_result" }] } }));
      }
    }
    const dir = path.join(transcripts, "some-project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n", "utf8");
  }
  fs.writeFileSync(path.join(project, ".claude", "kata-observations.jsonl"), obs.join("\n") + "\n", "utf8");
  return { project, transcripts };
}

function trace(project: string, chain: string, events: string[], n: number) {
  for (let i = 0; i < n; i++) {
    const lines = [JSON.stringify({ event: "started", chain, mode: "staged", seq: 0 })];
    events.forEach((e, k) => lines.push(JSON.stringify({ event: e, stage_index: k + 1, seq: k + 1 })));
    fs.writeFileSync(
      path.join(project, ".claude", "thinking-traces", `${chain}-${1000 + i}-${i}.jsonl`),
      lines.join("\n") + "\n",
      "utf8",
    );
  }
}

function run(project: string, transcripts: string, ...extra: string[]) {
  const out = execFileSync(process.execPath, [script, "--project", project, "--json", ...extra], {
    encoding: "utf8",
    env: { ...process.env, KATA_TRANSCRIPTS_DIR: transcripts },
  });
  return JSON.parse(out);
}

describe("observe-report", () => {
  it("flags a chain never called across enough sessions, and only then", () => {
    const calls = { "sess-0-p0": ["alive"], "sess-1-p0": ["alive"], "sess-2-p0": ["alive"] };
    const f = fixture({ sessions: 3, turnsPerSession: 8, calls });
    const r = run(f.project, f.transcripts, "--min-offered", "20");
    const chains = r.recommendations.map((x: { chain: string }) => x.chain);
    expect(chains).toContain("dead");
    expect(chains).not.toContain("alive");
    expect(r.thin_window).toBe(false);
  });

  it("withholds 'never called' when only one session was observed", () => {
    // Twenty-nine turns of one session not needing a chain is what a real
    // session looks like; it says nothing about the chain.
    const f = fixture({ sessions: 1, turnsPerSession: 30 });
    const r = run(f.project, f.transcripts);
    expect(r.thin_window).toBe(true);
    expect(r.recommendations).toEqual([]);
  });

  it("attributes calls to the prompt they followed, even past a tool result", () => {
    const calls = { "sess-0-p1": ["master", "leaning"], "sess-1-p1": ["master", "leaning"], "sess-2-p1": ["master", "leaning"] };
    const f = fixture({ sessions: 3, turnsPerSession: 3, calls });
    const r = run(f.project, f.transcripts, "--min-offered", "1");
    expect(r.turns_with_chain_call).toBe(3);
    const viaMaster = r.recommendations.find((x: { chain: string }) => x.chain === "leaning");
    expect(viaMaster?.action).toMatch(/not routing/);
  });

  it("reads staged traces: high skip rate and abandoned runs each get a recommendation", () => {
    const f = fixture({ sessions: 1, turnsPerSession: 1 });
    trace(f.project, "skippy", ["skipped", "skipped", "advanced", "completed"], 3);
    trace(f.project, "quitter", ["advanced"], 4); // never completed
    const r = run(f.project, f.transcripts);
    const byChain = Object.fromEntries(r.recommendations.map((x: { chain: string; action: string }) => [x.chain, x.action]));
    expect(byChain.skippy).toMatch(/checklist/);
    expect(byChain.quitter).toMatch(/abandoned/);
  });

  it("--sample lists only turns with no call and skips Claude Code's command echoes", () => {
    const f = fixture({ sessions: 1, turnsPerSession: 3, calls: { "sess-0-p0": ["alive"] } });
    const log = path.join(f.project, ".claude", "kata-observations.jsonl");
    const echo = JSON.stringify({
      ts: "2026-09-01T00:00:09Z", session_id: "sess-0", prompt_id: "sess-0-echo", cwd: f.project,
      injected_bytes: 1, prompt_chars: 1, prompt_sha256: "x", offered: [],
      prompt: "<local-command-caveat>Caveat: generated by the user running /model",
    });
    fs.appendFileSync(log, echo + "\n", "utf8");
    const r = run(f.project, f.transcripts, "--sample", "10");
    const prompts = r.sample.map((x: { prompt: string }) => x.prompt);
    expect(prompts).not.toContain("prompt 0"); // it called a chain
    expect(prompts).toContain("prompt 1");
    expect(prompts.some((p: string) => p.startsWith("<local-command-caveat>"))).toBe(false);
  });
});
