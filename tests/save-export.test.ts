import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Engine, EngineError } from "../src/engine";

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

const VALID = `---
name: my-chain
description: A saved chain. Use when testing save.
mode: checklist
---
- check something
`;

function code(fn: () => unknown): string {
  try {
    fn();
    return "(no error)";
  } catch (e) {
    return (e as EngineError).code;
  }
}

describe("save_chain", () => {
  it("save -> list -> run roundtrip is consistent", () => {
    const { engine } = setup();
    const saved = engine.saveChain({ name: "my-chain", scope: "global", content: VALID }) as any;
    expect(saved.saved).toBe(true);
    expect(saved.mode).toBe("checklist");

    const list = engine.listChains() as any;
    const row = list.chains.find((c: any) => c.name === "my-chain");
    expect(row.scope).toBe("global");

    const run = engine.runChain("my-chain") as any;
    expect(run.content).toContain("check something");
  });

  it("saves to project scope under the project root", () => {
    const { opts, engine } = setup();
    const saved = engine.saveChain({ name: "my-chain", scope: "project", content: VALID }) as any;
    expect(saved.file.startsWith(fs.realpathSync(opts.projectRoot))).toBe(true);
  });

  it("rejects invalid content and writes nothing", () => {
    const { opts, engine } = setup();
    expect(code(() => engine.saveChain({ name: "my-chain", scope: "global", content: "junk" }))).toBe(
      "SAVE_VALIDATION_FAILED",
    );
    expect(fs.existsSync(path.join(opts.globalDir, "my-chain.md"))).toBe(false);
    // no stray temp files either
    expect(fs.readdirSync(opts.globalDir, { recursive: false }).length).toBe(0);
  });

  it("rejects name/frontmatter mismatch", () => {
    const { engine } = setup();
    expect(code(() => engine.saveChain({ name: "other", scope: "global", content: VALID }))).toBe(
      "SAVE_VALIDATION_FAILED",
    );
  });

  it("rejects reserved names (builtin + windows)", () => {
    const { engine } = setup();
    for (const bad of ["master", "default", "nul"]) {
      expect(
        code(() =>
          engine.saveChain({ name: bad, scope: "global", content: VALID.replace("my-chain", bad) }),
        ),
      ).toBe("SAVE_VALIDATION_FAILED");
    }
  });

  it("refuses to clobber without overwrite, replaces with overwrite", () => {
    const { engine } = setup();
    engine.saveChain({ name: "my-chain", scope: "global", content: VALID });
    expect(code(() => engine.saveChain({ name: "my-chain", scope: "global", content: VALID }))).toBe(
      "CHAIN_EXISTS",
    );
    const v2 = VALID.replace("check something", "check twice");
    const saved = engine.saveChain({ name: "my-chain", scope: "global", content: v2, overwrite: true }) as any;
    expect(saved.saved).toBe(true);
    expect((engine.runChain("my-chain") as any).content).toContain("check twice");
  });
});

describe("export_chain", () => {
  it("exports raw content with sha256 matching save", () => {
    const { engine } = setup();
    const saved = engine.saveChain({ name: "my-chain", scope: "global", content: VALID }) as any;
    const exported = engine.exportChain({ name: "my-chain" }) as any;
    expect(exported.content).toBe(VALID);
    expect(exported.sha256).toBe(saved.sha256);
    expect(exported.filename).toBe("my-chain.md");
    expect(exported.scope).toBe("global");
  });

  it("requires scope when the name exists in both layers", () => {
    const { engine } = setup();
    engine.saveChain({ name: "my-chain", scope: "global", content: VALID });
    engine.saveChain({ name: "my-chain", scope: "project", content: VALID });
    expect(code(() => engine.exportChain({ name: "my-chain" }))).toBe("SCOPE_AMBIGUOUS");
    expect((engine.exportChain({ name: "my-chain", scope: "project" }) as any).scope).toBe("project");
  });

  it("unknown name -> CHAIN_NOT_FOUND; invalid file refuses export", () => {
    const { opts, engine } = setup();
    expect(code(() => engine.exportChain({ name: "ghost" }))).toBe("CHAIN_NOT_FOUND");
    fs.mkdirSync(opts.globalDir, { recursive: true });
    fs.writeFileSync(path.join(opts.globalDir, "bad-one.md"), "garbage", "utf8");
    expect(code(() => engine.exportChain({ name: "bad-one" }))).toBe("CHAIN_INVALID");
  });

  it("import flow: export from one engine, save into another", () => {
    const a = setup();
    a.engine.saveChain({ name: "my-chain", scope: "global", content: VALID });
    const exported = a.engine.exportChain({ name: "my-chain" }) as any;

    const b = setup();
    const saved = b.engine.saveChain({ name: exported.name, scope: "project", content: exported.content }) as any;
    expect(saved.sha256).toBe(exported.sha256);
  });
});
