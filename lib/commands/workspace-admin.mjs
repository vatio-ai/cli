// secrets / keys — the things a workspace has that its manifest deliberately
// does not carry. A secret is a credential, and so are the API keys (publishable,
// with the origins it accepts, and secret); none of them is in vatio.yml.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { deployClient } from "./deploy.mjs";
import { askSecret, fail, paint, takeFlag, takeValue } from "../support.mjs";

// The platform says which names exist (preview and live); this only keeps
// something that cannot be a name out of a URL.
const ENVIRONMENT_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ENVIRONMENT_MAX = 40;

function environmentOption(args, fallback) {
  return checkEnvironment(givenEnvironment(args) ?? fallback);
}

function givenEnvironment(args) {
  return takeValue(args, "--env") ?? takeValue(args, "--environment") ?? takeValue(args, "-e");
}

function checkEnvironment(value) {
  if (value === null) return null;
  if (String(value).length > ENVIRONMENT_MAX || !ENVIRONMENT_NAME.test(String(value))) {
    fail(`Unknown environment "${value}" (use preview or live)`);
  }
  return String(value);
}

// Without an environment a secret is the value everywhere. With --env, it is
// the value only that environment uses -- preview pointing its tools at
// staging while live keeps production. With --tests, the value preview and
// every eval replay use.
//
// `list` shows every row, every environment's included, unless --env asks for
// one. Every line names the row's scope, and `set` and `rm` say which one they
// touched.
export async function secrets(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const tests = takeFlag(args, "--tests");
  // `--from-env` takes a name or nothing, so it cannot go through takeValue:
  // that one fails when the flag is last (`set KEY --from-env`, the documented
  // form) and swallows the next flag when there is one (`--from-env --tests`).
  const fromEnv = takeOptionalValue(args, "--from-env");
  const given = givenEnvironment(args);
  if (tests && given) fail("--tests is the value for every environment but live; drop --env");
  const sub = args.shift() ?? "list";

  if (sub === "list") return listSecrets(client, workspace, checkEnvironment(given));

  const environment = tests ? null : checkEnvironment(given);
  const scope = secretScope({ environment, tests });

  if (sub === "set") {
    const key = args.shift();
    if (!key) fail("Usage: vatio secrets set KEY [VALUE] [--from-env [NAME]] [--env NAME | --tests]");
    const value = fromEnv === null
      // Asked for rather than typed on the command line, where it would stay in
      // shell history.
      ? args.shift() ?? (await askSecret(`${paint("green", "?")} Paste your secret: `))
      : readLocalEnv(config, fromEnv === "" ? key : fromEnv);
    if (value === "") fail(`No value given for ${key}`);
    await client.upsertSecret({ key, value, environment, tests });
    console.log(`${paint("green", "✓")} Set secret ${key} on workspace ${workspace} (${scope})`);
    return;
  }
  if (sub === "rm" || sub === "remove" || sub === "delete") {
    const key = args.shift();
    if (!key) fail("Usage: vatio secrets rm KEY [--env NAME | --tests]");
    await client.deleteSecret({ key, environment, tests });
    console.log(`Removed ${key} from workspace ${workspace} (${scope})`);
    return;
  }

  fail("Usage: vatio secrets list|set KEY [VALUE] [--from-env [NAME]]|rm KEY [--env NAME | --tests]");
}

async function listSecrets(client, workspace, environment) {
  const payload = await client.listSecrets({ environment });
  const keys = asArray(payload.secrets);
  const title = environment ? `secrets ${environment} reads on workspace ${workspace}` : `secrets on workspace ${workspace}`;
  if (keys.length === 0) {
    console.log(`No ${title}`);
    console.log("  Set one: vatio secrets set STRIPE_KEY sk_live_…");
    return;
  }
  // Keys only, never values. The platform does not hand a value back once it
  // is stored, and a CLI that printed them would be a CLI that leaks them
  // into a terminal scrollback.
  console.log(`${title[0].toUpperCase()}${title.slice(1)} (${keys.length}):`);
  const width = Math.max(...keys.map((secret) => String(secret.key ?? secret).length));
  for (const secret of keys) {
    console.log(`  ${String(secret.key ?? secret).padEnd(width)}  ${secretScope(secret)}`);
  }
}

function secretScope({ environment, tests }) {
  if (tests) return "tests";
  return environment ? `only ${environment}` : "every environment";
}

