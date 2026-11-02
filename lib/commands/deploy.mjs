// push / pull / publish (a notice now) / rollback / status / diff.
//
// Every one of them is HTTP. The workspace is parsed by the platform
// (POST /deploy/check), so what is left here is: read the directory, send it,
// print what came back.
//
// `pull` is the exception, the one command that writes over the developer's
// own files. It is back because the files stopped being the only writer: from
// the Vatio MCP, in Claude or ChatGPT, people edit the agent itself, and each
// edit is a deployment of its own. What it writes is narrow
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
import { ConflictError, NotFoundError } from "../http.mjs";
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

  return new ApiClient({ baseUrl: `${base}/api/v1/${workspace}`, token });
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

// A block vatio.yml still declares and the platform no longer reads. Among the
// other warnings it read as one more, and a developer took `allowed_origins:`
// under `widget:` as applied: said apart, as what it is.
const IGNORED_BLOCK = /^vatio\.yml: `[^`]+` is ignored/;

// Returns the ignored-block lines it held back, for a caller that prints them
// last (`vatio push`); otherwise they follow the other warnings. Each line is
// printed once per command: `seen` carries what was already said, for a
// command that gets warnings from more than one response.
export function printDiagnostics(payload, { holdIgnored = false, seen = new Set() } = {}) {
  for (const line of unseen(asArray(payload.errors).map(diagnosticLine), seen)) console.error(`error: ${line}`);
  const ignored = [];
  for (const line of unseen(asArray(payload.warnings).map(diagnosticLine), seen)) {
    if (IGNORED_BLOCK.test(line)) ignored.push(line);
    else console.error(`warning: ${line}`);
  }
  if (!holdIgnored) printIgnored(ignored);
  return ignored;
}

function unseen(lines, seen) {
  return lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function printIgnored(lines) {
  if (lines.length === 0) return;
  const one = lines.length === 1;
  console.error("");
  console.error(
    `Not applied: vatio.yml declares ${one ? "a block" : `${lines.length} blocks`} Vatio does not read, ` +
      `and nothing in ${one ? "it" : "them"} takes effect:`
  );
  for (const line of lines) console.error(`  ${line}`);
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
  // Overwrites edits made outside the files (from the MCP or the inbox),
  // which the platform otherwise refuses (preview_edited_outside).
  const force = takeFlag(args, "--force");
  const workspace = config.resolveWorkspaceRequired();

  await ensureAuthorized(config, { workspace });

  // The remote has to exist before the workspace can be checked: the slug is in
  // the URL of the call that checks it. It is created unnamed; the display name
  // is the business name (`vatio business set --name`, or the inbox's Channels
  // → Web widget), not part of a push.
  const clients = workspacesClient(config);
  const created = !(await clients.workspaceExists(workspace));
  if (created) {
    await clients.createWorkspace({ slug: workspace });
    console.log(`Created remote workspace ${workspace}`);
  }

  const check = await checkWorkspace(config, workspace, { environment });
  const seen = new Set();
  const ignored = printDiagnostics(check, { holdIgnored: true, seen });
  if (!check.ok) {
    printIgnored(ignored);
    fail(`push aborted: check failed (${asArray(check.errors).length} error(s))`);
  }

  const client = deployClient(config, workspace);
  const baseUrl = config.resolveBaseUrl();
  const root = config.workspaceRootRequired();
  const gitBranch = detectGitBranch(root);
  // Uncommitted changes under the workspace directory, which is what a push
  // sends: then git_sha alone does not say what was pushed.
  const changes = gitChanges(root, ["."]);
  let payload;
  try {
    payload = await client.pushPreview({
      manifest: check.manifest,
      gitSha: detectGitSha(root),
      gitBranch,
      gitDirty: changes === null ? null : changes.length > 0,
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

  console.log(`Pushed deployment #${payload.deployment_id} (git_sha=${JSON.stringify(payload.git_sha ?? null)})`);
  // Who has it now: everyone, or the team until its tests pass.
  for (const line of shippingLines(payload.shipping)) console.log(line);
  // Where to try it: the inbox's Try the agent panel for that environment.
  if (payload.share_url) console.log(`Try it: ${payload.share_url}`);
  // Mostly what the check already said: the platform loads the manifest again
  // to apply it.
  for (const warning of unseen(asArray(payload.warnings).map(diagnosticLine), seen)) {
    if (IGNORED_BLOCK.test(warning)) ignored.push(warning);
    else console.log(`  warning: ${warning}`);
  }

  const hint = payload.first_push_hint;
  if (hint) {
    console.log("");
    console.log(hint.message);
    console.log(`  ${hint.url}`);
  }
  printNotices(payload);
  printIgnored(ignored);
}

