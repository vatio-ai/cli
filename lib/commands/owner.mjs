// The owner's side of the workspace, as the inbox's Security, Activity and
// Plan pages have it: how it is protected, what happened in it, letting Vatio
// in, handing it over, deleting it, and its plan. The same API the MCP's
// workspace tools call. What outlives a support grant needs a fresh code from
// the owner's second factor (--code), as `vatio team invite` does.

import { deployClient, workspacesClient } from "./deploy.mjs";
import { withSecondFactor } from "./team.mjs";
import { ask, fail, paint, takeFlag, takeValue } from "../support.mjs";

const print = (answer) => console.log(JSON.stringify(answer, null, 2));

const SECURITY_USAGE = "Usage: vatio security [show] [--json]\n" +
  "       vatio security set [--require-2fa on|off] [--retention-days N]";

export async function security(config, args) {
  const json = takeFlag(args, "--json");
  const client = deployClient(config, config.resolveWorkspaceRequired());
  const sub = args.shift() ?? "show";
  if (sub === "show") {
    if (args.length) fail(SECURITY_USAGE);
    return showSecurity(await client.get("/security"), json);
  }
  if (sub === "set") {
    const require2fa = takeValue(args, "--require-2fa");
    const retention = takeValue(args, "--retention-days");
    if (args.length || (require2fa === null && retention === null)) fail(SECURITY_USAGE);
    if (require2fa !== null && !["on", "off"].includes(require2fa)) fail(SECURITY_USAGE);
    const body = {};
    if (require2fa !== null) body.require_two_factor = require2fa === "on";
    if (retention !== null) body.retention_days = Number(retention);
    return showSecurity(await client.patch("/security", body), json);
  }
  fail(SECURITY_USAGE);
}

function showSecurity(answer, json) {
  if (json) return print(answer);
  console.log(`Two-step verification for everyone: ${answer.require_two_factor ? "required" : "not required"}`);
  console.log(`Conversations kept: ${answer.retention_days ? `${answer.retention_days} days` : "until deleted"}`);
  if (answer.members_without_two_factor) {
    console.log(`${answer.members_without_two_factor} on the team have no second factor yet.`);
  }
}

const ACTIVITY_USAGE = "Usage: vatio activity [--category NAME] [--page N] [--json]";

export async function activity(config, args) {
  const json = takeFlag(args, "--json");
  const category = takeValue(args, "--category");
  const page = takeValue(args, "--page");
  if (args.length) fail(ACTIVITY_USAGE);
  const client = deployClient(config, config.resolveWorkspaceRequired());
  const answer = await client.get("/activity", { category, page });
  if (json) return print(answer);
  for (const event of answer.data ?? []) {
    console.log(`${String(event.at ?? event.created_at ?? "").slice(0, 16).replace("T", " ")}  ${event.who ?? event.who_label ?? "Vatio"}  ${event.label ?? event.action}`);
  }
  if ((answer.data ?? []).length === 0) console.log("Nothing yet.");
  if (answer.meta?.next_page) console.log(`More: vatio activity --page ${answer.meta.next_page}`);
}

const SUPPORT_USAGE = "Usage: vatio support-access [show] [--json]\n" +
  "       vatio support-access open 24h|72h|7d\n" +
  "       vatio support-access close";

export async function supportAccess(config, args) {
  const json = takeFlag(args, "--json");
  const client = deployClient(config, config.resolveWorkspaceRequired());
  const sub = args.shift() ?? "show";
  let answer;
  if (sub === "show") answer = await client.get("/support_access");
  else if (sub === "open") {
    const duration = args.shift();
    if (!duration || args.length) fail(SUPPORT_USAGE);
    answer = await client.post("/support_access", { duration });
  } else if (sub === "close") answer = await client.delete("/support_access");
  else fail(SUPPORT_USAGE);
  if (json) return print(answer);
  const active = answer.active ?? [];
  if (active.length === 0) return console.log("Vatio staff cannot open this workspace.");
  for (const grant of active) console.log(`Open until ${grant.expires_at} (${grant.kind ?? "granted"})`);
}

