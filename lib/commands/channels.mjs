// whatsapp / instagram -- connecting your own number or account needs Meta's
// consent screen, so `connect` prints where in the inbox, and that depends on
// whether the workspace has published: before, "Try the agent"; after, the
// channel's own page. Everything else on the WhatsApp page is here too.
// vatio.ai/workspaces is only for a server too old to send the link, and
// redirects to the inbox.

import { deployClient } from "./deploy.mjs";
import { messages } from "./messages.mjs";
import { withSecondFactor } from "./team.mjs";
import { templates } from "./webhooks.mjs";
import { ask, fail, paint, takeFlag, takeValue } from "../support.mjs";

const WHATSAPP_USAGE = [
  "Usage: vatio whatsapp [status] [--json]",
  "       vatio whatsapp connect | live on|off | check [--pin PIN] | disconnect [--yes] | team",
  "       vatio whatsapp invite EMAIL [--code CODE | --recovery-code CODE]",
  "       vatio whatsapp templates [list] | create NAME ... | rm NAME | sync",
  "       vatio whatsapp failed [--since DATE] [--until DATE] [--error-code CODE] ...",
].join("\n");
// The list of who the agent answered on your own number is gone: it answers
// everyone, and `vatio whatsapp live off` is how it answers nobody.
const AGENT_NUMBERS_REMOVED =
  "`vatio whatsapp only` and `everyone` were removed: the agent answers everyone who writes to your number. " +
  "To have it answer nobody: vatio whatsapp live off.";
// "Your numbers" were a list typed by hand; the team's numbers took its place.
const MINE_REMOVED =
  "`vatio whatsapp mine` was removed: the team's numbers are the ones each member verified on their account " +
  "(Account in the inbox): vatio whatsapp team. A tool declares which role may use it with " +
  "`access: supervisor`, `developer` or `owner`.";
// Test phones went the same way: the team reaches the agent on Vatio's number
// from the WhatsApp each verified on their account, and what is left, a
// customer's phone, is added in the inbox.
const phonesRemoved = (name) =>
  `\`vatio whatsapp ${name}\` was removed: everyone on the team reaches the agent on Vatio's number from the ` +
  "WhatsApp they verified on their account (vatio whatsapp team lists them). To try it as a customer, add a " +
  "customer phone in the inbox: Conversations → Try the agent → WhatsApp.";

// One noun per thing on the inbox's WhatsApp page, each with the same verbs:
// the number itself, the team on it, its templates and its failed messages.
export async function whatsapp(config, args = []) {
  const json = takeFlag(args, "--json");
  const sub = args.shift();
  const client = () => deployClient(config, config.resolveWorkspaceRequired());
  switch (sub) {
    case undefined:
    case "status":
      return status(config, client(), { json });
    case "connect":
      return inInbox(config, WHATSAPP);
    case "live": {
      const value = args.shift();
      if (!["on", "off"].includes(value) || args.length) fail(WHATSAPP_USAGE);
      return printNumber(await client().setWhatsappLive(value === "on"), { json });
    }
    case "check": {
      // The number's two-step verification PIN registers it on the Cloud API
      // again first: the fix for 133010, not registered.
      const pin = takeValue(args, "--pin");
      if (args.length) fail(WHATSAPP_USAGE);
      if (pin !== null && !/^\d{6}$/.test(pin)) fail("--pin is the number's two-step verification PIN: 6 digits.");
      const number = await client().checkWhatsapp(pin);
      printNumber(number, { json, checked: true });
      // A check that leaves Meta refusing every send did not pass.
      if (number.issue) process.exitCode = 1;
      return;
    }
    case "disconnect":
      return disconnect(client(), args, { json });
    case "invite":
      return invite(client(), args, { json });
    case "team":
      return printTeam(await client().whatsappTeam(), { json });
    case "templates":
      return templates(config, json ? [...args, "--json"] : args);
    case "failed":
      return messages(config, ["failed", ...args, ...(json ? ["--json"] : [])]);
    case "only":
    case "everyone":
      return fail(AGENT_NUMBERS_REMOVED);
    case "mine":
      return fail(MINE_REMOVED);
    case "phones":
    case "test-phones":
      return fail(phonesRemoved(sub));
    default:
      return fail(WHATSAPP_USAGE);
  }
}

const WHATSAPP = {
  key: "whatsapp",
  published: "Connect your own number in the inbox, on the WhatsApp page:",
  draft: "Talk to your agent on WhatsApp with Try the agent in the inbox: verify your phone there once, and it " +
    "reaches your agent on Vatio's number."
};
const INSTAGRAM = {
  key: "instagram",
  published: "Connect your own account and manage test accounts in the inbox, under Channels:",
  draft: "Test Instagram with Try the agent in the inbox: verify your account there and talk to your agent."
};

