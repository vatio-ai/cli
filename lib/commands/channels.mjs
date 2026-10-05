// whatsapp / instagram -- both are set up in the console now: connecting your
// own number or account needs Meta's consent screen, and test phones and
// accounts are a form with a code. The CLI only says where, and that depends
// on whether the workspace has published: before, only the Test page is in the
// console's sidebar; after, the channel's own page under Integrations.

import { deployClient } from "./deploy.mjs";

export const whatsapp = (config) =>
  inConsole(config, { name: "WhatsApp", key: "whatsapp", own: "number", test: "phone" });
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
