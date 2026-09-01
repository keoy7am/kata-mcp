import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  LIMITS,
  isReservedName,
  splitFrontmatter,
  validateFrontmatter,
  validatePackManifest,
} from "./types.ts";
import type { Chain, ChainScope, InvalidChainFile, LoadResult, PackStatus, Stage } from "./types.ts";

export interface LoaderOptions {
  globalDir: string;
  projectRoot: string;
  /** Defaults to <globalDir>/packs. */
  packsDir?: string;
}

function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Resolve dirs once at startup: env override > cwd. Never guess later. */
export function resolveOptions(env: NodeJS.ProcessEnv = process.env): LoaderOptions {
  const projectRoot = canonical(env.KATA_PROJECT_ROOT || process.cwd());
  const globalDir = canonical(env.KATA_GLOBAL_DIR || path.join(os.homedir(), ".claude", "kata"));
  const packsDir = env.KATA_PACKS_DIR ? canonical(env.KATA_PACKS_DIR) : undefined;
  return { globalDir, projectRoot, packsDir };
}

export function projectChainsDir(opts: LoaderOptions): string {
  return path.join(opts.projectRoot, ".claude", "kata");
}

export function packsDirOf(opts: LoaderOptions): string {
  return opts.packsDir ?? path.join(opts.globalDir, "packs");
}

export function packManifestPath(opts: LoaderOptions): string {
  return path.join(opts.projectRoot, ".claude", "kata.json");
}

/** Declared pack names from the project manifest; a broken manifest is reported, not guessed around. */
function readPackManifest(opts: LoaderOptions): { packs: string[]; invalid: InvalidChainFile[] } {
  const file = packManifestPath(opts);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { packs: [], invalid: [] };
    return { packs: [], invalid: [{ file, error: `read failed: ${(e as Error).message}` }] };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { packs: [], invalid: [{ file, error: `manifest is not valid JSON: ${(e as Error).message}` }] };
  }
  const parsed = validatePackManifest(data);
  if (parsed.issue) {
    return {
      packs: [],
      invalid: [{ file, error: `manifest invalid at "${parsed.issue.path}": ${parsed.issue.message}` }],
    };
  }
  return { packs: [...new Set(parsed.value!.packs)], invalid: [] };
}

/** Conventional repository documentation, in any of the layer directories. */
const REPO_DOCS = new Set([
  "contributing.md",
  "changelog.md",
  "license.md",
  "code_of_conduct.md",
  "code-of-conduct.md",
  "security.md",
  "authors.md",
  "notice.md",
]);

/** README.md and every translation of it: README.zh-TW.md, README.fr.md… */
export function isReadme(filename: string): boolean {
  return filename.toLowerCase().startsWith("readme.");
}

export function isRepoDoc(filename: string): boolean {
  return REPO_DOCS.has(filename.toLowerCase());
}