// Who has a change now, read off the platform's `shipping` (Vatio::Deploy::Ship):
// everyone, or the team until the tests that pass today pass on it.
function shippingLines(shipping) {
  // A platform older than this CLI sends none; its prose notices still
  // arrive and printNotices shows them.
  if (!shipping || typeof shipping !== "object") return [];
  if (shipping.reaches_everyone || shipping.state === "live") return ["→ Everyone has it now: your app, WhatsApp and Instagram answer with it."];

  const by = shipping.expected_by ? `, around ${clock(shipping.expected_by)}` : "";
  return [
    "→ Your team has it now (`vatio chat` talks to it). Everyone gets it once the tests",
    `  that pass today pass on it${by}. \`vatio status\` says where it stands.`
  ];
}

function clock(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Something the platform wants the developer to know about the command they
// just ran -- a deprecation, usually. On stderr so scripts reading stdout keep
// working.
//
// `shipping.supersedes` lists the ones shippingLines already said in fewer
// words; printing both would say it twice.
function printNotices(payload) {
  const superseded = new Set(asArray(payload.shipping?.supersedes ?? payload.outcome?.supersedes));
  for (const notice of asArray(payload.notices)) {
    if (superseded.has(notice)) continue;
    process.stderr.write(`\n${paint("yellow", `Notice: ${notice}`)}\n`);
  }
}

// Refused because the agent holds edits the files have never seen: which, and
// the two ways forward. The platform's message says all of it in one line,
// for releases that print only that; with the list to go by, this one says
// it a line per edit instead of repeating it.
function editedOutsideMessage(error) {
  const edits = asArray(error.body.edits);
  const count = edits.length === 1 ? "a change" : `${edits.length} changes`;
  const lines = edits.length === 0 ? [error.message] : [`Your agent has ${count} made outside your files that this push would overwrite:`];
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

// There is nothing to publish: a push reaches everyone on its own once its
// tests pass. Kept so scripts and habits that still run it learn why.
export async function publish(config, args) {
  takeEnv(args, { fallback: null });
  takeFlag(args, "--force");
  console.log("There is nothing to publish: every push reaches your team at once, and everyone once the tests");
  console.log("that pass today pass on it. `vatio status` says where the newest change stands.");
}

export async function rollback(config) {
  const workspace = config.resolveWorkspaceRequired();
  const payload = await deployClient(config, workspace).rollback({ createdBy: process.env.USER ?? null });
  console.log(`Everyone, your team included, is back on deployment #${payload.deployment_id} (from #${payload.rolled_back_from_id})`);
  printNotices(payload);
}

export async function status(config) {
  const workspace = config.resolveWorkspaceRequired();
  const payload = await deployClient(config, workspace).deployStatus();
  console.log(JSON.stringify(payload, null, 2));
  printWhatsappIssue(payload.whatsapp);

  // Where the newest change stands, without reading the JSON: everyone has it,
  // its tests are running, or one that passes today held it back.
  printShipping(payload.shipping);

  // A base with content that no deployed agent reads is knowledge the agent
  // cannot reach, and nothing else says so -- it just answers without it. On
  // stderr so piping `vatio status` into jq keeps working.
  for (const base of asArray(payload.unreferenced_knowledge_bases)) {
    console.error(
      `Warning: knowledge base "${base.name}" has ${base.entries_count} entries but no deployed agent ` +
        `reads it — add \`knowledge: [${base.name}]\` to vatio.yml and push.`
    );
  }
  // Edits from the Vatio MCP that the agent carries, no push has written over
  // and these files have not pulled: the next push is refused until they are.
  const base = config.baseDeploymentFor({ baseUrl: config.resolveBaseUrl(), workspace });
  const edits = asArray(payload.preview_edited_outside_push).filter(
    (edit) => base == null || Number(edit.deployment_id) > base
  );
  if (edits.length > 0) {
    console.error(`Your agent has ${edits.length === 1 ? "a change" : `${edits.length} changes`} made outside your files:`);
    for (const edit of edits) console.error(`  ${editLine(edit)}`);
    console.error("  `vatio pull` brings them into your files before your next push.");
  }
  printVatioSide(payload.vatio);
  printImpact(payload.impact);
}

// On stderr so piping `vatio status` into jq keeps working.
function printShipping(shipping) {
  if (!shipping || typeof shipping !== "object" || shipping.state === "live") return;

  const who = shipping.changed_by ? ` by ${shipping.changed_by}` : "";
  if (shipping.state === "testing") {
    const by = shipping.testing?.expected_by ? `, around ${clock(shipping.testing.expected_by)}` : "";
    console.error(`Your team has #${shipping.newest_version}${who}; everyone gets it once its tests pass${by}.`);
    return;
  }
  const held = shipping.held ?? {};
  console.error(`Held: your team has #${shipping.newest_version}${who}, and everyone else keeps #${shipping.version}.`);
  if (held.reason === "tests_capped") console.error("  Vatio could not test it: the workspace used up today's test runs.");
  else if (held.reason === "error") console.error(`  Vatio could not put it in place: ${held.message ?? "unknown error"}`);
  else {
    console.error("  These tests pass on the version everyone has and failed on it in every attempt:");
    for (const test of asArray(held.tests)) {
      const untested = test.vatio_error ? " (not tested: an error on Vatio's side)" : "";
      console.error(`    ${test.id} — ${test.title}${untested}`);
    }
  }
  console.error("  Another push that fixes it moves it on, or `vatio test rm ID` for a test it made obsolete.");
}

// A number that looks connected while Meta refuses every send from it: first
// on stderr, because every message the backend sends meanwhile is refused.
function printWhatsappIssue(whatsapp) {
  const issue = whatsapp?.issue;
  if (!issue) return;
  for (const line of whatsappIssueLines(`WhatsApp ${whatsapp.number ?? "number"}`, issue)) console.error(line);
}

// The number's issue as `vatio whatsapp` and `vatio status` say it, and as the
// inbox's WhatsApp page and the MCP's get_whatsapp do. Not registered is also
// where a number lands the moment it is first connected, so it reads as that
// step, and its fix already says what Meta said.
export function whatsappIssueLines(name, issue) {
  const until = "POST /messages answers 409 whatsapp_number_unhealthy and the agent's replies do not go out.";
  if (issue.kind === "not_registered") {
    return [
      `${name}: ${paint("red", "NOT REGISTERED on the WhatsApp Cloud API: register it so it can send")}`,
      `  Fix: ${issue.fix}`,
      "  Register it: vatio whatsapp check --pin PIN",
      `  Until then, ${until}`,
    ];
  }
  const code = issue.code ? ` (Meta ${issue.code})` : "";
  return [
    `${name}: ${paint("red", `NOT SENDING since ${issue.since}${code}`)}`,
    ...(issue.message ? [`  Meta: ${issue.message}`] : []),
    `  Fix: ${issue.fix}`,
    `  Until a check passes (vatio whatsapp check), ${until}`,
  ];
}

// What Vatio did for this workspace in the last 30 days, in one line a
// coding agent can repeat to the person: on stderr like the rest, and only
// when there is something to count.
function printImpact(impact) {
  if (!impact) return;
  const saved = impact.saved_replies ?? {};
  const parts = [];
  if (saved.total > 0) {
    parts.push(
      `Vatio saved ${saved.total} ${saved.total === 1 ? "reply" : "replies"} on live ` +
        `(${saved.corrected?.total ?? 0} corrected before sending, ${saved.recovered?.total ?? 0} recovered after an error, ` +
        `${saved.stopped?.total ?? 0} with a tool call stopped before your backend)`
    );
  }
  const hours = impact.after_hours ?? {};
  if (hours.after_hours > 0) parts.push(`${hours.after_hours} of ${hours.conversations} conversations came in after hours`);
  const asked = impact.asked_team ?? {};
  if (asked.questions > 0) parts.push(`the agent asked your team ${asked.questions} ${asked.questions === 1 ? "time" : "times"} instead of guessing`);
  if (impact.test_replays > 0) parts.push(`Vatio replayed ${impact.test_replays} test conversations`);
  const held = impact.regressions_held ?? {};
  if (held.count > 0) parts.push(`the tests held ${held.count} ${held.count === 1 ? "regression" : "regressions"} back from everyone`);
  const fixed = impact.reports_fixed ?? {};
  if (fixed.count > 0) {
    parts.push(`${fixed.count} ${fixed.count === 1 ? "report was" : "reports were"} fixed (median ${fixed.median_hours} h)`);
  }
  if (parts.length === 0) return;
  console.error(`Last 30 days: ${parts.join("; ")}. Details under "impact".`);
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
  // drifted".
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
