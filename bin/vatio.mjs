#!/usr/bin/env node
// The Vatio CLI, as an npm package: `npx @vatio-ai/cli push`.
//
// Same platform, same API, same ~/.vatio/config.json as the Ruby CLI that
// `curl … /install.sh | bash` puts on a machine. Either can drive a workspace,
// and a developer who logged in with one is logged in for the other -- the
// credential belongs to their home directory, not to a client.
//
// This exists because Node is the runtime this audience already has and Ruby
// is the one some of them do not. Nothing about the contract moved: the
// workspace is parsed by the platform, so a client is HTTP and a terminal.

import { Config, ConfigError } from "../lib/config.mjs";
import { HttpError, UnauthorizedError, ForbiddenError, NotFoundError } from "../lib/http.mjs";
import { UserError, fail } from "../lib/support.mjs";
import { helpText } from "../lib/help.mjs";
import { login, logout } from "../lib/commands/auth.mjs";
import { configCommand, doctor, init, version } from "../lib/commands/misc.mjs";
import { diff, publish, push, rollback, status, toolsCheck } from "../lib/commands/deploy.mjs";
import { env } from "../lib/commands/env.mjs";
import { secrets, tokens, widget } from "../lib/commands/workspace-admin.mjs";
import { auth } from "../lib/commands/identity-key.mjs";
import { chat } from "../lib/commands/chat.mjs";
import { kb } from "../lib/commands/knowledge.mjs";
import { instagram, whatsapp } from "../lib/commands/channels.mjs";
import { docs, issue } from "../lib/commands/support-commands.mjs";
import { mcp } from "../lib/commands/mcp.mjs";
import { printUpdateNotice, startUpdateCheck } from "../lib/update-notice.mjs";

// Two commands that existed and are gone, answered by name rather than as
// unknown: one was removed from the product, the other is what npm does.
const RETIRED = {
  pull: "was removed: a deployed manifest only ever comes from a push, so it could never\n" +
    "hand back anything your repository did not already have. Use `vatio diff --env live`,\n" +
    "or read the manifest at GET /api/v1/:slug/deploy/manifest.",
  update: "is npm's job now: `npx @vatio-ai/cli@latest` always runs the current release, and\n" +
    "`npm install -g @vatio-ai/cli@latest` updates a global install."
};

async function main(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  const updateCheck = startUpdateCheck(command);
  await run(command, args);
  await printUpdateNotice(updateCheck);
}

async function run(command, args) {
  const config = new Config({ startDir: process.cwd() });

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      return version();
    case "doctor":
      return doctor(config);
    case "login":
      return await login(config, args);
    case "logout":
      return logout(config);
    case "config":
      return configCommand(config, args);
    case "init":
      return await init(config, args);
    case "push":
      return await push(config, args);
    case "publish":
      return await publish(config, args);
    case "rollback":
      return await rollback(config);
    case "status":
      return await status(config);
    case "env":
      return await env(config, args);
    case "diff":
      return await diff(config, args);
    case "tools":
      return await toolsCheck(config, args);
    case "tokens":
      return await tokens(config, args);
    case "widget":
      return await widget(config, args);
    case "auth":
      return await auth(config, args);
    case "chat":
      return await chat(config, args);
    case "kb":
      return await kb(config, args);
    case "secrets":
      return await secrets(config, args);
    case "whatsapp":
      return await whatsapp(config, args);
    case "instagram":
      return await instagram(config, args);
    case "docs":
      return await docs(config, args);
    case "issue":
      return await issue(config, args);
    case "mcp":
      return await mcp(config);
    case "help":
    case "-h":
    case "--help":
    case undefined:
      return console.log(helpText());
    default:
      if (RETIRED[command]) fail(`\`vatio ${command}\` ${RETIRED[command]}`);
      fail(`Unknown command: ${command}\n\n${helpText()}`);
  }
}


main(process.argv).catch((error) => {
  if (error instanceof UserError || error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  if (error instanceof UnauthorizedError) {
    console.error("Authentication failed (401). Run `vatio login`.");
    if (error.requestId) console.error(`request_id=${error.requestId}`);
    process.exit(1);
  }
  if (error instanceof ForbiddenError) {
    console.error("Access denied (403). Your token cannot access this workspace.");
    if (error.requestId) console.error(`request_id=${error.requestId}`);
    process.exit(1);
  }
  if (error instanceof NotFoundError) {
    console.error(
      "Remote resource not found (404). Check the workspace slug; `vatio push` creates a missing remote automatically."
    );
    if (error.requestId) console.error(`request_id=${error.requestId}`);
    process.exit(1);
  }
  if (error instanceof HttpError) {
    console.error(error.message);
    if (error.requestId) console.error(`request_id=${error.requestId}`);
    process.exit(1);
  }
  // Anything left is a bug in this CLI rather than something the developer
  // did, so it keeps its stack: that is what makes it reportable.
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
