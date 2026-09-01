import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAll, splitStages, validateChainSource } from "../src/loader";
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

function opts() {
  return { globalDir: tmpdir(), projectRoot: tmpdir() };
}
function writeChain(dir: string, file: string, content: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content, "utf8");
}
function projDir(root: string) {
  return path.join(root, ".claude", "kata");
}

const CHECKLIST = `---
name: my-check
description: A check. Use when testing.
mode: checklist
schema_version: 1
---
- item one
- item two
`;

function staged(name: string, stages = 2): string {
  const body = Array.from({ length: stages }, (_, i) => `## Stage: S${i + 1}\ndo thing ${i + 1}`).join("\n\n");
  return `---\nname: ${name}\ndescription: Staged. Use when testing.\nmode: staged\n---\n\n${body}\n`;
}

describe("validateChainSource", () => {
  it("accepts a valid checklist", () => {
    const r = validateChainSource(CHECKLIST, "my-check");
    expect(r.error).toBeUndefined();
    expect(r.chain!.mode).toBe("checklist");
    expect(r.chain!.body).toContain("item one");
  });

  it("rejects bad frontmatter with a structured reason", () => {
    const r = validateChainSource(`---\nname: x\nmode: nope\n---\nbody`, "x");
    expect(r.error).toMatch(/frontmatter invalid/);
  });

  it("rejects unknown frontmatter fields (strict)", () => {
    const r = validateChainSource(
      `---\nname: x\ndescription: d\nmode: checklist\ntriggers: [a]\n---\nbody`,
      "x",
    );
    expect(r.error).toMatch(/frontmatter invalid/);
  });

  it("rejects name mismatch between frontmatter and filename", () => {
    const r = validateChainSource(CHECKLIST, "other-name");
    expect(r.error).toMatch(/name mismatch/);
  });

  it("rejects uppercase / non-slug names", () => {
    const r = validateChainSource(CHECKLIST.replace("my-check", "My-Check"), "My-Check");
    expect(r.error).toMatch(/frontmatter invalid/);
  });

  it("rejects Windows reserved and builtin names", () => {
    for (const bad of ["con", "master", "default"]) {
      const r = validateChainSource(CHECKLIST.replace("my-check", bad), bad);
      expect(r.error).toMatch(/name rejected/);
    }
  });

  it("rejects files over the size limit", () => {
    const big = CHECKLIST + "x".repeat(LIMITS.FILE_MAX_BYTES);
    expect(validateChainSource(big, "my-check").error).toMatch(/exceeds/);
  });

  it("rejects staged chains outside 2-12 stages", () => {
    expect(validateChainSource(staged("s", 1), "s").error).toMatch(/2-12 stages/);
    expect(validateChainSource(staged("s", 13), "s").error).toMatch(/2-12 stages/);
    expect(validateChainSource(staged("s", 12), "s").error).toBeUndefined();
  });

  it("rejects empty stages", () => {
    const src = `---\nname: s\ndescription: d\nmode: staged\n---\n## Stage: A\ncontent\n## Stage: B\n`;
    expect(validateChainSource(src, "s").error).toMatch(/empty/);
  });

  it("rejects checklist chains containing stage headings", () => {
    const src = `---\nname: c\ndescription: d\nmode: checklist\n---\n## Stage: oops\nx`;
    expect(validateChainSource(src, "c").error).toMatch(/must not contain/);
  });

  it("does not split on stage headings inside fenced code blocks", () => {
    const body = [
      "intro",
      "## Stage: Real one",
      "content",
      "```md",
      "## Stage: fake inside fence",
      "```",
      "more content",
      "## Stage: Real two",
      "content2",
    ].join("\n");
    const { stages } = splitStages(body);
    expect(stages.map((s) => s.title)).toEqual(["Real one", "Real two"]);
    expect(stages[0].prompt).toContain("fake inside fence");
  });

  it("prepends preamble to the first stage", () => {
    const { stages, preamble } = splitStages("intro text\n## Stage: A\nbody");
    expect(preamble).toBe("intro text");
    expect(stages[0].prompt).toBe("body");
  });

  it("a chain whose first stage content is only the preamble is valid", () => {
    const src = `---\nname: s\ndescription: d\nmode: staged\n---\npreamble becomes stage one\n## Stage: One\n## Stage: Two\ncontent`;
    const r = validateChainSource(src, "s");
    expect(r.error).toBeUndefined();
    expect(r.chain!.stages[0].prompt).toBe("preamble becomes stage one");
  });

  it("a three-backtick line inside a four-backtick fence does not close it", () => {
    const body = [
      "## Stage: Real",
      "````md",
      "```",
      "## Stage: fake, still fenced",
      "```",
      "````",
      "after",
      "## Stage: Real two",
      "content2",
    ].join("\n");
    const { stages } = splitStages(body);
    expect(stages.map((s) => s.title)).toEqual(["Real", "Real two"]);
  });
});

