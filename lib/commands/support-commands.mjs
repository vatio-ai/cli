// docs / issue — the two commands that are about Vatio rather than about a
// deployment.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildBundle } from "../bundle.mjs";
import { HttpClient } from "../http.mjs";
import { VERSION } from "../version.mjs";
import { fail, takeFlag, takeValue } from "../support.mjs";
import { findWorkspaceRoot } from "../workspace.mjs";
import { DOCS_URL } from "./misc.mjs";

// The whole developer contract as markdown, live from the platform. Fetched
// rather than bundled: the docs describe the deploy you are talking to, and a
// copy shipped inside this package would start lying the day either moves.
export async function docs(config, args) {
  const save = takeFlag(args, "--save");
  const savePath = takeValue(args, "--save-to") ?? (save ? args.shift() ?? null : null);

  const baseUrl = config.resolveBaseUrl();
  let markdown;
  try {
    const response = await fetch(`${baseUrl}/docs.md`, {
      headers: { Accept: "text/markdown, text/plain" },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    markdown = await response.text();
  } catch (error) {
    fail(`Could not fetch the docs: ${error.message}\nRead them at ${DOCS_URL} instead.`);
  }

  if (!save) {
    process.stdout.write(markdown);
    return;
  }

  const target = resolve(savePath ?? "vatio-docs.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`Wrote ${target} (${markdown.split("\n").length} lines, from ${baseUrl})`);
  console.log("Point your coding agent at it, and re-run `vatio docs --save` to refresh.");
}

function issuesClient(config) {
  const token = config.resolveToken();
  if (!token) fail(`Run \`vatio login\` first (no token in ${config.configPath})`);
  return new HttpClient({ baseUrl: config.resolveBaseUrl(), token });
}

// `vatio issue` is a change worth making, written against a template the
// platform also validates against. It is not an issue tracker: there are no
// states, labels, assignees or backlog, and that is on purpose.
//
// Sent from a workspace, it carries the workspace -- see workspaceSource
// below, and `--no-source` to send the sentence alone.
export async function issue(config, args) {
  const sub = args[0];
  if (sub === "list") return await issueList(config);
  if (sub === "show") return await issueShow(config, args[1]);
  if (sub === "comment") return await issueComment(config, args[1], args.slice(2));

  if (takeFlag(args, "--template")) return await issueTemplate(config);

  const withoutSource = takeFlag(args, "--no-source");
  const file = takeValue(args, "--file");
  const workspace = takeValue(args, "--workspace") ?? safeWorkspace(config);

  // Before anything is composed: nothing is more annoying than writing one of
  // these and only then being told to log in.
  const client = issuesClient(config);

  const body = { cli_version: VERSION };
  if (workspace) body.workspace = workspace;

  const source = withoutSource ? null : workspaceSource();
  if (source?.files) {
    body.files = source.files;
    console.log(`Attaching ${source.root} — ${source.files.length} files, the same ones \`vatio push\` sends.`);
  } else if (source?.error) {
    console.log(`Not attaching your workspace: ${source.error}`);
  }
  if (file) {
    body.markdown = readFileSync(file, "utf8");
  } else {
    const message = args.join(" ").trim();
    if (message === "") {
      fail(
        "Usage: vatio issue \"what should change\"\n" +
          "       vatio issue --file ISSUE.md\n" +
          "       vatio issue --template    # the shape it is read against\n" +
          "       vatio issue --no-source   # without your workspace attached"
      );
    }
    body.message = message;
  }

  const payload = await client.post("/cli/issues", body);
  console.log(`Sent issue ${payload.id}.`);
  if (payload.url) console.log(`  ${payload.url}`);
  console.log("A person reads it and answers by email; `vatio issue list` shows the thread.");
}

async function issueTemplate(config) {
  const response = await fetch(`${config.resolveBaseUrl()}/cli/issue_template`, {
    headers: { Accept: "text/markdown, text/plain" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) fail(`Could not fetch the template (HTTP ${response.status})`);
  process.stdout.write(await response.text());
}

// Where a report stands, in the words the developer is actually asking in:
// has anyone looked at it, and is the ball with them or with us. There is no
// `status` field to print -- an issue has no states -- so this reads the few
// facts the platform does publish about the thread.
function issueStatus(row) {
  if (row.resolved) return "closed";
  // The developer wrote last and nothing has gone back yet.
  if (row.awaiting_us) return "with us";
  if (row.answered) return "answered";
  if (row.answers > 0) return "in progress";
  return "sent";
}

async function issueList(config) {
  // `data`, the same envelope every other read in this CLI unwraps. Reading
  // `issues` here is how `list` spent its whole life reporting that a
  // developer had sent nothing while `show` returned those same issues by id.
  const payload = await issuesClient(config).get("/cli/issues");
  const issues = Array.isArray(payload.data) ? payload.data : [];
  if (issues.length === 0) {
    console.log("You have not sent any issues yet.");
    console.log('  Send one: vatio issue "what should change"');
    return;
  }
  console.log(`Your issues (${issues.length}):`);
  const idWidth = Math.max(...issues.map((row) => String(row.id).length));
  const statusWidth = Math.max(...issues.map((row) => issueStatus(row).length));
  // The pull request goes under the title it belongs to, so the id and status
  // columns stay readable as columns.
  const indent = " ".repeat(2 + idWidth + 3 + statusWidth + 2);
  for (const row of issues) {
    const id = `[${String(row.id).padStart(idWidth)}]`;
    console.log(`  ${id} ${issueStatus(row).padEnd(statusWidth)}  ${row.title ?? ""}`.trimEnd());
    if (row.pull_request_url) console.log(`${indent}${row.pull_request_url}`);
  }
  console.log("Read one, conversation included: vatio issue show ID");
}

// The markdown view, which is the same document Vatio's own triage agent
// reads -- the whole conversation included, so a coding agent can pick the
// thread up where a person left it.
async function issueShow(config, id) {
  if (!id) fail("Usage: vatio issue show ID");

  const response = await fetch(`${config.resolveBaseUrl()}/cli/issues/${encodeURIComponent(id)}.md`, {
    headers: {
      Accept: "text/markdown, text/plain",
      Authorization: `Bearer ${config.resolveToken() ?? ""}`
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) fail(`Could not read issue ${id} (HTTP ${response.status})`);
  process.stdout.write(await response.text());
}

async function issueComment(config, id, rest) {
  if (!id) fail("Usage: vatio issue comment ID \"your reply\"");
  const body = rest.join(" ").trim();
  if (body === "") fail("Usage: vatio issue comment ID \"your reply\"");

  await issuesClient(config).post(`/cli/issues/${encodeURIComponent(id)}/comments`, { body });
  console.log(`Replied on issue ${id}.`);
}

// The directory the issue was typed in, sent whole -- the same bundle `check`
// and `push` send, because which files matter is the platform's contract and
// this client does not get a second answer to it.
//
// Nothing here can stop an issue from being sent: a directory that is not a
// workspace, or one too large to bundle, travels without its source. The call
// site says so out loud, since a developer is entitled to know what left their
// machine, and `--no-source` declines in advance.
function workspaceSource() {
  try {
    const root = findWorkspaceRoot(process.cwd());
    if (!root) return null;
    return { root, files: buildBundle(root) };
  } catch (error) {
    return { error: error.message };
  }
}

// A workspace is useful context on an issue but never required: `vatio issue`
// has to work from anywhere, including a directory that is not a workspace.
function safeWorkspace(config) {
  try {
    return config.resolveWorkspace();
  } catch {
    return null;
  }
}
