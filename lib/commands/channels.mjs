// whatsapp / instagram -- both are set up in the console now: connecting your
// own number or account needs Meta's consent screen, and test phones and
// accounts are a form with a code. The CLI only says where.

import { deployClient } from "./deploy.mjs";

export const whatsapp = (config) => inConsole(config, "WhatsApp");
export const instagram = (config) => inConsole(config, "Instagram");

async function inConsole(config, channel) {
  const status = await deployClient(config, config.resolveWorkspaceRequired()).deployStatus();
  const url = status.integrations_url ?? `${config.resolveBaseUrl()}/workspaces`;
  console.log(`${channel} is set up in the console: your own account, and the test phones and`);
  console.log("accounts that reach a preview or a branch.");
  console.log(`  ${url}`);
}