// Repeatable: `--origin https://a.com --origin https://b.com`.
function takeOrigins(args) {
  const origins = [];
  for (let value = takeValue(args, "--origin"); value !== null; value = takeValue(args, "--origin")) {
    origins.push(value);
  }
  return origins;
}

const KINDS = ["publishable", "secret"];
const KEYS_USAGE =
  "Usage: vatio keys list [--json]|create publishable|secret [--env live|preview] [--label NAME] [--origin URL]... [--json]|" +
  "origins PREFIX URL...|revoke PREFIX";

// API keys, of two kinds. A publishable key is for a page or an app: public by
// design, accepted only from the origins it lists. A secret key is for the
// developer's own backend (today, to have the agent write to a contact first):
// it never goes in a page or an app, and unlike the CLI's own token it belongs
// to the workspace, so it outlives whoever created it.
export async function keys(config, args) {
  const environment = environmentOption(args, "live");
  const label = takeValue(args, "--label") ?? takeValue(args, "-l");
  const origins = takeOrigins(args);
  const json = takeFlag(args, "--json");
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    const payload = await client.listApiKeys();
    const list = asArray(payload.api_keys);
    if (json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    if (list.length === 0) {
      console.log(`No API keys on workspace ${workspace}`);
      console.log("  Create one: vatio keys create publishable --env live --origin https://your-site.com");
      console.log("              vatio keys create secret --env live --label backend");
      return;
    }
    console.log(`API keys on workspace ${workspace} (${list.length}):`);
    for (const key of list) {
      const parts = [key.kind, key.prefix, key.environment];
      if (key.label) parts.push(key.label);
      if (key.managed) parts.push(`managed${key.managed_kind ? ` (${key.managed_kind})` : ""}`);
      parts.push(key.last_used_at ? `last used ${key.last_used_at}` : "never used");
      console.log(`  ${parts.filter(Boolean).join("  ")}`);
      if (key.kind === "publishable") console.log(`    origins: ${originsLine(key.allowed_origins)}`);
    }
    return;
  }
  if (sub === "create") {
    const kind = args.shift();
    if (!KINDS.includes(kind)) fail("Say which kind: vatio keys create publishable|secret [--env NAME] [--label NAME] [--origin URL]...");
    if (kind === "secret" && origins.length > 0) {
      fail("--origin only applies to a publishable key. A secret key is for your backend and has no origins.");
    }
    const payload = await client.createApiKey({
      kind,
      environment,
      label,
      allowedOrigins: kind === "publishable" ? origins : []
    });
    // For a script that hands the key straight to something else: the key or a
    // failed command, never a line of prose to grep it out of.
    if (json) {
      console.log(JSON.stringify({ ...payload, workspace }, null, 2));
      return;
    }
    console.log(`Created a ${kind} key for ${environment} on workspace ${workspace}`);
    if (kind === "publishable") console.log(`  origins: ${originsLine(payload.api_key?.allowed_origins)}`);
    console.log("");
    // Shown in full exactly once: the platform stores a digest, so this is the
    // only moment the value exists anywhere the developer can copy it.
    console.log(`  ${payload.key}`);
    console.log("");
    if (kind === "publishable") {
      console.log("Copy it now — it is not shown again.");
      return;
    }
    console.log("Copy it now — it is not shown again. Keep it on your server, never in a page or an app:");
    console.log("");
    console.log(`  VATIO_SERVER_KEY=${payload.key}`);
    console.log("");
    console.log("Try it (lists the templates your number can send):");
    console.log(`  curl ${config.resolveBaseUrl()}/api/server/v1/${workspace}/templates \\`);
    console.log('    -H "Authorization: Bearer $VATIO_SERVER_KEY"');
    return;
  }
  if (sub === "origins") {
    const prefix = args.shift();
    if (!prefix) fail("Usage: vatio keys origins PREFIX [URL...]   (no URL clears the list)");
    const payload = await client.setApiKeyOrigins({ prefix, allowedOrigins: args.splice(0) });
    console.log(`Origins for ${prefix}: ${originsLine(payload.api_key?.allowed_origins)}`);
    return;
  }
  if (sub === "revoke") {
    const prefix = args.shift();
    if (!prefix) fail("Usage: vatio keys revoke PREFIX");
    await client.revokeApiKey({ prefix });
    console.log(`Revoked ${prefix} on workspace ${workspace}`);
    return;
  }

  fail(KEYS_USAGE);
}

