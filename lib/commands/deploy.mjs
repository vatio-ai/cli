// push / publish / rollback / status / diff.
//
// Every one of them is HTTP. The workspace is parsed by the platform
// (POST /deploy/check), so what is left here is: read the directory, send it,
// print what came back.
//
// `pull` is deliberately not here yet. It is the one command that writes over
// the developer's own files, and the Ruby version carries real subtlety doing
// it -- a comment where the logo would go, because a revision keeps the name
// and digest but never the bytes; `identity.pub` written back out; a specific
// key order in the file it emits. Porting that from memory is how you ship a
// command that quietly mangles a workspace, so it comes with a round-trip test
// (push, pull, diff clean) rather than with this.

import { stringify as stringifyYaml } from "yaml";

import { buildBundle, BundleError } from "../bundle.mjs";
import { ApiClient, CliClient } from "../api-client.mjs";
import { NotFoundError } from "../http.mjs";
import { deviceLogin } from "./auth.mjs";
import { branchEnvironment } from "../branch.mjs";
import { detectGitSha, fail, paint, takeEnv, takeFlag, takeValue } from "../support.mjs";

// The first command that makes something exist on a server, so the first one
// that needs to know whose it is.
export async function ensureAuthorized(config, { workspace = null, message = "Before I can push this, I need to know whose it is." } = {}) {
  if (config.resolveToken()) return;

  const auth = await deviceLogin({ config, workspace, message });
  config.writeAuth({ baseUrl: auth.baseUrl, token: auth.token });
  console.log(`Token saved to ${config.configPath}`);
  console.log("");
}

export function deployClient(config, workspace) {
  const base = config.resolveBaseUrl();
  if (!base) fail("VATIO_BASE_URL is required (env or `vatio config set base_url …`)");
  const token = config.resolveToken();
  if (!token) fail("VATIO_TOKEN is required (env or `vatio login`)");

  return new ApiClient({ baseUrl: `${base}/api/developer/v1/${workspace}`, token });
}

export function workspacesClient(config) {
  const token = config.resolveToken();
  if (!token) fail(`Run \`vatio login\` first (no token in ${config.configPath})`);
  return new CliClient({ baseUrl: config.resolveBaseUrl(), token });
}

// One call answers every local question about a workspace: whether it loads,
// what manifest it builds, and what it would change. The parse behind it is the
// platform's, which is the point -- a CLI that parsed the directory itself
// could only ever be as current as the release the developer happened to
// install.
export async function checkWorkspace(config, workspace, { environment = null } = {}) {
  const root = config.workspaceRootRequired();
  let files;
  try {
    files = buildBundle(root);
  } catch (error) {
    if (error instanceof BundleError) fail(`vatio: ${error.message}`);
    throw error;
  }
  return deployClient(config, workspace).check({ files, environment });
}

export function printDiagnostics(payload) {
  for (const row of asArray(payload.errors)) console.error(`error: ${diagnosticLine(row)}`);
  for (const row of asArray(payload.warnings)) console.error(`warning: ${diagnosticLine(row)}`);
}

// A diagnostic is { message, path } -- `path` is the file it is about, or null
// for the workspace as a whole. Most messages already open with their own path,
// which is where the platform read it from, so only prepend it when it is
// missing rather than printing `tools/x.js: tools/x.js: …`.
function diagnosticLine(row) {
  if (!row || typeof row !== "object") return String(row);

  const message = String(row.message ?? "");
  const path = String(row.path ?? "");
  if (path === "" || message.startsWith(`${path}:`)) return message;
  return `${path}: ${message}`;
}

export async function push(config, args) {
  // Null, not "preview": the platform owns that default, and sending it
  // explicitly would make a bare `vatio push` and `vatio push --env preview`
  // two different requests that only happen to agree today. On a branch, the
  // branch's own environment.
  const environment = takeEnv(args, { fallback: null, cwd: config.workspaceRoot });
  const workspace = config.resolveWorkspaceRequired();

  await ensureAuthorized(config, { workspace });

  // The remote has to exist before the workspace can be checked: the slug is in
  // the URL of the call that checks it. It is created unnamed; the display name
  // is a workspace setting edited in the console, not part of a push.
  const clients = workspacesClient(config);
  const created = !(await clients.workspaceExists(workspace));
  if (created) {
    await clients.createWorkspace({ slug: workspace });
    console.log(`Created remote workspace ${workspace}`);
  }

  const check = await checkWorkspace(config, workspace, { environment });
  printDiagnostics(check);
  if (!check.ok) fail(`push aborted: check failed (${asArray(check.errors).length} error(s))`);

  const client = deployClient(config, workspace);
  const payload = await client.pushPreview({
    manifest: check.manifest,
    gitSha: detectGitSha(config.workspaceRootRequired()),
    gitBranch: branchEnvironment(config.workspaceRootRequired())?.branch ?? null,
    createdBy: process.env.USER ?? null,
    environment
  });

  const landedOn = payload.environment ?? "preview";
  console.log(`Pushed deployment #${payload.deployment_id} to ${landedOn} (git_sha=${JSON.stringify(payload.git_sha ?? null)})`);
  // Where to try it: the console's test screen for that environment.
  if (payload.share_url) console.log(`Try it: ${payload.share_url}`);
  for (const warning of asArray(payload.warnings)) console.log(`  warning: ${warning}`);
  if (payload.preview_url) console.log(`Preview: ${payload.preview_url}`);

  const hint = payload.first_push_hint;
  if (hint) {
    console.log("");
    console.log(hint.message);
    console.log(`  ${hint.url}`);
  }
  printNotices(payload);
}