const TRANSFER_USAGE = "Usage: vatio transfer [show] [--json]\n" +
  "       vatio transfer offer EMAIL [--code CODE | --recovery-code CODE]\n" +
  "       vatio transfer cancel\n" +
  "       vatio transfer accept SLUG [--code CODE | --recovery-code CODE]\n" +
  "       vatio transfer decline SLUG";

export async function transfer(config, args) {
  const json = takeFlag(args, "--json");
  const code = takeValue(args, "--code");
  const recoveryCode = takeValue(args, "--recovery-code");
  const sub = args.shift() ?? "show";
  if (sub === "accept" || sub === "decline") {
    const slug = args.shift();
    if (!slug || args.length) fail(TRANSFER_USAGE);
    const account = workspacesClient(config);
    if (sub === "decline") {
      await account.post(`/api/v1/transfers/${encodeURIComponent(slug)}/decline`, {});
      return console.log(`Declined ${slug}: it stays with its owner.`);
    }
    await withSecondFactor((body) => account.post(`/api/v1/transfers/${encodeURIComponent(slug)}/accept`, body),
      { code, recovery_code: recoveryCode });
    return console.log(`${paint("green", "✓")} ${slug} is yours now.`);
  }

  const client = deployClient(config, config.resolveWorkspaceRequired());
  let answer;
  if (sub === "show") answer = await client.get("/transfer");
  else if (sub === "offer") {
    const email = args.shift();
    if (!email || args.length) fail(TRANSFER_USAGE);
    answer = await withSecondFactor((body) => client.post("/transfer", body), { email, code, recovery_code: recoveryCode });
  } else if (sub === "cancel") answer = await client.delete("/transfer");
  else fail(TRANSFER_USAGE);
  if (json) return print(answer);
  if (answer?.pending) return console.log(`Offered to ${answer.pending.email ?? answer.pending.to ?? "someone"} until ${answer.pending.expires_at}.`);
  console.log(answer?.transferable === false ? "This workspace cannot be transferred." : "No offer open.");
}

const WORKSPACE_USAGE = "Usage: vatio workspace delete SLUG [--yes] [--code CODE | --recovery-code CODE]";

export async function workspace(config, args) {
  const yes = takeFlag(args, "--yes");
  const code = takeValue(args, "--code");
  const recoveryCode = takeValue(args, "--recovery-code");
  const sub = args.shift();
  const slug = args.shift();
  if (sub !== "delete" || !slug || args.length) fail(WORKSPACE_USAGE);
  if (slug !== config.resolveWorkspaceRequired()) {
    fail(`${slug} is not the workspace this command is on (${config.resolveWorkspaceRequired()}): name the same one.`);
  }
  if (!yes) {
    if (!process.stdin.isTTY) fail("Deleting a workspace cannot be undone, so without a terminal it needs --yes.");
    const answer = await ask(`${paint("green", "?")} Delete ${slug} for everyone? Type its slug: `);
    if (answer.trim() !== slug) fail("Nothing changed.");
  }
  const client = deployClient(config, slug);
  await withSecondFactor((query) => client.delete(`/workspace${toQuery(query)}`), { code, recovery_code: recoveryCode });
  console.log(`Deleted ${slug}.`);
}

function toQuery(values) {
  const search = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export async function plan(config, args) {
  const json = takeFlag(args, "--json");
  if (args.length) fail("Usage: vatio plan [--json]");
  const answer = await deployClient(config, config.resolveWorkspaceRequired()).get("/plan");
  if (json) return print(answer);
  console.log(`Plan: ${answer.plan}`);
  console.log(`Conversations this period: ${answer.conversations} of ${answer.included}${answer.over ? " (over)" : ""}`);
  if (answer.period) console.log(`Period: ${answer.period.from} → ${answer.period.to}`);
}
