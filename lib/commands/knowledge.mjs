// `vatio kb` — knowledge bases.
//
// A base belongs to the workspace, not to a deployment: `knowledge:` in
// vatio.yml is a list of *names*, and a push neither fills nor empties one.
// That is why this is a command and not part of the manifest.
//
// The entries are live. Reads and writes here are as one environment sees
// them: `preview` by default, which keeps the entries it changed on top of
// live and answers from them; `--env live` writes live directly, the way a
// supervisor in the inbox does. `vatio publish` takes the changes live with
// the agent -- `vatio kb publish` takes them alone. So: write, try it on
// preview, publish.
//
// A base holds entries, and an entry is markdown you wrote.

import { readFileSync, statSync } from "node:fs";

import { deployClient } from "./deploy.mjs";
import { fail, takeEnv, takeValue } from "../support.mjs";

// Only what reads or writes entries takes an environment; bases belong to the
// workspace.
const ENVIRONMENT_SCOPED = new Set(["list", "show", "write", "cat", "rm-entry", "status", "publish"]);

export async function kb(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";
  const env = ENVIRONMENT_SCOPED.has(sub) ? takeEnv(args, { fallback: null }) : null;
  const ctx = { client, workspace, env };

  switch (sub) {
    case "list": return await list(ctx);
    case "show": return await show(ctx, args.shift());
    case "create": return await create(client, workspace, args.splice(0));
    case "rm": return await remove(client, workspace, args.shift());
    case "write": return await write(ctx, args);
    case "cat": return await cat(ctx, args);
    case "rm-entry": return await removeEntry(ctx, args.shift(), args.shift());
    case "follow":
    case "unfollow":
    case "refresh":
      return fail(`\`vatio kb ${sub}\` was removed: knowledge is the entries you write with \`vatio kb write\`.`);
    case "status": return await status(ctx, args.shift());
    case "publish": return await publish(ctx, args.shift());
    case "history": return await history(client, workspace, args.shift());
    case "rollback":
      return fail(
        "`vatio kb rollback` was removed. Restore one entry instead: `vatio kb history BASE` lists what " +
          "reached live, `vatio kb cat BASE ENTRY --version N > old.md` prints one, and " +
          "`vatio kb write BASE ENTRY old.md --env live` brings it back."
      );
    default: fail(`Unknown kb subcommand: ${sub}\n\n${usage()}`);
  }
}

// `preview` when the platform chose, for messages.
function envName(env) {
  return env ?? "preview";
}

function usage() {
  return `usage:
  vatio kb                                  List knowledge bases
  vatio kb show NAME                        One base and its entries
  vatio kb create NAME [NAME...]            Create one base, or several
  vatio kb rm NAME                          Delete a base (must be unreferenced)
  vatio kb write BASE ENTRY [FILE]          Write an entry, from FILE or stdin
  vatio kb cat BASE ENTRY [--version N]     Print an entry's markdown, or one of its versions
  vatio kb rm-entry BASE ENTRY              Delete one entry
  vatio kb status BASE                      What this environment changed that live does not have
  vatio kb publish BASE                     Take this environment's changes live, without the agent
  vatio kb history BASE                     What reached live, newest first

  Entry commands, status and publish take --env preview|live; the default is
  preview. --env live writes live.`;
}

async function list({ client, workspace, env }) {
  const bases = asArray((await client.knowledgeBases({ environment: env })).data);
  if (bases.length === 0) {
    console.log(`No knowledge bases on workspace ${workspace}`);
    console.log("Create one with `vatio kb create docs`, then add `knowledge: [docs]` to vatio.yml");
    return;
  }

  console.log(`Knowledge bases on workspace ${workspace} (${bases.length}):`);
  for (const row of bases) {
    const pending = row.pending_changes ? `  ${row.pending_changes} unpublished in ${envName(env)}` : "";
    console.log(
      `  ${row.name}  entries=${row.entries_count}  ready=${row.answerable_count}` +
        `${pending}${referenceNote(row)}`
    );
  }
}

// A base nothing references is indexed knowledge the agent cannot reach: it
// answers without it and nothing anywhere reports an error. This line is the
// only place that shows up before a bad conversation does.
function referenceNote(row) {
  return row.referenced ? "" : "  (not referenced by any deployed agent)";
}

async function show({ client, workspace, env }, name) {
  if (!name) fail("usage: vatio kb show NAME");

  const base = await client.knowledgeBase(name, { environment: env });
  console.log(
    `${base.name} on workspace ${workspace}: entries=${base.entries_count} ` +
      `ready=${base.answerable_count}${referenceNote(base)}`
  );
  if (base.pending_changes) {
    console.log(`  ${base.pending_changes} change(s) in ${envName(env)} that live does not have — \`vatio kb status ${base.name}\``);
  }

  const entries = asArray(base.entries);
  if (entries.length === 0) {
    console.log(`\n  no entries yet — write one with \`vatio kb write ${name} ENTRY FILE\``);
    return;
  }

  console.log(`\n  entries, as ${envName(env)} sees them:`);
  for (const entry of entries) {
    const version = entry.version ? `  v${entry.version}` : "";
    const unpublished = entry.published === false ? "  (not live yet)" : "";
    console.log(`    ${entry.name}${version}  ${entry.state ?? "?"}${unpublished}`);
  }
}

