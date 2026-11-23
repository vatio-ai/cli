#!/usr/bin/env node
// The Vatio CLI is retired. This last release only says where to go instead:
// the Vatio MCP for building, the inbox for what the MCP cannot do. Every
// earlier release runs this one (the backend sends them here), so whoever
// still types `vatio` reads this.

import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const command = process.argv[2];

if (command === "version" || command === "--version" || command === "-v") {
  console.log(`vatio ${version} (retired)`);
  process.exit(0);
}

console.error(`The Vatio CLI is retired. Build and change your agent through the Vatio MCP instead.

Add the MCP:
  Claude Code     claude mcp add --transport http vatio https://vatio.ai/mcp
  In a project    npx @vatio-ai/skills
  Claude, ChatGPT, Cursor or any MCP client: add the remote server https://vatio.ai/mcp

Then ask your coding agent for what you did here: list_workspaces, get_agent,
update_agent, set_tool, write_knowledge_entry, set_schedule, chat_with_agent,
add_test, run_tests, get_status, rollback, list_conversations and the rest.

What the MCP cannot do is in the inbox, https://inbox.vatio.ai: creating a
secret key or a webhook (shown once), connecting WhatsApp or Instagram (Meta's
consent opens in a browser) and paying for a plan.

Your agent is already in Vatio: nothing to move, and vatio.yml is no longer read.
Docs: https://vatio.ai/docs/mcp`);
process.exit(command === undefined || command === "help" || command === "--help" || command === "-h" ? 0 : 1);
