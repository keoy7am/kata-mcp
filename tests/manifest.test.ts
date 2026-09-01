import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// package.json is the single source of truth for the version. src/index.ts
// imports it; .claude-plugin/plugin.json is written by scripts/sync-version.mjs
// from npm's version lifecycle. Only that one copy can drift, so it is checked
// here — along with the two places a new copy would want to reappear.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

describe("version", () => {
  const pkg = read("package.json");

  it("plugin.json matches package.json", () => {
    expect(read(".claude-plugin/plugin.json").version).toBe(pkg.version);
  });

  it("plugin.mcp.json launches the matching npm release", () => {
    // The plugin checkout supplies the hook and the skill; npm supplies the
    // server. An unpinned or stale pin here means those two halves can be
    // different releases on a user's machine, with nothing to reveal it.
    const args: string[] = read("plugin.mcp.json").mcpServers.chains.args;
    expect(args).toContain(`${pkg.name}@${pkg.version}`);
  });

  it("the published package ships built JavaScript, not TypeScript sources", () => {
    // Node refuses to strip types from anything under node_modules
    // (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so a package whose bin
    // points at a .ts file installs fine and then fails to start on every
    // machine. The plugin checkout runs sources; the npm package cannot.
    expect(pkg.bin["kata-mcp"]).toBe("dist/index.js");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).not.toContain("src");
  });

  it("the marketplace listing carries no version of its own", () => {
    // The field is optional and most plugins in Anthropic's marketplace omit it.
    // Re-adding it here would recreate a copy nothing keeps in sync.
    const listed = read(".claude-plugin/marketplace.json").plugins.find(
      (p: any) => p.name === read(".claude-plugin/plugin.json").name,
    );
    expect(listed).toBeDefined();
    expect(listed.version).toBeUndefined();
  });

  it("the version the server reports to clients matches package.json", () => {
    // The one version a client ever sees. It shipped as 0.1.0 while the
    // manifests said 0.2.0, so this asserts the running server, not the source.
    const out = execFileSync(process.execPath, [path.join(root, "src", "index.ts")], {
      encoding: "utf8",
      input:
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "manifest-test", version: "1" },
          },
        }) + "\n",
    });
    const reported = JSON.parse(out.split("\n")[0]).result.serverInfo.version;
    expect(reported).toBe(pkg.version);
  });
});

describe("prompt hook wiring", () => {
  const hook = path.join(root, "hooks", "inject-chains.mjs");

  it("KATA_HOOK=0 emits nothing at all, so an ablation compares against absence", () => {
    // Not an empty header, not a note that the hook is off — any text would
    // make the "hook off" arm a different prompt rather than no prompt.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hookoff-"));
    fs.writeFileSync(
      path.join(dir, "probe.md"),
      "---\nname: probe\ndescription: Probe. Use when verifying.\nmode: checklist\n---\nbody\n",
      "utf8",
    );
    const out = execFileSync(process.execPath, [hook], {
      encoding: "utf8",
      env: { ...process.env, KATA_GLOBAL_DIR: dir, KATA_PROJECT_ROOT: dir, KATA_HOOK: "0" },
      input: "",
    });
    expect(out).toBe("");
  });

  it("hooks.json launches the hooks with node, not a second runtime", () => {
    // Node is the only runtime a Claude Code user is guaranteed to have. Wiring
    // a hook to anything else turns "install the plugin" into "install a runtime
    // first", and the failure is silent: the prompt just loses its chain list.
    const cfg = read("hooks/hooks.json");
    for (const event of ["UserPromptSubmit", "SessionStart"]) {
      expect(cfg.hooks[event][0].hooks[0].command.startsWith("node ")).toBe(true);
    }
  });

  it("the hook's import graph stays dependency-free", () => {
    // The hook runs inside a plugin checkout where `npm install` has never been
    // run, so every module it reaches may only use node: builtins and relative
    // paths. A bare specifier added to any of these files still passes every
    // other test on a developer machine and breaks on every user's machine.
    for (const file of ["hooks/inject-chains.mjs", "src/loader.ts", "src/types.ts", "src/builtins.ts"]) {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      const specifiers = [...src.matchAll(/(?:^|\s)(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      for (const spec of specifiers) {
        expect(
          spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"),
          `${file} imports "${spec}"; only node: builtins and relative paths are allowed here`,
        ).toBe(true);
      }
    }
  });

  describe("observation mode (opt-in)", () => {
    const chainDir = fs.mkdtempSync(path.join(os.tmpdir(), "hookobs-c-"));
    fs.writeFileSync(
      path.join(chainDir, "probe.md"),
      "---\nname: probe\ndescription: Probe. Use when verifying.\nmode: checklist\n---\nbody\n",
      "utf8",
    );
    const payload = (cwd: string) =>
      JSON.stringify({
        session_id: "s-1",
        prompt_id: "p-1",
        cwd,
        hook_event_name: "UserPromptSubmit",
        prompt: "a secret-bearing prompt",
      });
    const run = (extraEnv: Record<string, string>) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hookobs-p-"));
      // A developer who has observation switched on globally would otherwise
      // fail "writes nothing by default" through no fault of the code: the
      // ambient KATA_OBSERVE is the one thing these tests must not inherit.
      const { KATA_OBSERVE: _ambient, ...inherited } = process.env;
      void _ambient;
      execFileSync(process.execPath, [hook], {
        encoding: "utf8",
        env: { ...inherited, KATA_GLOBAL_DIR: chainDir, KATA_PROJECT_ROOT: cwd, ...extraEnv },
        input: payload(cwd),
      });
      const log = path.join(cwd, ".claude", "kata-observations.jsonl");
      return fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, "utf8").trim()) : null;
    };

    it("writes nothing by default", () => {
      expect(run({})).toBeNull();
    });

    it("records the offer, and the join key the transcript needs", () => {
      const rec = run({ KATA_OBSERVE: "1" });
      expect(rec.prompt_id).toBe("p-1");
      expect(rec.session_id).toBe("s-1");
      expect(rec.injected_bytes).toBeGreaterThan(0);
      expect(rec.offered.map((o: { name: string }) => o.name)).toContain("probe");
    });

    it("does not record the prompt text unless asked twice over", () => {
      // KATA_OBSERVE=1 is a metadata log someone might leave on for weeks; the
      // prompt itself only lands on disk under the louder setting.
      const meta = run({ KATA_OBSERVE: "1" });
      expect(meta.prompt).toBeUndefined();
      expect(meta.prompt_sha256).toBeTruthy();
      expect(meta.prompt_chars).toBe("a secret-bearing prompt".length);

      const full = run({ KATA_OBSERVE: "full" });
      expect(full.prompt).toBe("a secret-bearing prompt");
    });
  });

  it("emits a chain list for a chain in the configured global dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hookcheck-"));
    fs.writeFileSync(
      path.join(dir, "flow.md"),
      "---\nname: flow\ndescription: Test flow. Use when a probe needs a chain.\nmode: checklist\n---\nbody\n",
      "utf8",
    );
    try {
      const out = execFileSync(process.execPath, [hook], {
        encoding: "utf8",
        env: { ...process.env, KATA_GLOBAL_DIR: dir, KATA_PROJECT_ROOT: dir },
      });
      const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
      expect(ctx).toContain("- flow: Use when a probe needs a chain.");
      expect(ctx).not.toContain("chain list unavailable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
