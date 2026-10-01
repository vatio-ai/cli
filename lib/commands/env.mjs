// `vatio env` — where you are working, and how to point things at it.
//
// On a branch other than the default one, every command works in the branch's
// own environment (see branch.mjs): its agent, its knowledge changes on top of
// live, its secret values. This is the command that says which one that is and
// hands over what an app needs to talk to it -- the publishable token and the
// widget snippet -- and the link to try it in the console.

import { deployClient } from "./deploy.mjs";
import { fail, takeEnv } from "../support.mjs";

export async function env(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = ["list", "show", "rm"].includes(args[0]) ? args.shift() : "show";

  if (sub === "list") return await list(client, workspace);

  const named = args.find((arg) => !arg.startsWith("-"));
  if (named) args.splice(args.indexOf(named), 1);
  const name = named ?? takeEnv(args, { fallback: "preview", cwd: config.workspaceRoot });

  if (sub === "rm") return await remove(client, workspace, name);
  return await show(client, workspace, name);
}

async function list(client, workspace) {
  const rows = asArray((await client.environments()).data);
  console.log(`Environments on workspace ${workspace} (${rows.length}):`);
  for (const row of rows) {
    const branch = row.git_branch ? `  branch=${row.git_branch}` : "";
    const deployed = row.deployment_id ? `  deployment=#${row.deployment_id}` : "  (nothing pushed)";
    const knowledge = row.knowledge_changes_count ? `  knowledge_changes=${row.knowledge_changes_count}` : "";
    const active = row.last_activity_at ? `  last_activity=${row.last_activity_at}` : "";
    console.log(`  ${row.name}${branch}${deployed}${knowledge}${active}`);
  }
}

async function show(client, workspace, name) {
  let row;
  try {
    row = await client.environment(name);
  } catch (error) {
    if (error?.status !== 404) throw error;
    console.log(`${name} on workspace ${workspace} does not exist yet — \`vatio push\` creates it.`);
    return;
  }

  console.log(`${row.name} on workspace ${workspace}`);
  if (row.git_branch) console.log(`  branch: ${row.git_branch}`);
  console.log(row.deployment_id
    ? `  deployment: #${row.deployment_id}${row.git_sha ? ` (${row.git_sha.slice(0, 7)})` : ""}`
    : "  deployment: none yet — `vatio push`");
  if (row.share_url) console.log(`  try it: ${row.share_url}`);
  if (row.page_url) console.log(`  page with the bubble: ${row.page_url}`);
  if (row.knowledge_url) console.log(`  knowledge diff: ${row.knowledge_url}`);

  if (row.token) {
    console.log(`  publishable token: ${row.token}`);
    console.log("\n  widget:");
    console.log(`    <script src="${row.widget_script_url}"`);
    console.log(`            data-workspace="${workspace}"`);
    console.log(`            data-token="${row.token}"></script>`);
    console.log("\n  SDK: new VatioChat({ workspace, token }) with the token above talks to this environment.");
  }

  const changes = asArray(row.knowledge_changes);
  if (changes.length > 0) {
    console.log(`\n  knowledge changes live does not have (${changes.length}):`);
    for (const change of changes) {
      const conflict = change.conflict ? "  CONFLICT: live changed it after you did" : "";
      console.log(`    ${change.change.padEnd(8)} ${change.base}/${change.name}  v${change.version}${conflict}`);
    }
  }

  const secrets = asArray(row.secrets);
  if (secrets.length > 0) console.log(`\n  secrets with their own value here: ${secrets.join(", ")}`);
}

async function remove(client, workspace, name) {
  if (!name || name === "live") fail("usage: vatio env rm NAME   (live cannot be removed)");

  const result = await client.deleteEnvironment(name);
  console.log(`Removed ${name} from workspace ${workspace} (${result.agents ?? 0} agents, ${result.chats ?? 0} chats)`);
  console.log("Its unpublished knowledge changes and secret values went with it.");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
