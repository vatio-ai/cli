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
import { keys, secrets, tokens } from "../lib/commands/workspace-admin.mjs";
import { templates, webhooks } from "../lib/commands/webhooks.mjs";
import { auth } from "../lib/commands/identity-key.mjs";
import { chat } from "../lib/commands/chat.mjs";
import { kb } from "../lib/commands/knowledge.mjs";
import { business } from "../lib/commands/business.mjs";
import { instagram, whatsapp } from "../lib/commands/channels.mjs";
import { docs, feedback } from "../lib/commands/support-commands.mjs";
import { evalCommand, flags, tools } from "../lib/commands/improve.mjs";
import { propose } from "../lib/commands/propose.mjs";
import { printUpdateNotice, startUpdateCheck } from "../lib/update-notice.mjs";
import { beginRun, isCodingAgent, reportRun, telemetryEnabled } from "../lib/telemetry.mjs";

// Commands that existed and are gone, answered by name rather than as
// unknown: removed from the product, or what npm does now.
const RETIRED = {
  pull: "was removed: a deployed manifest only ever comes from a push, so it could never\n" +
    "hand back anything your repository did not already have. Use `vatio diff --env live`,\n" +
    "or read the manifest at GET /api/developer/v1/:slug/manifest.",
  issue: "was removed: report a problem on the public repository it belongs to --\n" +
    "https://github.com/vatio-ai/cli/issues (or sdk, ios, ruby under github.com/vatio-ai).",
  widget: "was removed: `vatio env` prints the snippet and its token, and the look is edited on\n" +
    "the console's Widget page.",
  mcp: "was removed. Point your coding agent at `vatio docs --save` and let it run the CLI.",
  update: "is npm's job now: `npx @vatio-ai/cli@latest` always runs the current release, and\n" +
    "`npm install -g @vatio-ai/cli@latest` updates a global install."
};

const config = new Config({ startDir: process.cwd() });

async function main(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  beginRun(command, args);
  const updateCheck = startUpdateCheck(command);
  await run(command, args);
  await reportRun(config, { exitCode: process.exitCode ?? 0 });
  await printUpdateNotice(updateCheck);
}

async function run(command, args) {

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
    case "keys":
      return await keys(config, args);
    case "templates":
      return await templates(config, args);
    case "webhooks":
      return await webhooks(config, args);
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
    case "tools":
      return await tools(config, args);
    case "propose":
      return await propose(config, args);
    case "docs":
      return await docs(config, args);
    case "feedback":
      return await feedback(config, args);
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


main(process.argv).catch(async (error) => {
  printError(error);
  await reportRun(config, { exitCode: 1, error });
  process.exit(1);
});

function printError(error) {
  if (error instanceof UserError || error instanceof ConfigError) {
    console.error(error.message);
    return suggestFeedback();
  }
  if (error instanceof UnauthorizedError) {
    console.error("Authentication failed (401). Run `vatio login`.");
    return printTrailer(error);
  }
  if (error instanceof ForbiddenError) {
    console.error("Access denied (403). Your token cannot access this workspace.");
    return printTrailer(error);
  }
  if (error instanceof NotFoundError) {
    console.error(
      "Remote resource not found (404). Check the workspace slug; `vatio push` creates a missing remote automatically."
    );
    return printTrailer(error);
  }
  if (error instanceof HttpError) {
    console.error(error.message);
    return printTrailer(error);
  }
  // Anything left is a bug in this CLI rather than something the developer
  // did, so it keeps its stack: that is what makes it reportable.
  console.error(error?.stack ?? String(error));
  suggestFeedback();
}

// What the platform said to do next, and the ids that find this request in
// its logs.
function printTrailer(error) {
  const hint = error.body?.hint;
  if (hint && !(error instanceof UnauthorizedError)) console.error(`Next: ${hint}`);

  const code = error.body?.error_key ?? (typeof error.body?.error === "string" ? error.body.error : error.body?.error?.code);
  const ids = [code && `error=${code}`, error.requestId && `request_id=${error.requestId}`].filter(Boolean);
  if (ids.length > 0) console.error(ids.join(" "));
  suggestFeedback();
}

// Said to coding agents only: a person at a terminal has better ways to
// complain, and does not need the line on every typo.
function suggestFeedback() {
  if (!telemetryEnabled() || !isCodingAgent() || process.argv[2] === "feedback") return;
  console.error(
    '\nIf this has you stuck, tell the Vatio team: vatio feedback "what you were trying to do and what got in the way"'
  );
}
