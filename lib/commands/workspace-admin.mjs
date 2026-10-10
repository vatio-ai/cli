// secrets / tokens / keys — the things a workspace has that its manifest
// deliberately does not carry. A secret is a credential, and so are a
// publishable token (with the origins it accepts) and a server key; none of
// them is in vatio.yml.

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
  const given = givenEnvironment(args);
  if (tests && given) fail("--tests is the value for every environment but live; drop --env");
  const sub = args.shift() ?? "list";

  if (sub === "list") return listSecrets(client, workspace, checkEnvironment(given));

  const environment = tests ? null : checkEnvironment(given);
  const scope = secretScope({ environment, tests });

  if (sub === "set") {
    const key = args.shift();
    if (!key) fail("Usage: vatio secrets set KEY [VALUE] [--env NAME | --tests]");
    // Asked for rather than typed on the command line, where it would stay in
    // shell history.
    const value = args.shift() ?? (await askSecret(`${paint("green", "?")} Paste your secret: `));
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

  fail("Usage: vatio secrets list|set KEY [VALUE]|rm KEY [--env NAME | --tests]");
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

export async function tokens(config, args) {
  const environment = environmentOption(args, "live");
  const label = takeValue(args, "--label") ?? takeValue(args, "-l");
  const origins = takeOrigins(args);
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    const payload = await client.listPublishableTokens();
    const list = asArray(payload.publishable_tokens);
    if (list.length === 0) {
      console.log(`No publishable tokens on workspace ${workspace}`);
      console.log("  Create one: vatio tokens create --env live --origin https://your-site.com");
      return;
    }
    console.log(`Publishable tokens on workspace ${workspace} (${list.length}):`);
    for (const token of list) {
      const parts = [token.key_prefix ?? token.prefix, token.environment];
      if (token.label) parts.push(token.label);
      console.log(`  ${parts.filter(Boolean).join("  ")}`);
      console.log(`    origins: ${originsLine(token.allowed_origins)}`);
    }
    return;
  }
  if (sub === "create") {
    const payload = await client.createPublishableToken({ environment, label, allowedOrigins: origins });
    console.log(`Created a publishable token for ${environment} on workspace ${workspace}`);
    console.log(`  origins: ${originsLine(payload.allowed_origins)}`);
    console.log("");
    // Shown in full exactly once: the platform stores a digest, so this is the
    // only moment the value exists anywhere the developer can copy it.
    console.log(`  ${payload.token ?? payload.publishable_token}`);
    console.log("");
    console.log("Copy it now — it is not shown again.");
    return;
  }
  if (sub === "origins") {
    const prefix = args.shift();
    if (!prefix) fail("Usage: vatio tokens origins PREFIX [URL...]   (no URL clears the list)");
    const payload = await client.setPublishableTokenOrigins({ prefix, allowedOrigins: args.splice(0) });
    console.log(`Origins for ${prefix}: ${originsLine(payload.allowed_origins)}`);
    return;
  }
  if (sub === "revoke") {
    const prefix = args.shift();
    if (!prefix) fail("Usage: vatio tokens revoke PREFIX");
    await client.revokePublishableToken({ prefix });
    console.log(`Revoked ${prefix} on workspace ${workspace}`);
    return;
  }

  fail(
    "Usage: vatio tokens list|create [--env live|preview] [--label NAME] [--origin URL]...|" +
      "origins PREFIX URL...|revoke PREFIX"
  );
}

// Server keys: what the developer's own backend calls the server API with --
// today, to have the agent write to a contact first. Unlike a publishable
// token it is a secret, and unlike the CLI's own token it belongs to the
// workspace, so it outlives whoever created it.
export async function keys(config, args) {
  const environment = environmentOption(args, "live");
  const label = takeValue(args, "--label") ?? takeValue(args, "-l");
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    const payload = await client.listServerKeys();
    const list = asArray(payload.server_keys);
    if (list.length === 0) {
      console.log(`No server keys on workspace ${workspace}`);
      console.log("  Create one: vatio keys create --env live --label backend");
      return;
    }
    console.log(`Server keys on workspace ${workspace} (${list.length}):`);
    for (const key of list) {
      const parts = [key.prefix, key.environment];
      if (key.label) parts.push(key.label);
      parts.push(key.last_used_at ? `last used ${key.last_used_at}` : "never used");
      console.log(`  ${parts.join("  ")}`);
    }
    return;
  }
  if (sub === "create") {
    const payload = await client.createServerKey({ environment, label });
    console.log(`Created a server key for ${environment} on workspace ${workspace}`);
    console.log("");
    // The platform keeps only a digest: this is the one time the key exists
    // anywhere it can be copied from.
    console.log(`  ${payload.key}`);
    console.log("");
    console.log("Copy it now — it is not shown again. Keep it on your server, never in a page or an app:");
    console.log("");
    console.log(`  VATIO_SERVER_KEY=${payload.key}`);
    console.log("");
    console.log("Try it (lists the templates your number can send):");
    console.log(`  curl ${config.resolveBaseUrl()}/api/server/v1/${workspace}/templates \\`);
    console.log('    -H "Authorization: Bearer $VATIO_SERVER_KEY"');
    return;
  }
  if (sub === "revoke") {
    const prefix = args.shift();
    if (!prefix) fail("Usage: vatio keys revoke PREFIX");
    await client.revokeServerKey({ prefix });
    console.log(`Revoked ${prefix} on workspace ${workspace}`);
    return;
  }

  fail("Usage: vatio keys list|create [--env live|preview] [--label NAME]|revoke PREFIX");
}

// An empty list is not "anywhere": only Vatio's own pages can use the token.
function originsLine(origins) {
  const list = asArray(origins);
  return list.length > 0 ? list.join(", ") : "none (add one with `vatio tokens origins PREFIX URL`)";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
