import { readFileSync } from "node:fs";
import { deployClient } from "./deploy.mjs";
import { fail, takeEnv, takeFlag, takeValue } from "../support.mjs";

// `vatio propose`: put a branch's environment in front of the workspace's
// owner as a change to accept from the inbox, for a workspace with no
// repository connected -- there, the pull request is the proposal. Vatio
// replays every eval case on it and mails the owner once they finish; the
// owner accepts (which publishes it) or discards it. Proposing the same
// environment again, after another push, updates it and replays the evals.
export async function propose(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  if (takeFlag(args, "--list")) return await list(client, workspace);

  const title = takeValue(args, "--title");
  const summaryFile = takeValue(args, "--summary-file");
  let summary = takeValue(args, "--summary");
  if (summaryFile) {
    try {
      summary = readFileSync(summaryFile, "utf8");
    } catch (error) {
      fail(`Could not read ${summaryFile}: ${error.message}`);
    }
  }
  const environment = takeEnv(args, { fallback: null, cwd: config.workspaceRoot });
  if (!environment) {
    fail('usage: vatio propose --env NAME --title "What it fixes" [--summary TEXT | --summary-file PATH]');
  }

  const payload = await client.propose({ environment, title, summary });
  console.log(`${payload.created ? "Proposed" : "Updated"} ${payload.environment} as ${payload.id}: ${payload.title}`);
  const runs = Array.isArray(payload.runs) ? payload.runs : [];
  const cases = runs.reduce((sum, run) => sum + (run.cases ?? 0), 0);
  if (cases > 0) {
    console.log(`Replaying ${cases} eval case${cases === 1 ? "" : "s"} there; the owner gets a mail when they finish.`);
  } else {
    console.log("No eval cases to replay: the owner decides on the change alone.");
  }
  console.log(`Accept or discard it in the inbox: ${payload.url}`);
}

async function list(client, workspace) {
  const payload = await client.proposals();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  console.log(`Proposals on workspace ${workspace} (${rows.length}):`);
  for (const row of rows) {
    console.log(`  ${row.id}  ${row.status.padEnd(9)}  ${row.environment}  ${row.title}`);
    console.log(`    ${row.url}`);
  }
}
