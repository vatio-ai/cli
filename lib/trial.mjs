// `vatio push` on a machine with no account: a trial workspace.
//
// The platform makes one (POST /api/developer/v1/trials) and answers with two
// secrets. The deploy key (`vtk_`) stays on this machine, in the config file,
// next to this directory's path: it pushes, checks, chats and writes knowledge
// on the trial's preview, and nothing else. The link to keep it (`claim_url`)
// is for the person: opened signed in, it makes the trial theirs.
//
// Keeping it hands this machine nothing. The key answers `409 trial_claimed`
// from then on, naming the workspace the trial became, and the next command
// signs this terminal in with a device code like `vatio login` does
// (keepClaimedTrial). A link that sent a token back here would send one to
// whoever made the trial and got someone else to open its link.

import { MANIFEST_FILE, rewriteWorkspaceSlug, workspaceSlug } from "./workspace.mjs";
import { HttpError, throwIfOutdated } from "./http.mjs";
import { clientHeaders } from "./telemetry.mjs";
import { deviceLogin } from "./commands/auth.mjs";

// Asks for a trial, and remembers it for this directory. `requested` is the
// slug vatio.yml names, which the trial takes when it is kept if it is free.
export async function startTrial(config, requested) {
  const baseUrl = config.resolveBaseUrl();
  const url = `${baseUrl}/api/developer/v1/trials`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...clientHeaders(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ workspace: requested }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    const reason = error?.cause?.code ?? error?.name ?? "request failed";
    throw new HttpError(`${reason}: ${url}`);
  }
  await throwIfOutdated(response);

  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  if (response.status !== 201 || !body.trial_key || !body.workspace) {
    const message = body.error_description ?? body.error ?? (raw.trim().slice(0, 200) || `HTTP ${response.status}`);
    throw new HttpError(`Could not start a trial: ${message}`, {
      status: response.status,
      requestId: body.request_id ?? null,
      body
    });
  }

  console.log(
    "No Vatio account on this machine, so this goes to a trial workspace. Nothing to sign up for until you keep it."
  );
  const trial = {
    workspace: body.workspace,
    requested,
    key: body.trial_key,
    claim_url: body.claim_url,
    expires_at: body.expires_at
  };
  config.writeTrial(trial);
  return config.trial();
}

// What a push to a trial prints: the two links, what a trial cannot do, and
// how long it lasts.
export function printTrialPush(trial, payload, { started }) {
  const where = started ? "preview" : `preview of trial ${trial.workspace}`;
  console.log(`Pushed deployment #${payload.deployment_id} to ${where} (git_sha=${JSON.stringify(payload.git_sha ?? null)})`);
  for (const warning of Array.isArray(payload.warnings) ? payload.warnings : []) console.log(`  warning: ${warning}`);
  console.log("");
  printTrialLinks(trial);
  console.log("");
  console.log(
    `Deleted ${formatUtc(trial.expires_at)} unless you keep it. Until then: preview only, tools make no writes, no secrets.`
  );
  console.log('Talk to it: vatio chat "hello"   Already have an account? vatio login, then vatio push.');
  console.log("(A coding agent running this: give the person you work for both links.)");
}

export function printTrialLinks(trial) {
  if (trial.try_url) {
    console.log("Try it (anyone with this link can chat with it):");
    console.log(`  ${trial.try_url}`);
  }
  console.log("Keep it (sign in or create an account; this link makes it yours, so don't share it):");
  console.log(`  ${trial.claim_url}`);
}

// Someone opened the link and kept the trial since the last command: the key
// stopped working, and this terminal signs in to the account that kept it --
// with a device code its owner approves in the browser, never with anything
// the platform sent here. vatio.yml then names the workspace the trial became,
// if that is not the slug it asked for.
export async function keepClaimedTrial(config, error) {
  const trial = config.trial();
  const workspace = error.workspace;
  const auth = await deviceLogin({
    config,
    baseUrl: config.resolveBaseUrl(),
    workspace,
    message: `You kept this agent: it is workspace ${workspace} now. Sign this terminal in to keep working on it.`
  });
  config.writeAuth({ baseUrl: auth.baseUrl, token: auth.token });
  if (auth.email) console.log(`Signed in as ${auth.email}`);
  console.log(`Token saved to ${config.configPath}`);

  const root = config.workspaceRoot;
  let current = null;
  try {
    current = root ? workspaceSlug(root) : null;
  } catch {
    current = null;
  }
  if (root && workspace && current !== workspace && rewriteWorkspaceSlug(root, workspace)) {
    const why = current && current === trial?.requested ? `${current} was taken` : "the workspace you kept";
    console.log(`${MANIFEST_FILE}: workspace ${current ?? "(none)"} → ${workspace} (${why})`);
  }
  config.clearTrial();
  console.log("");
}

// "Fri Oct 16 03:40 UTC": when, to the minute, in the zone every terminal shows
// the same.
export function formatUtc(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  const day = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${day.replace(",", "")} ${time} UTC`;
}
