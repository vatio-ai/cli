// What the CLI does when the platform refuses a call because this is not its
// current release (426 cli_outdated, see CliOutdatedError): it runs the
// release it was told to through npx, with the same arguments, and exits with
// that run's code. The refused call did nothing, so the whole command can run
// again; stdin a command already read is handed on, so
// `op read … | vatio secrets set KEY` still works.
//
// Returns null when it cannot, and the caller prints the refusal, which says
// how to update: never twice in a row (a release published in between), and
// not on Windows, where npx is a .cmd that Node starts only through a shell
// that would split the arguments again.

import { spawnSync } from "node:child_process";

import { consumedStdin } from "./support.mjs";
import { VERSION } from "./version.mjs";
import { CHANGELOG_URL } from "./release-notes.mjs";

const RAN_LATEST = "VATIO_CLI_RAN_LATEST";

export function runLatest(error, argv) {
  const latest = error.latest;
  if (!/^\d+\.\d+\.\d+$/.test(latest ?? "") || process.env[RAN_LATEST] || process.platform === "win32") return null;

  console.error(
    `vatio: ${VERSION} is not the current release, so this runs ${latest} through npx. ` +
      "`npm install -g @vatio-ai/cli@latest` installs it."
  );
  // The one place a coding agent crosses a version boundary: the update
  // notice prints only to a terminal, and an agent has none, so this was the
  // whole of what it ever learned about a new release. What changed is a
  // command away now.
  console.error(`vatio: what changed between them: \`vatio changelog\` (or ${CHANGELOG_URL}).`);
  const input = consumedStdin();
  const child = spawnSync("npx", ["--yes", `@vatio-ai/cli@${latest}`, ...argv.slice(2)], {
    stdio: input === null ? "inherit" : ["pipe", "inherit", "inherit"],
    input: input ?? undefined,
    env: { ...process.env, [RAN_LATEST]: latest }
  });
  if (child.error) return null;
  return child.status ?? 1;
}
