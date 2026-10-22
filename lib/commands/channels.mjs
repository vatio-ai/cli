// whatsapp / instagram -- both are set up in the inbox: connecting your own
// number or account needs Meta's consent screen, and test phones and accounts
// are a form with a code. The CLI only says where, and that depends on whether
// the workspace has published: before, "Try the agent", where test phones and
// accounts are verified; after, the channel's own page under Channels.
// vatio.ai/workspaces is only for a server too old to send the link, and
// redirects to the inbox.
//
// One thing about your own WhatsApp number is set here too: who the agent
// answers on it (`vatio whatsapp only` / `everyone`). Everyone else's messages
// still reach the inbox.

import { deployClient } from "./deploy.mjs";
import { fail, paint, takeFlag } from "../support.mjs";

const WHATSAPP_USAGE = "Usage: vatio whatsapp [test-phones [--json] | only NUMBER [NUMBER]... | everyone]";

export async function whatsapp(config, args = []) {
  const sub = args.shift();
  if (sub === undefined) {
    await inInbox(config, { name: "WhatsApp", key: "whatsapp", own: "number", test: "phone" });
    // A server that predates the route answers 404; the link above is enough.
    await printTestPhones(config).catch((error) => {
      if (error?.status !== 404 && error?.body?.error?.code !== "not_found") throw error;
    });
    return printAgentNumbers(config);
  }
  if (sub === "test-phones") {
    const json = takeFlag(args, "--json");
    if (args.length > 0) fail(WHATSAPP_USAGE);
    return printTestPhones(config, { json });
  }
  if (sub === "only") {
    if (args.length === 0) fail(WHATSAPP_USAGE);
    return setAgentNumbers(config, args.splice(0));
  }
  if (sub === "everyone") {
    if (args.length > 0) fail(WHATSAPP_USAGE);
    return setAgentNumbers(config, []);
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

async function setAgentNumbers(config, numbers) {
  const client = deployClient(config, config.resolveWorkspaceRequired());
  printAnswers(await client.updateWhatsapp({ agent_numbers: numbers }));
}

// After the inbox link: a workspace with no number of its own has nothing
// more to show, and the link already says what to do.
async function printAgentNumbers(config) {
  const client = deployClient(config, config.resolveWorkspaceRequired());
  try {
    printAnswers(await client.getWhatsapp());
  } catch (error) {
    if (error?.body?.error?.code === "whatsapp_not_connected") return;
    throw error;
  }
}

function printAnswers(number) {
  const list = Array.isArray(number.agent_numbers) ? number.agent_numbers : [];
  const live = number.live ? paint("green", "live") : paint("cyan", "paused: Live is off in the inbox, under Channels → WhatsApp");
  console.log(`\n${number.display_phone_number ?? "Your number"}: ${live}`);
  if (list.length === 0) {
    console.log("  The agent answers everyone. To answer only some numbers: vatio whatsapp only +56912345678");
    return;
  }
  console.log(`  The agent answers only: ${list.join(", ")}`);
  console.log("  Everyone else's messages reach the inbox unanswered; your routines' numbers always count.");
  console.log("  Back to everyone: vatio whatsapp everyone");
}
