// whatsapp / instagram -- both are set up in the console now: connecting your
// own number or account needs Meta's consent screen, and test phones and
// accounts are a form with a code. The CLI only says where, and that depends
// on whether the workspace has published: before, only the Test page is in the
// console's sidebar; after, the channel's own page under Integrations.
//
// One thing about your own WhatsApp number is set here too: who the agent
// answers on it (`vatio whatsapp only` / `everyone`). Everyone else's messages
// still reach the inbox.

import { deployClient } from "./deploy.mjs";
import { fail, paint } from "../support.mjs";

const WHATSAPP_USAGE = "Usage: vatio whatsapp [only NUMBER [NUMBER]... | everyone]";

export async function whatsapp(config, args = []) {
  const sub = args.shift();
  if (sub === undefined) {
    await inConsole(config, { name: "WhatsApp", key: "whatsapp", own: "number", test: "phone" });
    return printAgentNumbers(config);
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
  inConsole(config, { name: "Instagram", key: "instagram", own: "account", test: "account" });

async function inConsole(config, channel) {
  const status = await deployClient(config, config.resolveWorkspaceRequired()).deployStatus();
  const url = status[`${channel.key}_url`] ?? status.integrations_url ?? `${config.resolveBaseUrl()}/workspaces`;
  // An older server sends no `published`; a live deployment means the same.
  const published = status.published ?? Boolean(status.live);

  if (published) {
    console.log(`Connect your own ${channel.own} and manage test ${channel.test}s in the console:`);
  } else {
    console.log(`Test ${channel.name} on the console's Test page: verify your ${channel.test} there and talk to your agent.`);
  }
  console.log(`  ${url}`);
}

async function setAgentNumbers(config, numbers) {
  const client = deployClient(config, config.resolveWorkspaceRequired());
  printAnswers(await client.updateWhatsapp({ agent_numbers: numbers }));
}

// After the console link: a workspace with no number of its own has nothing
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
  const live = number.live ? paint("green", "live") : paint("cyan", "paused: Live is off in the console");
  console.log(`\n${number.display_phone_number ?? "Your number"}: ${live}`);
  if (list.length === 0) {
    console.log("  The agent answers everyone. To answer only some numbers: vatio whatsapp only +56912345678");
    return;
  }
  console.log(`  The agent answers only: ${list.join(", ")}`);
  console.log("  Everyone else's messages reach the inbox unanswered; your routines' numbers always count.");
  console.log("  Back to everyone: vatio whatsapp everyone");
}
