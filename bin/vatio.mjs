#!/usr/bin/env node
// The Vatio CLI, as an npm package: `npx @vatio-ai/cli push`.
//
// The workspace is parsed by the platform, so a client is HTTP and a
// terminal; the credential lives in ~/.vatio/config.json.

import { Config, ConfigError } from "../lib/config.mjs";
import { HttpError, UnauthorizedError, ForbiddenError, NotFoundError } from "../lib/http.mjs";
import { UserError, fail } from "../lib/support.mjs";
import { helpText } from "../lib/help.mjs";
import { login, logout } from "../lib/commands/auth.mjs";
import { configCommand, doctor, init, version } from "../lib/commands/misc.mjs";
import { diff, publish, push, rollback, status } from "../lib/commands/deploy.mjs";
import { env } from "../lib/commands/env.mjs";
import { secrets, tokens } from "../lib/commands/workspace-admin.mjs";
import { auth } from "../lib/commands/identity-key.mjs";
import { chat } from "../lib/commands/chat.mjs";
import { kb } from "../lib/commands/knowledge.mjs";
import { business } from "../lib/commands/business.mjs";
import { instagram, whatsapp } from "../lib/commands/channels.mjs";
import { docs } from "../lib/commands/support-commands.mjs";
import { evalCommand, flags } from "../lib/commands/improve.mjs";
import { printUpdateNotice, startUpdateCheck } from "../lib/update-notice.mjs";

// Commands that existed and are gone, answered by name rather than as
// unknown: removed from the product, or what npm does now.
const RETIRED = {
  pull: "was removed: a deployed manifest only ever comes from a push, so it could never\n" +
    "hand back anything your repository did not already have. Use `vatio diff --env live`,\n" +
    "or read the manifest at GET /api/developer/v1/:slug/manifest.",
  issue: "was removed: report a problem on the public repository it belongs to --\n" +
    "https://github.com/vatio-ai/cli/issues (or sdk, ios, ruby under github.com/vatio-ai).",
  tools: "was removed: `vatio push` validates before it deploys, and `vatio diff` validates\n" +
    "without deploying.",
  widget: "was removed: `vatio env` prints the snippet and its token, and the look is edited on\n" +
    "the console's Widget page.",
  mcp: "was removed. Point your coding agent at `vatio docs --save` and let it run the CLI.",
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
    case "tokens":
      return await tokens(config, args);
    case "auth":
      return await auth(config, args);
    case "chat":
      return await chat(config, args);
    case "kb":
      return await kb(config, args);
    case "business":
      return await business(config, args);
    case "secrets":
      return await secrets(config, args);
    case "whatsapp":
      return await whatsapp(config, args);
    case "instagram":
      return await instagram(config, args);
    case "flags":
      return await flags(config, args);
    case "eval":
      return await evalCommand(config, args);
    case "docs":
      return await docs(config, args);
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
