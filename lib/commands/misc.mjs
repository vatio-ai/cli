// version / doctor / config / init.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { KEYS, SLUG_FORMAT } from "../config.mjs";
import { MANIFEST_FILE, manifestPath } from "../workspace.mjs";
import { VERSION } from "../version.mjs";
import { fail, takeValue } from "../support.mjs";
import { workspacesClient } from "./deploy.mjs";

export const DOCS_URL = "https://vatio.ai/docs";

export function version() {
  console.log(`Vatio CLI ${VERSION} (node)`);
  console.log(`Node ${process.version} (${process.platform}-${process.arch})`);
}

// What to read when a command fails for a reason that does not look like the
// workspace itself.
export async function doctor(config) {
  version();
  console.log(`CLI executable: ${process.argv[1]}`);
  console.log(`Node executable: ${process.execPath}`);
  console.log(`Base URL: ${config.resolveBaseUrl()}`);
  console.log(
    `Config: ${config.configPath}${existsSync(config.configPath) ? "" : " (missing — run `vatio login`)"}`
  );
  console.log(`Workspace root: ${config.workspaceRoot ?? "(none — no vatio.yml at or above the cwd)"}`);
  const manifest = config.manifestPath();
  if (manifest) console.log(`Manifest: ${manifest}`);
  let slug = null;
  try {
    slug = config.resolveWorkspace();
  } catch (error) {
    console.log(`Workspace: unreadable — ${error.message}`);
  }
  if (slug) console.log(`Workspace: ${slug}`);
  const token = config.resolveToken();
  console.log(`Token: ${token ? "configured" : "missing — run `vatio login`"}`);
  if (token) console.log(`Account: ${await accountLine(config)}`);
  console.log(`Docs: ${DOCS_URL}`);
}

// Which account the token is, and the workspaces it reaches. A developer can
// hold several accounts -- an email, a Google and a GitHub sign-in are separate
// unless they share the address -- and a workspace belongs to one of them, so
// `workspace_forbidden` is often just the wrong one signed in here.
export async function whoami(config) {
  const payload = await workspacesClient(config).listWorkspaces();
  const email = payload?.account?.email;
  console.log(email ? `Signed in as ${email}` : "Signed in (this Vatio does not say as whom)");
  console.log(`Base URL: ${config.resolveBaseUrl()}`);
  const slugs = (Array.isArray(payload?.workspaces) ? payload.workspaces : []).map((workspace) => workspace.slug);
  console.log(slugs.length > 0 ? `Workspaces: ${slugs.join(", ")}` : "Workspaces: none yet");
  let slug = null;
  try {
    slug = config.resolveWorkspace();
  } catch {
    slug = null;
  }
  if (slug && !slugs.includes(slug)) {
    console.log("");
    console.log(`This directory's workspace, ${slug}, is not one of them: it does not exist yet (\`vatio push\` ` +
      "creates it) or belongs to another account (`vatio login` with that account's email or sign-in).");
  }
}

// doctor's one line about the account. Never fails: doctor is what gets run
// when other commands do.
async function accountLine(config) {
  try {
    const payload = await workspacesClient(config).listWorkspaces();
    return payload?.account?.email ?? "signed in (this Vatio does not say as whom)";
  } catch (error) {
    return `unknown — ${String(error?.message ?? error).split("\n")[0]}`;
  }
}

export function configCommand(config, args) {
  const sub = args.shift();

  if (sub === "show" || sub === undefined) {
    const shown = config.displayHash();
    if (Object.keys(shown).length === 0) {
      console.log(`No config in ${config.configPath}`);
      return;
    }
    for (const [key, value] of Object.entries(shown)) console.log(`${key}=${value}`);
    return;
  }
  if (sub === "get") {
    const value = config.get(requireArg(args, "config get KEY"));
    if (value) console.log(value);
    return;
  }
  if (sub === "set") {
    const key = requireArg(args, "config set KEY VALUE");
    const value = requireArg(args, "config set KEY VALUE");
    config.set(key, value);
    console.log(`Set ${key}`);
    return;
  }
  if (sub === "unset") {
    const key = requireArg(args, "config unset KEY");
    config.unset(key);
    console.log(`Unset ${key}`);
    return;
  }

  fail(`Unknown config command: ${sub}\n\nKeys: ${KEYS.join(", ")}`);
}

