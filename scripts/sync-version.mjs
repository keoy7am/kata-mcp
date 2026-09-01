// Runs from npm's `version` lifecycle, after package.json has been bumped.
//
// package.json is the single source. src/index.ts imports it, so the version the
// MCP server reports to clients is derived, not copied. Two files cannot do that
// and are written here instead:
//
//   .claude-plugin/plugin.json — Claude Code reads it as a static file.
//   plugin.mcp.json            — pins the npm version the plugin launches, so a
//                                plugin checkout and the server it starts can
//                                never be different releases.
//
// marketplace.json deliberately carries no version at all (the field is optional,
// and most plugins in Anthropic's own marketplace omit it); tests/manifest.test.ts
// fails if one reappears, and if either file above drifts.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const pluginPath = join(root, ".claude-plugin", "plugin.json");
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
if (plugin.version !== version) {
  plugin.version = version;
  writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n", "utf8");
  console.log(`plugin.json -> ${version}`);
}

const mcpPath = join(root, "plugin.mcp.json");
const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
const args = mcp.mcpServers.chains.args;
const pinned = `${name}@${version}`;
const at = args.findIndex((a) => a.startsWith(`${name}@`));
if (at === -1) throw new Error(`plugin.mcp.json has no "${name}@<version>" argument to pin`);
if (args[at] !== pinned) {
  args[at] = pinned;
  writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n", "utf8");
  console.log(`plugin.mcp.json -> ${pinned}`);
}