describe("loadAll layering", () => {
  it("project chain shadows same-named global chain", () => {
    const o = opts();
    writeChain(o.globalDir, "my-check.md", CHECKLIST);
    writeChain(projDir(o.projectRoot), "my-check.md", CHECKLIST.replace("item one", "project item"));
    const r = loadAll(o);
    expect(r.chains).toHaveLength(1);
    expect(r.chains[0].scope).toBe("project");
    expect(r.chains[0].body).toContain("project item");
    expect(r.shadowed).toEqual([{ name: "my-check", hiddenScope: "global" }]);
  });

  it("invalid project override blocks the global chain (fail-closed)", () => {
    const o = opts();
    writeChain(o.globalDir, "my-check.md", CHECKLIST);
    writeChain(projDir(o.projectRoot), "my-check.md", "---\nbroken: true\n---\nx");
    const r = loadAll(o);
    expect(r.chains).toHaveLength(0);
    expect(r.blockedByInvalidOverride).toEqual(["my-check"]);
    expect(r.invalid).toHaveLength(1);
  });

  it("invalid files are reported with reasons, never silently dropped", () => {
    const o = opts();
    writeChain(o.globalDir, "good.md", CHECKLIST.replace("my-check", "good"));
    writeChain(o.globalDir, "bad.md", "not even frontmatter");
    const r = loadAll(o);
    expect(r.chains.map((c) => c.name)).toEqual(["good"]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].file).toContain("bad.md");
    expect(r.invalid[0].error).toBeTruthy();
  });

  it("README.md is documentation, not an invalid chain", () => {
    const o = opts();
    writeChain(o.globalDir, "good.md", CHECKLIST.replace("my-check", "good"));
    writeChain(o.globalDir, "README.md", "# my chain library\n");
    writeChain(projDir(o.projectRoot), "readme.md", "# project chains\n");
    const r = loadAll(o);
    expect(r.chains.map((c) => c.name)).toEqual(["good"]);
    expect(r.invalid).toEqual([]);
  });

  it("translated READMEs and repo paperwork are documentation, not invalid chains", () => {
    // A chain library is a git repo, so it ships README.zh-TW.md, CONTRIBUTING
    // and friends. Reporting those forever trains people to ignore `invalid`.
    const o = opts();
    writeChain(o.globalDir, "good.md", CHECKLIST.replace("my-check", "good"));
    writeChain(o.globalDir, "README.zh-TW.md", "# 鏈庫\n");
    writeChain(o.globalDir, "CONTRIBUTING.md", "# Contributing\n");
    writeChain(o.globalDir, "CHANGELOG.md", "# Changelog\n");
    const r = loadAll(o);
    expect(r.chains.map((c) => c.name)).toEqual(["good"]);
    expect(r.invalid).toEqual([]);
  });

  it("a chain may still be named like repo paperwork", () => {
    // The name alone must not disqualify a file: security.md with real
    // frontmatter is a chain, and dropping it silently would be worse than the
    // noise this exclusion removes.
    const o = opts();
    writeChain(o.globalDir, "security.md", CHECKLIST.replace("my-check", "security"));
    const r = loadAll(o);
    expect(r.chains.map((c) => c.name)).toEqual(["security"]);
    expect(r.invalid).toEqual([]);
  });

  it("missing directories mean zero chains, not errors", () => {
    const r = loadAll(opts());
    expect(r.chains).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  it("invalid project override blocks case-insensitively (Windows filenames)", () => {
    const o = opts();
    writeChain(o.globalDir, "my-check.md", CHECKLIST);
    writeChain(projDir(o.projectRoot), "MY-CHECK.md", "---\nbroken: true\n---\nx");
    const r = loadAll(o);
    expect(r.blockedByInvalidOverride).toEqual(["my-check"]);
    expect(r.chains).toHaveLength(0);
  });
});

describe("loadAll packs", () => {
  function packOpts() {
    const o = { globalDir: tmpdir(), projectRoot: tmpdir(), packsDir: tmpdir() };
    fs.mkdirSync(path.join(o.projectRoot, ".claude"), { recursive: true });
    return o;
  }
  function manifest(o: { projectRoot: string }, body: string) {
    fs.writeFileSync(path.join(o.projectRoot, ".claude", "kata.json"), body, "utf8");
  }
  const chain = (name: string) => CHECKLIST.replace("my-check", name);

  it("declared packs load with scope pack:<name>; no manifest = no packs", () => {
    const o = packOpts();
    writeChain(path.join(o.packsDir, "laravel"), "lara-pass.md", chain("lara-pass"));
    expect(loadAll(o).chains).toEqual([]);
    manifest(o, '{"packs":["laravel"]}');
    const r = loadAll(o);
    expect(r.chains.map((c) => [c.name, c.scope])).toEqual([["lara-pass", "pack:laravel"]]);
    expect(r.packs).toEqual([{ name: "laravel", dir: path.join(o.packsDir, "laravel"), found: true }]);
    expect(r.invalid).toEqual([]);
  });

  it("a declared pack missing on disk is reported, not silently empty", () => {
    const o = packOpts();
    writeChain(o.globalDir, "g.md", chain("g"));
    manifest(o, '{"packs":["golang"]}');
    const r = loadAll(o);
    expect(r.chains.map((c) => c.name)).toEqual(["g"]);
    expect(r.packs[0].found).toBe(false);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].error).toMatch(/pack "golang".*not present/);
  });

  it("shadowing order is project > pack > global", () => {
    const o = packOpts();
    writeChain(o.globalDir, "x.md", chain("x").replace("item one", "global"));
    writeChain(path.join(o.packsDir, "p1"), "x.md", chain("x").replace("item one", "pack"));
    manifest(o, '{"packs":["p1"]}');
    let r = loadAll(o);
    expect(r.chains[0].scope).toBe("pack:p1");
    expect(r.shadowed).toEqual([{ name: "x", hiddenScope: "global" }]);
    writeChain(projDir(o.projectRoot), "x.md", chain("x").replace("item one", "project"));
    r = loadAll(o);
    expect(r.chains[0].scope).toBe("project");
    expect(r.shadowed).toEqual([
      { name: "x", hiddenScope: "global" },
      { name: "x", hiddenScope: "pack:p1" },
    ]);
  });

  it("same name in two packs loads neither and reports the conflict", () => {
    const o = packOpts();
    writeChain(path.join(o.packsDir, "a"), "dup.md", chain("dup"));
    writeChain(path.join(o.packsDir, "b"), "dup.md", chain("dup"));
    manifest(o, '{"packs":["a","b"]}');
    const r = loadAll(o);
    expect(r.chains).toEqual([]);
    expect(r.packConflicts).toEqual([{ name: "dup", packs: ["a", "b"] }]);
  });

  it("invalid project override also blocks a pack chain (fail-closed)", () => {
    const o = packOpts();
    writeChain(path.join(o.packsDir, "p"), "y.md", chain("y"));
    manifest(o, '{"packs":["p"]}');
    writeChain(projDir(o.projectRoot), "y.md", "---\nbroken: true\n---\nx");
    const r = loadAll(o);
    expect(r.chains).toEqual([]);
    expect(r.blockedByInvalidOverride).toEqual(["y"]);
  });

  it("broken or unsafe manifests are reported and load zero packs", () => {
    const o = packOpts();
    manifest(o, "{not json");
    expect(loadAll(o).invalid[0].error).toMatch(/not valid JSON/);
    manifest(o, '{"packs":["../etc"]}');
    const r = loadAll(o);
    expect(r.packs).toEqual([]);
    expect(r.invalid[0].error).toMatch(/manifest invalid/);
  });
});
