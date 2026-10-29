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
  "       vatio whatsapp connect | live on|off | check | disconnect [--yes] | team",
  "       vatio whatsapp invite EMAIL [--code CODE | --recovery-code CODE]",
  "       vatio whatsapp phones [list] | add | rm PHONE | move PHONE   [--json]",
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

// One noun per thing on the inbox's WhatsApp page, each with the same verbs:
// the number itself, its test phones, its templates and its failed messages.
export async function whatsapp(config, args = []) {
  const json = takeFlag(args, "--json");
  const sub = args.shift();
  const client = () => deployClient(config, config.resolveWorkspaceRequired());
  switch (sub) {
    case undefined:
    case "status":
      return status(config, client(), { json });
    case "connect":
      return inInbox(config, { name: "WhatsApp", key: "whatsapp", own: "number", test: "phone" });
    case "live": {
      const value = args.shift();
      if (!["on", "off"].includes(value) || args.length) fail(WHATSAPP_USAGE);
      return printNumber(await client().setWhatsappLive(value === "on"), { json });
    }
    case "check":
      return printNumber(await client().checkWhatsapp(), { json });
    case "disconnect":
      return disconnect(client(), args, { json });
    case "invite":
      return invite(client(), args, { json });
    case "team":
      return printTeam(await client().whatsappTeam(), { json });
    case "phones":
      return phones(config, client(), args, { json });
    case "templates":
      return templates(config, json ? [...args, "--json"] : args);
    case "failed":
      return messages(config, ["failed", ...args, ...(json ? ["--json"] : [])]);
    case "only":
    case "everyone":
      return fail(AGENT_NUMBERS_REMOVED);
    case "mine":
      return fail(MINE_REMOVED);
    case "test-phones":
      return fail("`vatio whatsapp test-phones` is `vatio whatsapp phones` now.");
    default:
      return fail(WHATSAPP_USAGE);
  }
}

export const instagram = (config) =>
  inInbox(config, { name: "Instagram", key: "instagram", own: "account", test: "account" });

async function inInbox(config, channel) {
  const status = await deployClient(config, config.resolveWorkspaceRequired()).deployStatus();
  const url = status[`${channel.key}_url`] ?? status.integrations_url ?? `${config.resolveBaseUrl()}/workspaces`;
  // An older server sends no `published`; a live deployment means the same.
  const published = status.published ?? Boolean(status.live);

  if (published) {
    console.log(`Connect your own ${channel.own} and manage test ${channel.test}s in the inbox, under Channels:`);
  } else {
    console.log(`Test ${channel.name} with Try the agent in the inbox: verify your ${channel.test} there and talk to your agent.`);
  }
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
  await inInbox(config, { name: "WhatsApp", key: "whatsapp", own: "number", test: "phone" });
  // A server that predates the route answers 404; the link above is enough.
  await printPhones(await client.testPhones()).catch((error) => {
    if (error?.status !== 404 && error?.body?.error?.code !== "not_found") throw error;
  });
  if (number) printNumber(number);
}

async function phones(config, client, args, { json }) {
  const action = args.shift() ?? "list";
  const phone = args.shift();
  if (args.length) fail(WHATSAPP_USAGE);
  if (action === "list" && !phone) {
    const list = await client.testPhones();
    return json ? console.log(JSON.stringify(list, null, 2)) : printPhones(list);
  }
  if (action === "add" && !phone) return printJoin(await client.testPhoneCode(), { json });
  if (action === "rm" && phone) {
    await client.removeTestPhone(phone);
    return json ? console.log(JSON.stringify({ removed: phone })) : console.log(`Removed ${phone} from the test phones.`);
  }
  if (action === "move" && phone) {
    const { data } = await client.moveTestPhone(phone);
    return json ? console.log(JSON.stringify(data)) : console.log(`${data.phone_number} now tests this workspace.`);
  }
  fail(WHATSAPP_USAGE);
}

// The phones that joined by sending Try the agent's code: the ones a preview
// message can go to.
function printPhones({ data = [], max, elsewhere = [] }) {
  if (data.length === 0) {
    console.log("\nNo test phones yet. Add yours: vatio whatsapp phones add");
  } else {
    console.log(`\nTest phones (${data.length} of ${max}):`);
    for (const phone of data) console.log(`  ${phone.phone_number}`);
  }
  if (elsewhere.length) {
    console.log("Verified on your other workspaces (vatio whatsapp phones move PHONE brings one here):");
    for (const phone of elsewhere) console.log(`  ${phone.phone_number}  ${phone.workspace}`);
  }
}

// The same code Try the agent shows: the phone joins when it sends it, so the
// message is the proof that whoever added it holds the phone.
function printJoin(join, { json }) {
  if (json) return console.log(JSON.stringify(join, null, 2));
  console.log(`From the phone to add, send this to ${join.send_to ?? "Vatio's test number"} on WhatsApp:`);
  console.log(`  ${join.message}`);
  if (join.link_url) console.log(`Or open this on the phone, it writes the message:\n  ${join.link_url}`);
  console.log(`The code works for ${Math.round((join.expires_in ?? 900) / 60)} minutes. Check with: vatio whatsapp phones`);
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

// The owner's: whoever holds the number (often a client) gets the link that
// connects it, and joins as a supervisor. Confirmed with a second factor, as
// `vatio team invite` is.
async function invite(client, args, { json }) {
  const code = takeValue(args, "--code");
  const recoveryCode = takeValue(args, "--recovery-code");
  const email = args.shift();
  if (!email || args.length) fail(WHATSAPP_USAGE);
  const answer = await withSecondFactor((body) => client.inviteWhatsappConnector(body),
    { email, code, recovery_code: recoveryCode });
  if (json) return console.log(JSON.stringify(answer, null, 2));
  console.log(`Emailed ${answer.invited} the link that connects your number (${answer.role} on the team).`);
}

function printTeam({ members = [] }, { json }) {
  if (json) return console.log(JSON.stringify(members, null, 2));
  if (members.length === 0) return console.log("No one on the team has verified their WhatsApp yet (Account, in the inbox).");
  for (const member of members) console.log(`  ${member.role.padEnd(11)} ${member.number}  ${member.name}`);
}

function printNumber(number, { json = false } = {}) {
  if (json) return console.log(JSON.stringify(number, null, 2));
  const live = number.live
    ? paint("green", "live: the agent answers everyone who writes")
    : paint("cyan", "paused: vatio whatsapp live on to answer");
  console.log(`\n${number.number ?? "Your number"}: ${live}`);
  if (number.last_health_error) console.log(`  ${paint("red", "problem:")} ${number.last_health_error} (vatio whatsapp check)`);
  if (number.failed_deliveries) console.log(`  ${number.failed_deliveries} failed deliveries: vatio whatsapp failed`);
}