// Something the platform wants the developer to know about the command they
// just ran -- a deprecation, usually. On stderr so scripts reading stdout keep
// working.
function printNotices(payload) {
  for (const notice of asArray(payload.notices)) {
    process.stderr.write(`\n${paint("yellow", `Notice: ${notice}`)}\n`);
  }
}

export async function publish(config, args) {
  // Here `--env` names the environment being promoted, not a destination: the
  // destination of a publish is always live. On a branch it is the branch's;
  // otherwise the platform promotes the most recent push, whichever preview it
  // landed on. Its knowledge changes go live with it.
  const environment = takeEnv(args, { fallback: null, cwd: config.workspaceRoot });
  const workspace = config.resolveWorkspaceRequired();
  const payload = await deployClient(config, workspace).publish({
    createdBy: process.env.USER ?? null,
    environment
  });
  const from = asArray(payload.published_from);
  const source = from.length > 0 ? ` from ${from.join(", ")}` : "";
  console.log(`Published live deployment #${payload.deployment_id}${source} (git_sha=${JSON.stringify(payload.git_sha ?? null)})`);
  const knowledge = asArray(payload.knowledge);
  if (knowledge.length > 0) console.log(`Knowledge now live: ${knowledge.join(", ")}`);
  printNotices(payload);
}

export async function rollback(config) {
  const workspace = config.resolveWorkspaceRequired();
  const payload = await deployClient(config, workspace).rollback({ createdBy: process.env.USER ?? null });
  console.log(`Rolled back to deployment #${payload.deployment_id} (from #${payload.rolled_back_from_id})`);
  printNotices(payload);
}

export async function status(config) {
  const workspace = config.resolveWorkspaceRequired();
  const payload = await deployClient(config, workspace).deployStatus();
  console.log(JSON.stringify(payload, null, 2));

  // A base with content that no deployed agent reads is knowledge the agent
  // cannot reach, and nothing else says so -- it just answers without it. On
  // stderr so piping `vatio status` into jq keeps working.
  for (const base of asArray(payload.unreferenced_knowledge_bases)) {
    console.error(
      `Warning: knowledge base "${base.name}" has ${base.entries_count} entries but no deployed agent ` +
        `reads it — add \`knowledge: [${base.name}]\` to vatio.yml and push.`
    );
  }
}

export async function diff(config, args) {
  const environment = takeEnv(args, { fallback: "preview", cwd: config.workspaceRoot });
  const full = takeFlag(args, "--full");
  const stat = takeFlag(args, "--stat");
  const nameOnly = takeFlag(args, "--name-only");
  const format = takeValue(args, "--format");
  if (format && !["text", "json"].includes(format)) fail(`Unknown format ${JSON.stringify(format)} (text|json)`);

  const workspace = config.resolveWorkspaceRequired();
  // The diff comes back with the check -- one call instead of "parse here,
  // fetch there, compare with a copy of the platform's rules that may have
  // drifted". `--env live` is what answers "what would publishing change?"
  const payload = await checkWorkspace(config, workspace, { environment });
  printDiagnostics(payload);
  if (!payload.ok) fail(`diff aborted: the workspace does not load (${asArray(payload.errors).length} error(s))`);

  const local = payload.manifest;
  const changes = asArray(payload.diff);

  if (changes.length === 0) {
    console.log(`No diff vs remote ${environment}`);
    return;
  }
  if (full) {
    console.error("Warning: --full prints complete tool source. Avoid using it in shared CI logs.");
    let remote = {};
    try {
      remote = (await deployClient(config, workspace).deployedManifest({ environment })).manifest ?? {};
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    console.log("=== local ===");
    console.log(stringifyYaml(local));
    console.log(`=== remote ${environment} ===`);
    console.log(stringifyYaml(remote));
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify({ workspace, changes }, null, 2));
    return;
  }
  if (stat) {
    const counts = new Map();
    for (const change of changes) counts.set(change.status, (counts.get(change.status) ?? 0) + 1);
    const summary = [...counts].map(([status, count]) => `${count} ${status}`).join(", ");
    console.log(`${changes.length} change(s): ${summary}`);
    return;
  }
  if (nameOnly) {
    for (const change of changes) console.log(diffLabel(change));
    return;
  }

  for (const change of changes) {
    const fields = asArray(change.fields);
    const suffix = fields.length === 0 ? "" : ` (${fields.join(", ")})`;
    console.log(`${statusLetter(change.status)} ${diffLabel(change)}${suffix}`);
  }
  console.log("Use `vatio diff --full` to print complete tool source.");
}

function diffLabel(change) {
  return change.type === change.key ? change.type : `${change.type}/${change.key}`;
}

function statusLetter(status) {
  return { added: "A", removed: "D", modified: "M" }[status] ?? "?";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
