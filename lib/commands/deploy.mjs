// push / pull / publish / rollback / status / diff.
//
// Every one of them is HTTP. The workspace is parsed by the platform
// (POST /deploy/check), so what is left here is: read the directory, send it,
// print what came back.
//
// `pull` is the exception, the one command that writes over the developer's
// own files. It is back because the files stopped being the only writer: from
// the Vatio MCP, in Claude or ChatGPT, people edit the agent itself, and each
// edit lands in preview as a deployment of its own. What it writes is narrow
// on purpose (lib/pull.mjs): each tools/KEY.yml exactly as the platform holds
// it, and only the `agent:` block of the vatio.yml already on disk, key by
// key, because a revision keeps neither that file's comments nor `auth:` the
// way the file spells it. And it wants a clean git tree, so that git, not this
// CLI, is what gives back whatever it replaced.
//
// The two directions meet in the base deployment: the one the files were last
// made to match, by a push or a pull, kept in the config file. A push sends
// it, so the platform can refuse to overwrite edits the files have never seen.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { stringify as stringifyYaml } from "yaml";

import { buildBundle, BundleError } from "../bundle.mjs";
import { ApiClient, CliClient } from "../api-client.mjs";
import { ConflictError, NotFoundError, UnprocessableError } from "../http.mjs";
import { MANIFEST_FILE } from "../workspace.mjs";
import { PullError, planPull } from "../pull.mjs";
import { deviceLogin } from "./auth.mjs";
import { detectGitBranch, detectGitSha, fail, gitChanges, paint, takeEnv, takeFlag, takeValue } from "../support.mjs";

