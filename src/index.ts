#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Engine, EngineError } from "./engine.ts";
import { resolveOptions } from "./loader.ts";
import { LIMITS } from "./types.ts";

// Read rather than imported: the same relative path has to work from src/ when
// a plugin checkout runs the TypeScript and from dist/ when npm runs the build,
// and a JSON import would additionally have to be emitted into the build output.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const engine = new Engine(resolveOptions());

const server = new McpServer({
  name: "kata",
  version: pkg.version,
});

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function run(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (e) {
    if (e instanceof EngineError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { code: e.code, message: e.message, data: e.data } }, null, 2),
          },
        ],
        isError: true,
      };
    }
    throw e;
  }
}

// All 5 tools are registered here; keep this list, the README, and the
// Inspector acceptance checklist in sync.

server.registerTool(
  "list_chains",
  {
    description:
      "List all available thinking chains: built-ins (master router, default freeform sequential thinking) plus file-defined chains from the global (~/.claude/kata), pack (<globalDir>/packs/<name>, declared in <root>/.claude/kata.json) and project (<root>/.claude/kata) layers. Shadowing: project > pack > global. Also reports invalid chain files (with reasons), missing packs, pack conflicts and shadowing.",
    inputSchema: {},
  },
  async () => run(() => engine.listChains()),
);

server.registerTool(
  "run_chain",
  {
    description:
      'Start a thinking chain by name. When the task shape clearly matches a chain, call that chain directly; when nothing matches or the task needs multi-step reasoning, call run_chain("master") to route between PASS (no chains), "default" (freeform step-by-step thinking) and custom chains. Checklist chains return one complete checklist (single-shot). Staged/freeform chains open a session; continue with advance_chain.',
    inputSchema: {
      name: z.string().describe('Chain name, e.g. "master", "default", or a custom chain from list_chains'),
    },
  },
  async ({ name }) => run(() => engine.runChain(name)),
);

server.registerTool(
  "advance_chain",
  {
    description:
      "Submit the current stage's result and receive the next stage. Staged chains: pass exactly one of stage_output (work done for this stage) or skip_reason (why the stage was skipped). Freeform default chain: pass each thought as stage_output; set done: true with your final verified thought. expected_stage_index guards against retries: re-sending the previous index returns the same response idempotently.",
    inputSchema: {
      session_id: z.string(),
      expected_stage_index: z.number().int().min(1).describe("The stage index you are submitting (from the last response)"),
      stage_output: z.string().max(LIMITS.STAGE_OUTPUT_MAX_CHARS).optional().describe("Your output/conclusion for this stage (or your thought, for freeform)"),
      skip_reason: z.string().max(LIMITS.SKIP_REASON_MAX_CHARS).optional().describe("Staged chains only: reason this stage is skipped (mutually exclusive with stage_output)"),
      done: z.boolean().optional().describe("Freeform only: true when this is the final, verified thought"),
    },
  },
  async (args) => run(() => engine.advanceChain(args)),
);

server.registerTool(
  "save_chain",
  {
    description:
      "Create or update a custom thinking chain as a Markdown file with YAML frontmatter (fields: name, description, mode: checklist|staged, optional domain/language/schema_version). The content is fully validated before writing; nothing is written on validation failure. name must equal the frontmatter name. Existing chains are only replaced when overwrite: true.",
    inputSchema: {
      name: z.string().describe("Chain name (lowercase slug); must equal the frontmatter name"),
      scope: z.enum(["global", "project"]).describe("global = ~/.claude/kata, project = <root>/.claude/kata"),
      content: z.string().describe("Complete Markdown source including YAML frontmatter"),
      overwrite: z.boolean().optional(),
    },
  },
  async (args) => run(() => engine.saveChain(args)),
);

server.registerTool(
  "export_chain",
  {
    description:
      "Export a chain's raw Markdown source for sharing (returns content, sha256, suggested filename). To import a shared chain, read its file and call save_chain with the content. If the name exists in both global and project scope, pass scope to disambiguate.",
    inputSchema: {
      name: z.string(),
      scope: z.enum(["global", "project"]).optional(),
    },
  },
  async (args) => run(() => engine.exportChain(args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
