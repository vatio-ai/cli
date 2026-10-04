// `vatio auth --supabase` — signed-in users for an app whose users already sign
// in with Supabase Auth, with no keypair and no signing code.
//
// The project is found where the app already keeps it (a .env, or the client
// Lovable generates), checked for the asymmetric signing keys Vatio verifies
// with, and written into vatio.yml. Its URL and public anon key go into the
// workspace secrets so a tool can call the project's REST API as the visitor,
// with their own Row Level Security, in two headers.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { deployClient } from "./deploy.mjs";
import { fail, paint, takeValue } from "../support.mjs";

const PROJECT_URL = /^https:\/\/[a-z0-9]+\.supabase\.co$/;
const URL_IN_SOURCE = /https:\/\/[a-z0-9]+\.supabase\.co/;
const URL_VARIABLE = /^\s*(?:export\s+)?[A-Z_]*SUPABASE_URL\s*=\s*["']?(https:\/\/[a-z0-9]+\.supabase\.co)/m;
// Anon or publishable only: a service-role or secret key would let whoever
// holds it read past every policy, and it never belongs to a widget's tools.
const KEY_VARIABLE = /^\s*(?:export\s+|const\s+)?[A-Z_]*SUPABASE_(?:ANON|PUBLISHABLE)[A-Z_]*KEY\s*[=:]\s*["']?([A-Za-z0-9._-]{20,})/m;
const PLACES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  "src/integrations/supabase/client.ts",
  "src/integrations/supabase/client.js"
];

export async function supabaseAuth(config, args) {
  const root = config.workspaceRootRequired();
  const workspace = config.resolveWorkspaceRequired();
  const signInUrl = takeValue(args, "--sign-in-url");
  const force = args.includes("--force");
  const skipSecrets = args.includes("--no-secrets");
  const index = args.indexOf("--supabase");
  const given = args[index + 1]?.startsWith("https://") ? args[index + 1] : null;

  if (signInUrl && !/^https:\/\/[^/\s?#]+/.test(signInUrl)) fail("--sign-in-url must be an https url on your own site");

  // The console's "Connect Supabase" is the one explicit answer short of a URL
  // on the command line; a .env is a guess about which project the app uses.
  const connected = given ? null : await connectedProject(config, workspace);
  const found = connected ? {} : detect([process.cwd(), root]);
  const url = normalize(given ?? connected?.url ?? found.url);
  if (!url) {
    fail(
      "Could not find your Supabase project URL in a .env or src/integrations/supabase/client.ts.\n" +
        "Pass it: vatio auth --supabase https://<project-ref>.supabase.co\n" +
        "or connect Supabase in the console (Channels)."
    );
  }
  if (!PROJECT_URL.test(url)) {
    fail(`${url} is not a Supabase project URL (https://<project-ref>.supabase.co). Custom domains are not supported yet.`);
  }

  await checkSigningKeys(url);
  writeManifest(config.manifestPath(), url, signInUrl, force);

  console.log(`${paint("green", "✓")} vatio.yml now verifies visitors with ${url}`);
  if (connected) console.log(`  (the project connected in the console: ${connected.name})`);
  else if (found.from && !given) console.log(`  (found in ${found.from})`);

  if (connected) console.log("  SUPABASE_URL and SUPABASE_ANON_KEY were set when it was connected.");
  else if (!skipSecrets) await storeSecrets(config, workspace, url, found.key);

  console.log("");
  console.log("What happens after `vatio push` and `vatio publish`:");
  console.log("  • Web: the widget reads the Supabase session already on your page. Nothing to add —");
  console.log("    signed in, the visitor is known; signed out, they are anonymous.");
  if (signInUrl || existingSignInUrl(config.manifestPath())) {
    console.log("  • WhatsApp and Instagram: the Sign in button opens your sign_in_url. Keep the widget");
    console.log("    script on that page: it waits for the person to sign in and hands the session over.");
  } else {
    console.log("  • WhatsApp and Instagram: add your login page, with the widget script on it —");
    console.log("      vatio auth --supabase --sign-in-url https://your-app.com/login");
  }
  console.log("");
  console.log("A private tool reads the visitor's own rows, under your Row Level Security:");
  console.log("");
  console.log("  # tools/my_orders.yml");
  console.log("  access: private");
  console.log("  request:");
  console.log("    method: GET");
  console.log("    base_url: $env.SUPABASE_URL");
  console.log("    path: /rest/v1/orders");
  console.log("    query: { select: \"*\" }");
  console.log("    headers:");
  console.log("      apikey: $env.SUPABASE_ANON_KEY");
  console.log("      Authorization: Bearer $auth.token");
  console.log("  respond:");
  console.log("    data: { orders: \"$\" }");
  console.log("    message: { when_empty: No orders yet., default: \"Found {{count}} orders.\" }");
  console.log("");
  console.log("Docs: https://docs.vatio.ai/authentication/supabase");
}

async function connectedProject(config, workspace) {
  if (!config.resolveBaseUrl() || !config.resolveToken()) return null;
  try {
    return (await deployClient(config, workspace).supabase())?.project ?? null;
  } catch {
    // An older platform, or no network: the .env is still there to read.
    return null;
  }
}

// Where the app already says which project it uses: the nearest directory, from
// here and from the workspace root upwards, that names one.
function detect(starts) {
  const seen = new Set();
  for (const start of starts) {
    let dir = resolve(start);
    for (let depth = 0; depth < 4; depth += 1) {
      if (!seen.has(dir)) {
        seen.add(dir);
        const found = detectIn(dir);
        if (found.url) return found;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return {};
}

function detectIn(dir) {
  let url = null;
  let key = null;
  let from = null;
  for (const place of PLACES) {
    const path = join(dir, place);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const foundUrl = text.match(URL_VARIABLE)?.[1] ?? (place.startsWith("src/") ? text.match(URL_IN_SOURCE)?.[0] : null);
    if (!url && foundUrl) {
      url = foundUrl;
      from = path;
    }
    const foundKey = text.match(KEY_VARIABLE)?.[1];
    if (!key && foundKey && publicKey(foundKey)) key = foundKey;
  }
  return { url, key, from };
}

// The anon JWT (role "anon") or a publishable key; never a secret or
// service-role one, whatever the variable was called.
function publicKey(value) {
  if (value.startsWith("sb_publishable_")) return true;
  if (value.startsWith("sb_secret_")) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return payload.role === "anon";
  } catch {
    return false;
  }
}

function normalize(value) {
  return value ? value.trim().toLowerCase().replace(/\/+$/, "") : null;
}

async function checkSigningKeys(url) {
  let keys;
  try {
    const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    keys = (await response.json()).keys ?? [];
  } catch (error) {
    console.warn(`${paint("yellow", "!")} Could not reach ${url} to check its signing keys (${error.message}); the deploy checks again.`);
    return;
  }
  if (keys.length > 0) return;

  fail(
    `${url} still signs with the legacy JWT secret (HS256), which Vatio cannot verify without being able\n` +
      "to mint tokens too. In the Supabase dashboard: Project Settings → JWT Keys → migrate, then rotate\n" +
      "to an ES256 key. Your app keeps working through the switch. Then run this again."
  );
}

function writeManifest(path, url, signInUrl, force) {
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.hasIn(["auth", "public_key"]) && !force) {
    fail(
      "vatio.yml already verifies a JWT your backend signs (auth.public_key). Switching to Supabase signs out\n" +
        "every visitor holding one of those — re-run with --force if that is what you want."
    );
  }
  for (const key of [ "public_key", "algorithm" ]) {
    if (doc.hasIn(["auth", key])) doc.deleteIn(["auth", key]);
  }
  doc.setIn(["auth", "supabase"], url);
  if (signInUrl) doc.setIn(["auth", "sign_in_url"], signInUrl);
  writeFileSync(path, String(doc));
}

function existingSignInUrl(path) {
  return parseDocument(readFileSync(path, "utf8")).hasIn(["auth", "sign_in_url"]);
}

async function storeSecrets(config, workspace, url, key) {
  const commands = [ `vatio secrets set SUPABASE_URL ${url}` ];
  if (key) commands.push(`vatio secrets set SUPABASE_ANON_KEY ${key}`);
  else commands.push("vatio secrets set SUPABASE_ANON_KEY <your anon or publishable key>");

  if (!config.resolveBaseUrl() || !config.resolveToken()) {
    console.log("Not logged in, so the secrets your tools use are not set yet. After `vatio login`:");
    for (const command of commands) console.log(`    ${command}`);
    return;
  }

  try {
    const client = deployClient(config, workspace);
    await client.upsertSecret({ key: "SUPABASE_URL", value: url, environment: null });
    if (key) await client.upsertSecret({ key: "SUPABASE_ANON_KEY", value: key, environment: null });
    console.log(`${paint("green", "✓")} Set secret SUPABASE_URL${key ? " and SUPABASE_ANON_KEY" : ""} on workspace ${workspace}`);
    if (!key) console.log(`  Add the anon key yourself: ${commands[1]}`);
  } catch (error) {
    console.warn(`${paint("yellow", "!")} Could not set the secrets (${error.message}). Run:`);
    for (const command of commands) console.warn(`    ${command}`);
  }
}