// The first command that makes something exist on a server, so the first one
// that needs to know whose it is.
export async function ensureAuthorized(config, { workspace = null, message = "Before I can push this, I need to know whose it is." } = {}) {
  if (config.resolveToken()) return;

  const auth = await deviceLogin({ config, workspace, message });
  config.writeAuth({ baseUrl: auth.baseUrl, token: auth.token });
  if (auth.email) console.log(`Signed in as ${auth.email}`);
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
  // two different requests that only happen to agree today.
  const environment = takeEnv(args, { fallback: null });
  // Replaces an unpublished push from another branch, or edits made outside
  // the files, which the platform otherwise refuses
  // (preview_has_unpublished_push, preview_edited_outside).
  const force = takeFlag(args, "--force");
  const workspace = config.resolveWorkspaceRequired();

  await ensureAuthorized(config, { workspace });

  // The remote has to exist before the workspace can be checked: the slug is in
  // the URL of the call that checks it. It is created unnamed; the display name
  // is the business name (`vatio business set --name`, or the inbox's Business
  // page), not part of a push.
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
  const baseUrl = config.resolveBaseUrl();
  let payload;
  try {
    payload = await client.pushPreview({
      manifest: check.manifest,
      gitSha: detectGitSha(config.workspaceRootRequired()),
      gitBranch: detectGitBranch(config.workspaceRootRequired()),
      createdBy: process.env.USER ?? null,
      environment,
      force,
      baseDeploymentId: config.baseDeploymentFor({ baseUrl, workspace })
    });
  } catch (error) {
    if (error instanceof ConflictError && error.errorKey === "preview_edited_outside") fail(editedOutsideMessage(error));
    throw error;
  }
  // What the files match now, so the next push is built on it.
  config.rememberBaseDeployment({ baseUrl, workspace, deploymentId: payload.deployment_id });

  const landedOn = payload.environment ?? "preview";
  console.log(`Pushed deployment #${payload.deployment_id} to ${landedOn} (git_sha=${JSON.stringify(payload.git_sha ?? null)})`);
  // Where to try it: the inbox's Test page for that environment.
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

// Refused because preview holds edits the files have never seen: which, and
// the two ways forward. The platform's message says all of it in one line,
// for releases that print only that; with the list to go by, this one says
// it a line per edit instead of repeating it.
function editedOutsideMessage(error) {
  const edits = asArray(error.body.edits);
  const count = edits.length === 1 ? "a change" : `${edits.length} changes`;
  const lines = edits.length === 0 ? [error.message] : [`Preview has ${count} made outside your files that this push would overwrite:`];
  for (const edit of edits) lines.push(`  ${editLine(edit)}`);
  const them = edits.length === 1 ? "it" : "them";
  lines.push(
    "",
    `Run \`vatio pull\` to bring ${them} into your files, review with \`git diff\`, and push again.`,
    `\`vatio push --force\` overwrites ${them} instead.`
  );
  return lines.join("\n");
}

// `#42 by ivan@x.cl via Claude, 2026-10-16T12:00:00Z: instructions, tool my_orders`
function editLine(edit) {
  const who = edit?.created_by ? ` by ${edit.created_by}` : "";
  const when = edit?.created_at ? `, ${edit.created_at}` : "";
  const what = edit?.summary ? `: ${edit.summary}` : "";
  return `#${edit?.deployment_id ?? "?"}${who}${when}${what}`;
}

// The deployed agent, back in the files: what an edit made from the Vatio MCP
// changed, so the next push carries it rather than undoing it. Preview by
// default, since that is where those edits land.
export async function pull(config, args) {
  const environment = takeEnv(args, { fallback: "preview" });
  // Writes even over uncommitted changes, or outside git.
  const force = takeFlag(args, "--force");
  if (args.length > 0) fail(`vatio pull: unexpected ${JSON.stringify(args[0])} (it takes --env NAME and --force)`);

  const workspace = config.resolveWorkspaceRequired();
  const root = config.workspaceRootRequired();
  const client = deployClient(config, workspace);
  if (!force) refuseUnkeptChanges(root);

  let payload;
  try {
    payload = await client.deployedManifest({ environment });
  } catch (error) {
    if (error instanceof NotFoundError) {
      fail(`Nothing to pull: ${workspace} has no ${environment} deployment yet. \`vatio push\` makes one from your files.`);
    }
    throw error;
  }

  let changes;
  try {
    changes = planPull(root, payload.manifest);
  } catch (error) {
    if (error instanceof PullError) fail(`vatio pull: ${error.message}`);
    throw error;
  }

  const deployment = `deployment #${payload.deployment_id} (${payload.environment ?? environment})`;
  const edits = asArray(payload.edited_outside_push);
  if (edits.length > 0) {
    console.log(`Edits made outside your files, in ${deployment}:`);
    for (const edit of edits) console.log(`  ${editLine(edit)}`);
    console.log("");
  }

  for (const change of changes) {
    const path = join(root, change.path);
    if (change.action === "deleted") {
      rmSync(path, { force: true });
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, change.content);
    }
    console.log(`${change.action} ${change.path}`);
  }
  config.rememberBaseDeployment({ baseUrl: config.resolveBaseUrl(), workspace, deploymentId: payload.deployment_id });

  if (changes.length === 0) {
    console.log(`Your files already match ${deployment}.`);
  } else {
    console.log(`Your files now match ${deployment}. Review with \`git diff\`, then \`vatio push\`.`);
  }
}

// Pull writes over vatio.yml and tools/, so what they hold now has to be
// somewhere it can come back from: committed to git.
function refuseUnkeptChanges(root) {
  const changed = gitChanges(root, [MANIFEST_FILE, "tools"]);
  if (changed === null) {
    fail(
      `vatio pull writes over ${MANIFEST_FILE} and tools/, and this workspace is not in a git repository,\n` +
        "so nothing could give you back what they hold now. Commit them to git first, or run\n" +
        "`vatio pull --force` to overwrite them anyway."
    );
  }
  if (changed.length > 0) {
    fail(
      [
        `vatio pull writes over ${MANIFEST_FILE} and tools/, and they have changes git has not kept:`,
        ...changed.map((line) => `  ${line}`),
        "",
        "Commit or stash them first, so git keeps what you had, or run `vatio pull --force` to overwrite them."
      ].join("\n")
    );
  }
}