export const instagram = (config) => inInbox(config, INSTAGRAM);

async function inInbox(config, channel) {
  const status = await deployClient(config, config.resolveWorkspaceRequired()).deployStatus();
  const url = status[`${channel.key}_url`] ?? status.integrations_url ?? `${config.resolveBaseUrl()}/workspaces`;
  // An older server sends no `published`; a live deployment means the same.
  const published = status.published ?? Boolean(status.live);

  console.log(published ? channel.published : channel.draft);
  console.log(`  ${published ? url : (status.try_url ?? url)}`);
}

async function status(config, client, { json }) {
  let number = null;
  try {
    number = await client.getWhatsapp();
  } catch (error) {
    if (error?.body?.error?.code !== "whatsapp_not_connected") throw error;
  }
  if (json) return console.log(JSON.stringify(number ?? { connected: false }, null, 2));
  // A number Meta refuses every send from comes before anything else.
  if (number?.issue) printNumber(number);
  await inInbox(config, WHATSAPP);
  if (number && !number.issue) printNumber(number);
}

async function disconnect(client, args, { json }) {
  const yes = takeFlag(args, "--yes");
  if (args.length) fail(WHATSAPP_USAGE);
  if (!yes) {
    if (!process.stdin.isTTY) fail("Disconnecting stops the agent answering on your number, so without a terminal it needs --yes.");
    const answer = await ask(`${paint("green", "?")} Disconnect your WhatsApp number? Type yes: `);
    if (answer.trim().toLowerCase() !== "yes") fail("Nothing changed.");
  }
  const after = await client.disconnectWhatsapp();
  if (json) return console.log(JSON.stringify(after, null, 2));
  console.log("Disconnected. Connect a number again with: vatio whatsapp connect");
}

// The owner's: whoever manages the number (often a client) gets the link that
// connects it from their own Facebook account, and joins as a supervisor.
// Confirmed with a second factor, as `vatio team invite` is.
async function invite(client, args, { json }) {
  const code = takeValue(args, "--code");
  const recoveryCode = takeValue(args, "--recovery-code");
  const email = args.shift();
  if (!email || args.length) fail(WHATSAPP_USAGE);
  const answer = await withSecondFactor((body) => client.inviteWhatsappConnector(body),
    { email, code, recovery_code: recoveryCode });
  if (json) return console.log(JSON.stringify(answer, null, 2));
  console.log(`Emailed ${answer.invited} the link that connects the number (${answer.role} on the team).`);
  console.log("Once they connect it, it arrives paused: vatio whatsapp live on turns it live.");
}

// Everyone on the team who talks to the agent, and the last digits of the
// WhatsApp each verified on their account: from it the agent knows them, and on
// Vatio's number it reaches this workspace. `number` is null until they do.
function printTeam({ members = [] }, { json }) {
  if (json) return console.log(JSON.stringify(members, null, 2));
  for (const member of members) {
    const number = member.number ?? paint("cyan", "not verified");
    console.log(`  ${member.role.padEnd(11)} ${member.number ? number.padEnd(12) : number}  ${member.name}`);
  }
  if (members.some((member) => !member.number)) {
    console.log("Each person verifies their WhatsApp in the inbox, under Account.");
  }
}

function printNumber(number, { json = false, checked = false } = {}) {
  if (json) return console.log(JSON.stringify(number, null, 2));
  const name = number.number ?? "Your number";
  if (number.issue) {
    printIssue(name, number.issue);
  } else {
    const live = number.live
      ? paint("green", "live: the agent answers everyone who writes")
      : paint("cyan", "paused: vatio whatsapp live on to answer");
    console.log(`\n${name}: ${live}`);
    if (checked && number.state !== "error") console.log("  Meta answered the check: the number can send.");
  }
  if (number.last_health_error && number.last_health_error !== number.issue?.message) {
    console.log(`  ${paint("red", "problem:")} ${number.last_health_error} (vatio whatsapp check)`);
  }
  if (number.failed_deliveries) console.log(`  ${number.failed_deliveries} failed deliveries: vatio whatsapp failed`);
}

// Meta refuses every send from the number, and the server API refuses your
// backend's messages with 409 whatsapp_number_unhealthy until a check passes.
function printIssue(name, issue) {
  const code = issue.code ? ` (Meta ${issue.code})` : "";
  console.log(`\n${name}: ${paint("red", `NOT SENDING since ${issue.since}${code}`)}`);
  if (issue.message) console.log(`  Meta: ${issue.message}`);
  console.log(`  Fix: ${issue.fix}`);
  console.log("  Until a check passes, POST /messages answers 409 whatsapp_number_unhealthy and the agent's replies do not go out.");
}