// Several names, because the moment this command is most often run is a push
// that just refused for naming bases that do not exist yet -- and that push
// names all of them at once. One base per invocation turned a first deploy
// into one round trip per name.
//
// Still never implicit: a base is created because someone typed its name here,
// which is what keeps `knowledge: [defualt]` a failed push instead of an empty
// base the agent searches forever.
async function create(client, workspace, names) {
  const wanted = names.filter((name) => name.trim() !== "");
  if (wanted.length === 0) fail("usage: vatio kb create NAME [NAME...]");

  const created = [];
  for (const name of wanted) {
    const base = await client.createKnowledgeBase(name);
    created.push(base.name);
    console.log(`Created knowledge base ${base.name} on workspace ${workspace}`);
  }

  console.log(created.length === 1
    ? "It is empty and nothing reads it yet."
    : "They are empty and nothing reads them yet.");
  console.log("Fill with `vatio kb write`, then add");
  console.log(`\`knowledge: [${created.join(", ")}]\` to the agent in vatio.yml and push.`);
}

async function remove(client, workspace, name) {
  if (!name) fail("usage: vatio kb rm NAME");

  await client.deleteKnowledgeBase(name);
  console.log(`Deleted knowledge base ${name} on workspace ${workspace}`);
}

// Put this markdown under this name. One shape, positional, no flags: the
// entry's name is the only thing the command cannot work out for itself — the
// title comes from the document's own `# heading`, and the body comes from the
// file or from stdin.
//
// Creates the entry if the name is free and replaces it if it is taken, so the
// round trip is the obvious one:
//
//   vatio kb cat docs horarios > horarios.md
//   $EDITOR horarios.md
//   vatio kb write docs horarios horarios.md
async function write({ client, workspace, env }, args) {
  const [base, name, file] = args;
  if (!base || !name) fail("usage: vatio kb write BASE ENTRY [FILE]   (or pipe the markdown in)");
  if (file && !isFile(file)) fail(`No such file: ${file}`);

  const content = file ? readFileSync(file, "utf8") : readStdin();
  if (!content.trim()) {
    fail("Nothing to write: pass a FILE, or pipe the markdown in on stdin.");
  }

  const row = await client.writeKnowledgeEntry({ base, name, content, environment: env });
  const version = row.version ? ` (v${row.version})` : "";
  if (env === "live") {
    console.log(`Wrote ${row.name}${version} to ${base} on workspace ${workspace}. Live answers with it now.`);
    return;
  }
  console.log(`Wrote ${row.name}${version} to ${base} in ${envName(env)} on workspace ${workspace}`);
  console.log(`${envName(env)} answers with it now; \`vatio publish\` takes it live with the agent.`);
}

// Prints exactly what the platform holds, so a diff against the file you
// pushed is a real answer to "is what I sent what it has".
async function cat({ client, env }, args) {
  const version = takeValue(args, "--version");
  const [base, name] = args;
  if (!base || !name) fail("usage: vatio kb cat BASE ENTRY [--version N]");

  const row = await client.knowledgeEntry({ base, name, environment: env, version });
  const content = row.content ?? "";
  process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
}

async function removeEntry({ client, workspace, env }, base, name) {
  if (!base || !name) fail("usage: vatio kb rm-entry BASE ENTRY");

  await client.deleteKnowledgeEntry({ base, name, environment: env });
  console.log(`Deleted entry ${name} from ${base} in ${envName(env)} on workspace ${workspace}`);
}

// What this environment changed against live, entry by entry -- what
// publishing it would do, and which entries live changed underneath.
async function status({ client, workspace, env }, base) {
  if (!base) fail("usage: vatio kb status BASE");

  const payload = await client.knowledgeChanges(base, { environment: env });
  const changes = asArray(payload.data);
  if (changes.length === 0) {
    console.log(`${base} in ${envName(env)} on workspace ${workspace}: nothing that live does not have`);
    return;
  }

  console.log(`${base} in ${envName(env)} on workspace ${workspace}: ${changes.length} change${changes.length === 1 ? "" : "s"} live does not have`);
  for (const change of changes) {
    const from = change.live_version ? `v${change.live_version}` : "—";
    const to = change.version ?? change.draft_version;
    const conflict = change.conflict ? "  CONFLICT: live changed it after you did" : "";
    console.log(`  ${change.change.padEnd(8)} ${change.name}  ${from} → v${to}${conflict}`);
  }
  if (changes.some((change) => change.conflict)) {
    console.log(`\nRead each conflicting entry from live (\`vatio kb cat ${base} ENTRY --env live\`), write your change on top, and it clears.`);
    if (payload.review_url) console.log(`Or resolve them side by side: ${payload.review_url}`);
  } else {
    console.log("\n`vatio publish` takes them live with the agent; `vatio kb publish` takes them alone.");
  }
}

async function publish({ client, workspace, env }, base) {
  if (!base) fail("usage: vatio kb publish BASE [--env NAME]");

  const result = await client.publishKnowledgeBase({ base, environment: env });
  const names = asArray(result.published);
  console.log(`Published ${names.length} change${names.length === 1 ? "" : "s"} to ${base} from ${envName(env)} on workspace ${workspace}: ${names.join(", ")}`);
  console.log("Live answers from them now.");
}

// Every version that reached live, newest first. Going back is writing one
// of them again.
async function history(client, workspace, base) {
  if (!base) fail("usage: vatio kb history BASE");

  const versions = asArray((await client.knowledgeHistory(base)).data);
  if (versions.length === 0) {
    console.log(`Nothing in ${base} on workspace ${workspace} has reached live yet`);
    return;
  }

  console.log(`What reached live in ${base} on workspace ${workspace}:`);
  for (const row of versions) {
    const who = row.author ? `  ${row.author}` : "";
    const what = row.deleted ? "  deleted" : "";
    console.log(`  ${row.published_at}  ${row.name}  v${row.version}  ${row.source}${who}${what}`);
  }
}

// Blocking on purpose: `vatio kb write docs refunds < refunds.md` should behave
// like every other filter, and a terminal with nobody piping into it returns ""
// rather than hanging on a read that will never end.
function readStdin() {
  if (process.stdin.isTTY) return "";

  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
