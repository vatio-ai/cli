// secrets / tokens / keys — the things a workspace has that its manifest
// deliberately does not carry. A secret is a credential, and so are a
// publishable token (with the origins it accepts) and a server key; none of
// them is in vatio.yml.

import { deployClient } from "./deploy.mjs";
import { askSecret, branchDefault, fail, paint, takeValue } from "../support.mjs";

// live, preview, or a branch's own like fix-pagos.
const ENVIRONMENT_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ENVIRONMENT_MAX = 40;

// On a branch, its environment unless told otherwise (see branch.mjs).
function environmentOption(args, fallback, cwd) {
  const given = takeValue(args, "--env") ?? takeValue(args, "--environment") ?? takeValue(args, "-e");
  const value = given ?? branchDefault(cwd, fallback);
  if (value === null) return null;
  if (String(value).length > ENVIRONMENT_MAX || !ENVIRONMENT_NAME.test(String(value))) {
    fail(`Unknown environment "${value}" (use live, preview, or a branch's environment like fix-pagos)`);
  }
  return String(value);
}

// Without an environment a secret is the value everywhere. On a branch, or
// with --env, it is the value only that environment uses -- a preview pointing
// its tools at staging while live keeps production.
export async function secrets(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const environment = environmentOption(args, null, config.workspaceRoot);
  const where = environment ? `${environment} on workspace ${workspace}` : `workspace ${workspace}`;
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    const payload = await client.listSecrets({ environment });
    const keys = asArray(payload.secrets);
    if (keys.length === 0) {
      console.log(`No secrets on ${where}`);
      console.log("  Set one: vatio secrets set STRIPE_KEY sk_live_…");
      return;
    }
    // Keys only, never values. The platform does not hand a value back once it
    // is stored, and a CLI that printed them would be a CLI that leaks them
    // into a terminal scrollback.
    console.log(`Secrets on ${where} (${keys.length}):`);
    for (const secret of keys) {
      const scope = secret.environment ? `  (only ${secret.environment})` : "";
      console.log(`  ${secret.key ?? secret}${scope}`);
    }
    return;
  }
  if (sub === "set") {
    const key = args.shift();
    if (!key) fail("Usage: vatio secrets set KEY [VALUE] [--env NAME]");
    // Asked for rather than typed on the command line, where it would stay in
    // shell history.
    const value = args.shift() ?? (await askSecret(`${paint("green", "?")} Paste your secret: `));
    if (value === "") fail(`No value given for ${key}`);
    await client.upsertSecret({ key, value, environment });
    console.log(`${paint("green", "✓")} Set secret ${key} on ${where}`);
    return;
  }
  if (sub === "rm" || sub === "remove" || sub === "delete") {
    const key = args.shift();
    if (!key) fail("Usage: vatio secrets rm KEY [--env NAME]");
    await client.deleteSecret({ key, environment });
    console.log(`Removed ${key} from ${where}`);
    return;
  }

  fail("Usage: vatio secrets list|set KEY [VALUE]|rm KEY [--env NAME]");
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
  const environment = environmentOption(args, "live", config.workspaceRoot);
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
    "Usage: vatio tokens list|create [--env live|preview|NAME] [--label NAME] [--origin URL]...|" +
      "origins PREFIX URL...|revoke PREFIX"
  );
}

// Server keys: what the developer's own backend calls the server API with --
// today, to have the agent write to a contact first. Unlike a publishable
// token it is a secret, and unlike the CLI's own token it belongs to the
// workspace, so it outlives whoever created it.
export async function keys(config, args) {
  const environment = environmentOption(args, "live", config.workspaceRoot);
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

  fail("Usage: vatio keys list|create [--env live|preview|NAME] [--label NAME]|revoke PREFIX");
}

// An empty list is not "anywhere": only Vatio's own pages can use the token.
function originsLine(origins) {
  const list = asArray(origins);
  return list.length > 0 ? list.join(", ") : "none (add one with `vatio tokens origins PREFIX URL`)";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
