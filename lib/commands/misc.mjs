// version / doctor / config / init.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { KEYS, SLUG_FORMAT } from "../config.mjs";
import { MANIFEST_FILE, manifestPath } from "../workspace.mjs";
import { VERSION } from "../version.mjs";
import { fail, takeValue } from "../support.mjs";
import { workspacesClient } from "./deploy.mjs";

export const DOCS_URL = "https://docs.vatio.ai";

export function version() {
  console.log(`Vatio CLI ${VERSION} (node)`);
  console.log(`Node ${process.version} (${process.platform}-${process.arch})`);
}

// What to read when a command fails for a reason that does not look like the
// workspace itself.
export function doctor(config) {
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
  console.log(`Token: ${config.resolveToken() ? "configured" : "missing — run `vatio login`"}`);
  console.log(`Docs: ${DOCS_URL}`);
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
  if (!authorized) console.log(`Local only for now — \`vatio push\` is what creates ${slug} on the platform.`);
  if (!authorized && String(name ?? "").trim() !== "") {
    console.log("The display name is set in the console (the workspace's Brand page) once it exists.");
  }
  console.log("");
  console.log("Next:");
  console.log(`  edit ${MANIFEST_FILE}, then \`vatio push\` and \`vatio publish\``);
  console.log(`  docs: ${DOCS_URL}`);
}

// The smallest file that deploys: which workspace, and what the agent does.
// The slug is already validated as a slug, so it needs no quoting. The display
// name is not here: it is a workspace setting, edited in the console.
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
