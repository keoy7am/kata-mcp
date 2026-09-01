// SessionStart hook: fast-forward the chain library (~/.claude/kata) so every
// project sees current global chains and packs without a manual pull.
// Best-effort by design: no .git, no network, or a diverged branch all leave the
// local copy in place and never block the session. Nothing is printed on success.
//
// The one thing it does say out loud is that the library is absent entirely,
// because a plugin with no chains behaves exactly like a plugin that is broken:
// master routes to an empty list and nothing explains why. Once the directory
// exists this hook is silent forever, so it cannot decay into noise.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const LIBRARY_URL = "https://github.com/keoy7am/kata-chains.git";

try {
  const dir = process.env.KATA_GLOBAL_DIR || path.join(os.homedir(), ".claude", "kata");
  if (!fs.existsSync(dir)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext:
            `kata: no chain library at ${dir}, so only the built-in master and default chains are available. ` +
            `To install the reference library: git clone ${LIBRARY_URL} "${dir}" — or create the directory and write your own chains there.`,
        },
      }),
    );
  } else if (fs.existsSync(path.join(dir, ".git"))) {
    // --ff-only: never create merge commits in a library the user hand-edits.
    spawnSync("git", ["-C", dir, "pull", "--ff-only", "--quiet"], {
      stdio: "ignore",
      timeout: 10_000,
      windowsHide: true,
    });
  }
} catch {
  /* silent */
}
