const HOOK_MAX_CHAINS = 16;
const HOOK_MAX_DESC_CHARS = 155;
/** The hook's own HEAD text (routing instructions + ToolSearch query). */
const HOOK_HEAD_BYTES = 450;
/** `- <name>: ` prefix and newline around one chain hint. */
const HOOK_LINE_OVERHEAD_BYTES = 20;

/** Single source of truth for every hard limit in the system. */
export const LIMITS = {
  FILE_MAX_BYTES: 64 * 1024,
  STAGES_MIN: 2,
  STAGES_MAX: 12,
  DESC_MAX: 500,
  MAX_SESSIONS: 32,
  STAGE_OUTPUT_MAX_CHARS: 32768,
  SKIP_REASON_MAX_CHARS: 2048,
  HOOK_MAX_CHAINS,
  /**
   * Derived, not hand-set: enough bytes for HOOK_MAX_CHAINS full hints plus
   * the hook's own header, so the byte cap can never silently undercut the
   * chain cap. At 15 chains the old fixed 2400 had 16 bytes left, and the
   * next chain would have dropped to name-only with no signal. Raising this
   * costs nothing until a chain actually uses the room (~130 bytes each).
   */
  HOOK_MAX_BYTES: HOOK_HEAD_BYTES + HOOK_MAX_CHAINS * (HOOK_LINE_OVERHEAD_BYTES + HOOK_MAX_DESC_CHARS),
  /**
   * 155 is the longest trigger clause in the shipped chain library, so this is
   * the point where every chain's full trigger list is visible and more budget
   * buys literally nothing. Going further would mean injecting the summary half
   * too — measured at ~30k extra context tokens over 50 turns, i.e. ~19 master
   * calls' worth, to avoid the 1-3 master calls a session actually makes.
   */
  HOOK_MAX_DESC_CHARS,
  /** Nth traced staged/freeform session start within the window reports a repeat fact. */
  DEEPENING_ALERT_RUNS: 3,
  DEEPENING_WINDOW_HOURS: 48,
} as const;

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** BCP 47-ish tag, e.g. "en", "zh-TW". */
export const LANGUAGE_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export const BUILTIN_NAMES = new Set(["master", "default"]);

const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function isReservedName(name: string): string | null {
  if (BUILTIN_NAMES.has(name)) return `"${name}" is a built-in chain name`;
  if (WINDOWS_RESERVED.has(name)) return `"${name}" is a Windows reserved filename`;
  return null;
}

export interface Frontmatter {
  name: string;
  description: string;
  mode: "checklist" | "staged";
  domain?: string;
  language?: string;
  schema_version: 1;
}

/** One validation failure, shaped for the `... invalid at "<path>": <message>` reports. */
export interface Issue {
  path: string;
  message: string;
}

const FRONTMATTER_KEYS = ["name", "description", "mode", "domain", "language", "schema_version"];

/**
 * Frontmatter is a flat map of single-line scalars, so it is parsed here rather
 * than with a YAML library: the loader and the prompt hook both run before any
 * dependency is installed, and a chain file that needs nested YAML is a chain
 * file this format does not have. Anything outside the supported subset is a
 * reported error, never a silent misparse.
 */
export function splitFrontmatter(source: string): { data: Record<string, unknown>; content: string; error?: string } {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, content: text };

  const data: Record<string, unknown> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/);
    if (!kv) {
      return {
        data: {},
        content: "",
        error: `unsupported frontmatter syntax on line ${i + 1}: ${JSON.stringify(line)} (expected "key: value"; lists, nesting and block scalars are not supported)`,
      };
    }
    const key = kv[1];
    if (key in data) return { data: {}, content: "", error: `duplicate frontmatter key "${key}"` };
    let value: string = kv[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    data[key] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return { data, content: text.slice(m[0].length) };
}