// `vatio init` writes the one file that makes a directory a workspace, and
// names the remote it deploys to. Nothing constrains where that directory is --
// the point of the file is that an agent can live inside the repository of the
// backend it calls, not in a separate folder of agents.
export async function init(config, args) {
  // Still accepted and still ignored here -- `vatio login` owns --base-url,
  // and swallowing it keeps it out of the slug below.
  takeValue(args, "--base-url");
  const name = takeValue(args, "--name");

  const target = process.cwd();
  const existing = manifestPath(target);
  if (existing) fail(`Already a workspace: ${existing}`);

  // A workspace inside a workspace would shadow the outer one for every command
  // run below it, and no deploy would ever include it.
  if (config.workspaceRoot) {
    fail(`${target} is already inside the workspace at ${config.workspaceRoot}.\nRun \`vatio init\` somewhere outside it.`);
  }

  let slug = String(args.shift() ?? "").trim().toLowerCase();
  if (slug === "") slug = config.suggestedSlug();
  if (!SLUG_FORMAT.test(slug)) {
    fail(`Invalid slug "${slug}" (use lowercase letters, numbers, hyphens)`);
  }

  // No login here: identity is what `push` needs, because `push` is the first
  // thing that makes something run on a server. This writes a file.
  const authorized = Boolean(config.resolveToken());
  if (authorized) {
    const clients = workspacesClient(config);
    if (!(await clients.workspaceExists(slug))) await clients.createWorkspace({ slug, name });
  }

  const manifest = join(target, MANIFEST_FILE);
  writeFileSync(manifest, starterManifest(slug));

  console.log(`Wrote ${manifest}`);
  const agentsNote = writeAgentsNote(target);
  if (agentsNote) console.log(agentsNote);
  if (!authorized) console.log(`Local only for now — \`vatio push\` is what creates ${slug} on the platform.`);
  if (!authorized && String(name ?? "").trim() !== "") {
    console.log("Set the display name once it exists: `vatio business set --name NAME`, or in the inbox under Channels → Web widget.");
  }
  console.log("");
  console.log("Next:");
  console.log(`  edit ${MANIFEST_FILE}, then \`vatio push\` and \`vatio publish\``);
  console.log(`  docs: ${DOCS_URL}`);
}

// A pointer, not a copy of the docs: whatever coding agent works in this
// directory reads AGENTS.md, and these lines are how it learns that `vatio
// docs` is the contract and `vatio flags` is where fixing the agent starts.
// The instructions themselves come from the platform at run time, so nothing
// written here goes stale. An AGENTS.md that already mentions Vatio is left
// alone; any other gets the section appended.
const AGENTS_NOTE = [
  "## Vatio",
  "",
  "This directory is a Vatio workspace (`vatio.yml`). `vatio docs` prints the",
  "contract for the manifest, tools, knowledge and the CLI; read it before",
  "changing anything here.",
  "",
  "To fix what supervisors reported in the inbox, take every open report in",
  "one session: `vatio flags` (follow the instructions at the top of its",
  "output), fix, `vatio push`, `vatio test` until the reports pass, then",
  "`vatio publish`. The `vatio-improve` skill walks through it.",
  "`vatio tools --env live` shows how each tool's backend has been answering:",
  "error rate, timeouts, latency and the calls that failed.",
  ""
].join("\n");

function writeAgentsNote(target) {
  const path = join(target, "AGENTS.md");
  if (!existsSync(path)) {
    writeFileSync(path, `# Agents\n\n${AGENTS_NOTE}`);
    return `Wrote ${path}`;
  }

  const current = readFileSync(path, "utf8");
  if (/vatio/i.test(current)) return null;

  writeFileSync(path, `${current.replace(/\n*$/, "\n\n")}${AGENTS_NOTE}`);
  return `Added a Vatio section to ${path}`;
}

// The smallest file that deploys: which workspace, and what the agent does.
// The slug is already validated as a slug, so it needs no quoting. The display
// name is not here: it is the business name, set with `vatio business set --name`
// or in the inbox under Channels → Web widget.
function starterManifest(slug) {
  const lines = ["# Which Vatio workspace this directory deploys to.", `workspace: ${slug}`, ""];
  lines.push("agent:");
  lines.push("  instructions: |");
  lines.push("    Describe what this agent does and how it should answer.");
  lines.push("");
  return lines.join("\n");
}

function requireArg(args, usage) {
  const value = args.shift();
  if (value === undefined) fail(`Usage: vatio ${usage}`);
  return value;
}
