// whatsapp / instagram -- both are set up in the inbox: connecting your own
// number or account needs Meta's consent screen, and test phones and accounts
// are a form with a code. The CLI only says where, and that depends on whether
// the workspace has published: before, "Try the agent", where test phones and
// accounts are verified; after, the channel's own page under Channels.
// vatio.ai/workspaces is only for a server too old to send the link, and
// redirects to the inbox.
//
// One thing about WhatsApp is set here too: your numbers (`vatio whatsapp
// mine`), the business's own conversations, which need no number connected.

import { deployClient } from "./deploy.mjs";
import { fail, paint, takeFlag } from "../support.mjs";

const WHATSAPP_USAGE =
  "Usage: vatio whatsapp [test-phones [--json] | mine [NUMBER... | --clear]]";
// The list of who the agent answered on your own number is gone: it answers
// everyone, and Live off in the inbox is how it answers nobody.
const AGENT_NUMBERS_REMOVED =
  "`vatio whatsapp only` and `everyone` were removed: the agent answers everyone who writes to your number. " +
  "To have it answer nobody, turn Live off in the inbox, on the WhatsApp page.";

export async function whatsapp(config, args = []) {
  const sub = args.shift();
  if (sub === undefined) {
    await inInbox(config, { name: "WhatsApp", key: "whatsapp", own: "number", test: "phone" });
    // A server that predates the route answers 404; the link above is enough.
    await printTestPhones(config).catch((error) => {
      if (error?.status !== 404 && error?.body?.error?.code !== "not_found") throw error;
    });
    await printNumber(config);
    // A server that predates the route answers 404; nothing more to show.
    return printOwnerNumbers(config).catch((error) => {
      if (error?.status !== 404 && error?.body?.error?.code !== "not_found") throw error;
    });
  }
  if (sub === "test-phones") {
    const json = takeFlag(args, "--json");
    if (args.length > 0) fail(WHATSAPP_USAGE);
    return printTestPhones(config, { json });
  }
  if (sub === "only" || sub === "everyone") fail(AGENT_NUMBERS_REMOVED);
  if (sub === "mine") {
    const clear = takeFlag(args, "--clear");
    if (clear && args.length > 0) fail(WHATSAPP_USAGE);
    if (!clear && args.length === 0) return printOwnerNumbers(config);
    return setOwnerNumbers(config, clear ? [] : args.splice(0));
  }
  fail(WHATSAPP_USAGE);
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

// The phones that joined by sending Try the agent's code: the ones a preview
// message can go to. Adding one is only in the inbox.
async function printTestPhones(config, { json = false } = {}) {
  const { data = [], max } = await deployClient(config, config.resolveWorkspaceRequired()).testPhones();
  if (json) return console.log(JSON.stringify({ data, max }, null, 2));
  if (data.length === 0) {
    console.log("\nNo test phones yet. Add yours with Try the agent in the inbox: send it the code it shows.");
    return;
  }
  console.log(`\nTest phones (${data.length} of ${max}), verified in Try the agent:`);
  for (const phone of data) console.log(`  ${phone.phone_number}`);
}

// After the inbox link: a workspace with no number of its own has nothing
// more to show, and the link already says what to do.
async function printNumber(config) {
  const client = deployClient(config, config.resolveWorkspaceRequired());
  try {
    printLive(await client.getWhatsapp());
  } catch (error) {
    if (error?.body?.error?.code === "whatsapp_not_connected") return;
    throw error;
  }
}

async function setOwnerNumbers(config, numbers) {
  const client = deployClient(config, config.resolveWorkspaceRequired());
  printOwners(await client.updateOwnerNumbers(numbers));
}

async function printOwnerNumbers(config) {
  const client = deployClient(config, config.resolveWorkspaceRequired());
  printOwners(await client.ownerNumbers());
}

function printOwners(body) {
  const list = Array.isArray(body.owner_numbers) ? body.owner_numbers : [];
  if (list.length === 0) {
    console.log("\nYour numbers: none yet.");
    console.log("  On the preview number every verified test phone counts as one until you list some.");
    console.log("  List the business's own: vatio whatsapp mine +56912345678");
    return;
  }
  console.log(`\nYour numbers: ${list.join(", ")}`);
  console.log("  In these conversations the agent works for the business: `access: owner` tools are");
  console.log("  there, and what you send from the WhatsApp Business app is a message to the agent.");
  console.log("  Change them: vatio whatsapp mine NUMBER...   Empty the list: vatio whatsapp mine --clear");
}

function printLive(number) {
  const live = number.live
    ? paint("green", "live: the agent answers everyone who writes")
    : paint("cyan", "paused: Live is off in the inbox, on the WhatsApp page");
  console.log(`\n${number.display_phone_number ?? "Your number"}: ${live}`);
}