export function validateFrontmatter(data: Record<string, unknown>): { value?: Frontmatter; issue?: Issue } {
  for (const key of Object.keys(data)) {
    if (!FRONTMATTER_KEYS.includes(key)) {
      return { issue: { path: key, message: `unrecognized key "${key}"` } };
    }
  }

  const { name, description, mode, domain, language } = data;
  if (name === undefined) return { issue: { path: "name", message: "required" } };
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return { issue: { path: "name", message: "name must match ^[a-z0-9][a-z0-9-]{0,63}$ (ASCII slug)" } };
  }
  if (description === undefined) return { issue: { path: "description", message: "required" } };
  if (typeof description !== "string" || description.length === 0) {
    return { issue: { path: "description", message: "description must be a non-empty string" } };
  }
  if (description.length > LIMITS.DESC_MAX) {
    return { issue: { path: "description", message: `description must be at most ${LIMITS.DESC_MAX} characters` } };
  }
  if (mode !== "checklist" && mode !== "staged") {
    return { issue: { path: "mode", message: 'mode must be "checklist" or "staged"' } };
  }
  if (domain !== undefined && (typeof domain !== "string" || domain.length > 64)) {
    return { issue: { path: "domain", message: "domain must be a string of at most 64 characters" } };
  }
  if (language !== undefined && (typeof language !== "string" || !LANGUAGE_RE.test(language))) {
    return { issue: { path: "language", message: "language must be a BCP 47 tag like zh-TW" } };
  }
  const schemaVersion = data.schema_version ?? 1;
  if (schemaVersion !== 1) {
    return { issue: { path: "schema_version", message: "schema_version must be 1" } };
  }

  return {
    value: {
      name,
      description,
      mode,
      domain: domain as string | undefined,
      language: language as string | undefined,
      schema_version: 1,
    },
  };
}

/** "pack:<name>" = a chain pack from the chain library (see LoadResult.packs). */
export type ChainScope = "global" | "project" | "builtin" | `pack:${string}`;

export const PACKS_MAX = 16;

/** <project>/.claude/kata.json */
export function validatePackManifest(data: unknown): { value?: { packs: string[] }; issue?: Issue } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { issue: { path: "", message: "manifest must be a JSON object" } };
  }
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "packs") return { issue: { path: key, message: `unrecognized key "${key}"` } };
  }
  const packs = obj.packs;
  if (packs === undefined) return { issue: { path: "packs", message: "required" } };
  if (!Array.isArray(packs)) return { issue: { path: "packs", message: "packs must be an array" } };
  if (packs.length > PACKS_MAX) {
    return { issue: { path: "packs", message: `at most ${PACKS_MAX} packs` } };
  }
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i];
    if (typeof p !== "string" || !NAME_RE.test(p)) {
      return { issue: { path: `packs.${i}`, message: "pack name must be a lowercase slug" } };
    }
  }
  return { value: { packs: packs as string[] } };
}

export interface PackStatus {
  name: string;
  dir: string;
  found: boolean;
}

export interface Stage {
  title: string;
  prompt: string;
}

export interface Chain {
  name: string;
  description: string;
  mode: "checklist" | "staged";
  domain?: string;
  language?: string;
  scope: ChainScope;
  filePath?: string;
  /** Full raw markdown source (frontmatter included). */
  raw: string;
  /** Body without frontmatter. For checklist chains this is what run_chain returns. */
  body: string;
  stages: Stage[];
  sha256: string;
}

export interface InvalidChainFile {
  file: string;
  error: string;
}

export interface LoadResult {
  projectRoot: string;
  globalDir: string;
  projectDir: string;
  /** Root holding chain packs: <packsDir>/<pack>/*.md (default <globalDir>/packs). */
  packsDir: string;
  /** Packs declared by the project manifest, whether or not they exist on disk. */
  packs: PackStatus[];
  /** Effective chains after project > pack > global shadowing. */
  chains: Chain[];
  invalid: InvalidChainFile[];
  /** Lower-layer chains hidden by a valid higher-layer chain of the same name. */
  shadowed: { name: string; hiddenScope: ChainScope }[];
  /** Same chain name in two declared packs: neither is loaded (fail-closed). */
  packConflicts: { name: string; packs: string[] }[];
  /**
   * Names where a global chain exists but an INVALID project file claims the
   * same name. Fail-closed: run_chain must refuse instead of silently running
   * the stale global chain.
   */
  blockedByInvalidOverride: string[];
}