/** A chain file always opens with a frontmatter fence; documentation never does. */
export function hasFrontmatter(source: string): boolean {
  return /^﻿?---[ \t]*\r?\n/.test(source);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Split body into stages on `## Stage:` headings, ignoring headings inside
 * fenced code blocks. Content before the first heading is prepended to the
 * first stage's prompt.
 */
export function splitStages(body: string): { stages: Stage[]; preamble: string } {
  const stages: Stage[] = [];
  let preamble: string[] = [];
  let current: { title: string; lines: string[] } | null = null;
  // CommonMark-ish fence tracking: a fence only closes on the same character
  // repeated at least as many times, with nothing else on the line — so a
  // three-backtick line inside a four-backtick fence stays inside.
  let fence: { ch: string; len: number } | null = null;

  for (const line of body.split(/\r?\n/)) {
    const fm = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fm) {
      const ch = fm[1][0];
      const len = fm[1].length;
      if (!fence) fence = { ch, len };
      else if (ch === fence.ch && len >= fence.len && fm[2].trim() === "") fence = null;
    }
    const m = !fence && !fm && line.match(/^## Stage:\s*(.+?)\s*$/);
    if (m) {
      if (current) stages.push({ title: current.title, prompt: current.lines.join("\n").trim() });
      current = { title: m[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) stages.push({ title: current.title, prompt: current.lines.join("\n").trim() });
  return { stages, preamble: preamble.join("\n").trim() };
}

/**
 * Validate one chain source. Returns either a parsed chain (scope/filePath
 * filled by caller) or a structured error string naming what failed.
 */
export function validateChainSource(
  source: string,
  expectedName?: string,
): { chain?: Omit<Chain, "scope" | "filePath">; error?: string } {
  if (Buffer.byteLength(source, "utf8") > LIMITS.FILE_MAX_BYTES) {
    return { error: `file exceeds ${LIMITS.FILE_MAX_BYTES} bytes` };
  }

  const parsed = splitFrontmatter(source);
  if (parsed.error) return { error: `frontmatter parse failed: ${parsed.error}` };

  const fm = validateFrontmatter(parsed.data);
  if (fm.issue) {
    return { error: `frontmatter invalid at "${fm.issue.path}": ${fm.issue.message}` };
  }
  const front = fm.value!;

  const reserved = isReservedName(front.name);
  if (reserved) return { error: `name rejected: ${reserved}` };

  if (expectedName !== undefined && front.name !== expectedName) {
    return {
      error: `name mismatch: frontmatter name "${front.name}" must equal "${expectedName}" (filename / API parameter)`,
    };
  }

  const body = parsed.content.trim();
  const { stages, preamble } = splitStages(body);

  if (front.mode === "checklist") {
    if (stages.length > 0) {
      return { error: `checklist chain must not contain "## Stage:" headings (found ${stages.length})` };
    }
    if (!body) return { error: "checklist chain has an empty body" };
    return {
      chain: {
        name: front.name,
        description: front.description,
        mode: front.mode,
        domain: front.domain,
        language: front.language,
        raw: source,
        body,
        stages: [],
        sha256: sha256(source),
      },
    };
  }

  // staged
  if (stages.length < LIMITS.STAGES_MIN || stages.length > LIMITS.STAGES_MAX) {
    return {
      error: `staged chain must have ${LIMITS.STAGES_MIN}-${LIMITS.STAGES_MAX} stages (found ${stages.length})`,
    };
  }
  // Merge the preamble into stage 1 BEFORE the emptiness check, so a chain
  // whose first stage content lives in the preamble is valid.
  if (preamble) {
    stages[0] = {
      ...stages[0],
      prompt: stages[0].prompt ? `${preamble}\n\n${stages[0].prompt}` : preamble,
    };
  }
  const empty = stages.find((s) => !s.prompt);
  if (empty) return { error: `stage "${empty.title}" is empty` };

  return {
    chain: {
      name: front.name,
      description: front.description,
      mode: front.mode,
      domain: front.domain,
      language: front.language,
      raw: source,
      body,
      stages,
      sha256: sha256(source),
    },
  };
}

function loadDir(
  dir: string,
  scope: Exclude<ChainScope, "builtin">,
): { chains: Chain[]; invalid: InvalidChainFile[] } {
  const chains: Chain[] = [];
  const invalid: InvalidChainFile[] = [];
  let entries: string[];
  try {
    // A README is the directory's own documentation in any language, never a
    // chain — chain libraries are git repos and always have one.
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !isReadme(f));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { chains, invalid }; // dir absent = zero chains, not an error
    }
    // Any other failure (permissions, I/O) is "couldn't tell", not "empty" —
    // surface it instead of silently loading a partial view.
    invalid.push({ file: dir, error: `directory read failed: ${(e as Error).message}` });
    return { chains, invalid };
  }
  for (const file of entries.sort()) {
    const filePath = path.join(dir, file);
    const base = file.slice(0, -3);
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      invalid.push({ file: filePath, error: `read failed: ${(e as Error).message}` });
      continue;
    }
    // The rest of a repo's paperwork — CONTRIBUTING, CHANGELOG, SECURITY.
    // Reporting those as invalid chain files forever is noise that trains
    // people to ignore the invalid list. Skipping them by name alone would
    // silently drop a chain someone named "security", so the frontmatter fence
    // decides: documentation has none, and a chain file that lost its
    // frontmatter is still reported rather than vanishing.
    if (isRepoDoc(file) && !hasFrontmatter(source)) continue;
    const result = validateChainSource(source, base);
    if (result.error) {
      invalid.push({ file: filePath, error: result.error });
    } else {
      chains.push({ ...result.chain!, scope, filePath });
    }
  }
  return { chains, invalid };
}

/** Fresh scan on every call — no caching, no staleness. */
export function loadAll(opts: LoaderOptions): LoadResult {
  const projectDir = projectChainsDir(opts);
  const packsDir = packsDirOf(opts);
  const g = loadDir(opts.globalDir, "global");
  const p = loadDir(projectDir, "project");

  // Packs: declared per project, stored in the chain library. A declared pack
  // that is not on disk is reported (the library needs a pull), never silently empty.
  const manifest = readPackManifest(opts);
  const packs: PackStatus[] = [];
  const packInvalid: InvalidChainFile[] = [...manifest.invalid];
  const packChains: Chain[] = [];
  for (const name of manifest.packs) {
    const dir = path.join(packsDir, name);
    const found = fs.existsSync(dir);
    packs.push({ name, dir, found });
    if (!found) {
      packInvalid.push({
        file: dir,
        error: `pack "${name}" is declared in ${packManifestPath(opts)} but not present — update the chain library (git pull in ${opts.globalDir})`,
      });
      continue;
    }
    const r = loadDir(dir, `pack:${name}`);
    packChains.push(...r.chains);
    packInvalid.push(...r.invalid);
  }

  const effective = new Map<string, Chain>();
  const shadowed: LoadResult["shadowed"] = [];
  for (const c of g.chains) effective.set(c.name, c);

  // Two packs defining the same name: no sane winner — drop both, report.
  const byName = new Map<string, Chain[]>();
  for (const c of packChains) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  const packConflicts: LoadResult["packConflicts"] = [];
  for (const [name, list] of byName) {
    if (list.length > 1) {
      packConflicts.push({ name, packs: list.map((c) => c.scope.slice("pack:".length)) });
      continue;
    }
    const c = list[0];
    if (effective.has(c.name)) shadowed.push({ name: c.name, hiddenScope: effective.get(c.name)!.scope });
    effective.set(c.name, c);
  }

  for (const c of p.chains) {
    if (effective.has(c.name)) shadowed.push({ name: c.name, hiddenScope: effective.get(c.name)!.scope });
    effective.set(c.name, c);
  }

  // Fail-closed: invalid project file whose filename claims a lower-layer chain's
  // name. Lowercased because Windows filenames are case-insensitive, and only
  // .md entries count (a directory-level error entry claims no name).
  const invalidProjectNames = new Set(
    p.invalid
      .filter((i) => i.file.endsWith(".md"))
      .map((i) => path.basename(i.file).replace(/\.md$/, "").toLowerCase()),
  );
  const blockedByInvalidOverride: string[] = [];
  for (const name of invalidProjectNames) {
    if (effective.has(name) && effective.get(name)!.scope !== "project") {
      effective.delete(name);
      blockedByInvalidOverride.push(name);
    }
  }

  return {
    projectRoot: opts.projectRoot,
    globalDir: opts.globalDir,
    projectDir,
    packsDir,
    packs,
    chains: [...effective.values()],
    invalid: [...g.invalid, ...packInvalid, ...p.invalid],
    shadowed,
    packConflicts,
    blockedByInvalidOverride,
  };
}