export async function publish(config, args) {
  // Here `--env` names the environment being promoted, not a destination: the
  // destination of a publish is always live, and what goes there is preview,
  // with its knowledge changes.
  const environment = takeEnv(args, { fallback: null });
  // Publishes even when preview fails a report that live passes.
  const force = takeFlag(args, "--force");
  const workspace = config.resolveWorkspaceRequired();
  let payload;
  try {
    payload = await deployClient(config, workspace).publish({
      createdBy: process.env.USER ?? null,
      environment,
      force
    });
  } catch (error) {
    // evals_missing and evals_running already say what to run next; a
    // regression also needs to say which reports.
    if (error instanceof UnprocessableError && error.errorKey === "evals_regressed") fail(regressionsMessage(error));
    throw error;
  }
  const from = asArray(payload.published_from);
  const source = from.length > 0 ? ` from ${from.join(", ")}` : "";
  console.log(`Published live deployment #${payload.deployment_id}${source} (git_sha=${JSON.stringify(payload.git_sha ?? null)})`);
  const knowledge = asArray(payload.knowledge);
  if (knowledge.length > 0) console.log(`Knowledge now live: ${knowledge.join(", ")}`);
  printNotices(payload);
}

function regressionsMessage(error) {
  const rows = asArray(error.body.regressions);
  const lines = [error.message];
  for (const row of rows) {
    const untested = row.vatio_error ? " (not tested: an error on Vatio's side, not your agent)" : "";
    lines.push(`  ${row.id} — ${row.title}${untested}`);
  }
  const broken = rows.filter((row) => !row.vatio_error);
  lines.push(
    "",
    broken.length > 0
      ? "Fix them, then `vatio push` and `vatio test --wait` again before publishing."
      : "Run `vatio test --wait` again, then publish.",
    "`vatio publish --force` publishes anyway: only if you know what you're doing."
  );
  return lines.join("\n");
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
  // Edits from the Vatio MCP that preview carries, no push has written over
  // and these files have not pulled: the next push is refused until they are.
  const base = config.baseDeploymentFor({ baseUrl: config.resolveBaseUrl(), workspace });
  const edits = asArray(payload.preview_edited_outside_push).filter(
    (edit) => base == null || Number(edit.deployment_id) > base
  );
  if (edits.length > 0) {
    console.error(`Preview has ${edits.length === 1 ? "a change" : `${edits.length} changes`} made outside your files:`);
    for (const edit of edits) console.error(`  ${editLine(edit)}`);
    console.error("  `vatio pull` brings them into your files before your next push.");
  }
  printVatioSide(payload.vatio);
}

// Is it Vatio or is it me? The replies Vatio wrote here because the agent's
// turn produced none, split by whose they are to fix. Also on stderr, for the
// same reason as the warning above, and only when there is something to say:
// a line on every call would be noise to anything reading both.
function printVatioSide(vatio) {
  if (!vatio) return;
  const latest = asArray(vatio.fallback_replies?.latest);
  const byCause = vatio.fallback_replies?.by_cause ?? {};
  const total = Object.values(byCause).reduce((sum, count) => sum + Number(count), 0);
  if (total === 0) return;

  const counts = Object.entries(byCause)
    .map(([cause, count]) => `${cause} ${count}`)
    .join(", ");
  console.error(`Replies Vatio wrote because the agent's turn produced none, last 7 days: ${total} (${counts}).`);
  for (const reply of latest) {
    const whose = reply.owner === "vatio" ? "Vatio's side, not your agent" : "your agent";
    console.error(
      `  ${reply.at} ${reply.environment} — ${reply.reason} (${whose}): vatio chat show ${reply.chat_id}`
    );
  }
  if (latest.some((reply) => reply.owner === "vatio")) {
    console.error(
      '  Nothing to fix in your agent for those. If they keep happening, tell us: vatio feedback "…"'
    );
  }
}

export async function diff(config, args) {
  const environment = takeEnv(args, { fallback: "preview" });
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