// A flag whose value is optional: `--flag`, `--flag VALUE` or `--flag=VALUE`.
// Returns null when it is absent and "" when it is there with no value, so
// the caller can tell those two apart. A following token that starts with `-`
// is the next flag, not this one's value.
function takeOptionalValue(args, name) {
  const prefix = `${name}=`;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        args.splice(i, 1);
        return "";
      }
      args.splice(i, 2);
      return next;
    }
    if (args[i].startsWith(prefix)) {
      const value = args[i].slice(prefix.length);
      args.splice(i, 1);
      return value;
    }
  }
  return null;
}

// One named value, out of the process environment or the `.env` beside the
// workspace, so a coding agent can set a secret it is not allowed to see.
//
// Why it exists: the skills tell an agent to hand `vatio secrets` to the
// developer, because the value is theirs and not the agent's to read. That is
// right, and it also means somebody has to be at the keyboard -- in Grupo
// Proser's onboarding six of the eight `secrets set` calls were run by the
// human, each one a stop in the middle of the agent's work. Naming the key
// instead of the value keeps the secret out of the agent's context and out of
// shell history, and lets it finish on its own.
//
// Only the key asked for is read. There is no bulk upload on purpose: a
// `.env` holds more than this workspace needs, and none of the rest is
// Vatio's business.
function readLocalEnv(config, name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`\`${name}\` is not an environment variable name`);

  const exported = process.env[name];
  if (exported !== undefined && exported !== "") return exported;

  const roots = [];
  try {
    roots.push(config.workspaceRootRequired());
  } catch {
    // No workspace yet: the cwd is still worth reading.
  }
  roots.push(process.cwd());

  const seen = [];
  for (const root of roots) {
    // Resolved, so the workspace root and the cwd are not reported as two
    // files when they are one (/tmp and /private/tmp on macOS).
    let path = join(root, ".env");
    try {
      path = realpathSync(path);
    } catch {
      // Not there, or not readable: the existsSync below says so.
    }
    if (seen.includes(path)) continue;
    seen.push(path);
    if (!existsSync(path)) continue;

    const found = valueIn(readFileSync(path, "utf8"), name);
    if (found === null) continue;
    if (found === UNTERMINATED) {
      fail(
        `\`${name}\` in ${path} opens a quote it does not close on the same line.\n` +
          "A multi-line value is not read from a .env — pipe it instead: " +
          `cat key.pem | vatio secrets set ${name}`
      );
    }
    if (found === "") fail(`\`${name}\` is in ${path} but has no value.`);
    return found;
  }

  fail(
    `\`${name}\` is not in the environment${seen.length > 0 ? ` or in ${seen.join(" or ")}` : ""}.\n` +
      `Export it, put it in a .env, or pass the value: vatio secrets set ${name} VALUE`
  );
}

// A minimal .env read: `KEY=value`, with or without `export`, with or without
// quotes, with or without a trailing comment. No interpolation.
//
// Returns the value, null when the key is not in the file, or UNTERMINATED
// for a quote the line never closes -- a multi-line value, a PEM key usually,
// whose first line is not the secret. readLocalEnv refuses that rather than
// sending it.
//
// The last assignment wins, the way dotenv and `set -a; . ./.env` both read a
// file that sets one key twice.
function valueIn(text, name) {
  let found = null;

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== name) continue;

    const rest = match[2].trim();
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : null;
    if (quote === null) {
      // Bare: whitespace then `#` starts a comment.
      found = rest.replace(/\s+#.*$/, "").trim();
      continue;
    }
    // Quoted: up to the closing quote, so a `#` inside stays in the value and
    // anything after the quote is a comment.
    const closed = new RegExp(`^${quote}((?:[^${quote}\\\\]|\\\\.)*)${quote}`).exec(rest);
    found = closed === null ? UNTERMINATED : closed[1].replace(/\\(.)/g, "$1");
  }

  return found;
}

const UNTERMINATED = Symbol("unterminated");

// An empty list is not "anywhere": only Vatio's own pages can use the key.
function originsLine(origins) {
  const list = asArray(origins);
  return list.length > 0 ? list.join(", ") : "none (add one with `vatio keys origins PREFIX URL`)";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
