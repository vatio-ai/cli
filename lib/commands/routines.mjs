// `vatio routines` — Claude Code routines that a WhatsApp number starts. When
// one of a routine's numbers writes to the workspace, Vatio waits for them to
// finish and calls the routine's API trigger with where the conversation is;
// Claude reads it with a server key (GET /api/server/v1/:ws/chats/:id/messages).

import { deployClient } from "./deploy.mjs";
import { askSecret, fail, paint, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";

const WAIT_INTERVAL_MS = 2_000;

const CREATE_USAGE = "vatio routines create NAME --url URL --phone NUMBER [--phone NUMBER]... " +
  "[--quiet SECONDS] [--env NAME]";
const UPDATE_USAGE = "vatio routines update ID [--name NAME] [--url URL] [--phone NUMBER]... [--new-token] " +
  "[--quiet SECONDS]";
const USAGE = `Usage: vatio routines list|create NAME …|update ID …|test ID|runs ID|enable ID|rm ID\n` +
  `       ${CREATE_USAGE}\n       ${UPDATE_USAGE}`;

// Repeatable: `--phone +56911111111 --phone +56922222222`.
function takeAll(args, name) {
  const values = [];
  for (let value = takeValue(args, name); value !== null; value = takeValue(args, name)) values.push(value);
  return values;
}

function takeQuiet(args) {
  const raw = takeValue(args, "--quiet");
  if (raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds)) fail("--quiet is a whole number of seconds, between 5 and 600");
  return seconds;
}

export async function routines(config, args) {
  const json = takeFlag(args, "--json");
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    const { routines: list = [] } = await client.listRoutines();
    if (json) return console.log(JSON.stringify(list, null, 2));
    if (list.length === 0) {
      console.log(`No routines on workspace ${workspace}`);
      console.log("  Add one: vatio routines create encargos --url https://api.anthropic.com/v1/claude_code/routines/trig_…/fire " +
        "--phone +56912345678");
      return;
    }
    console.log(`Routines on workspace ${workspace} (${list.length}):`);
    for (const routine of list) printRoutine(routine);
    return;
  }

  if (sub === "create") {
    const environment = takeEnv(args, { fallback: "live" });
    const url = takeValue(args, "--url");
    const phoneNumbers = takeAll(args, "--phone");
    const quiet = takeQuiet(args);
    const name = args.shift();
    if (!name || !url || phoneNumbers.length === 0 || args.length > 0) fail(`Usage: ${CREATE_USAGE}`);

    // Asked for rather than typed on the command line, where it would stay in
    // shell history; piped in works too: `op read … | vatio routines create …`.
    const token = await askSecret(`${paint("green", "?")} Paste the routine's API token (sk-ant-oat01-…): `);
    if (token === "") fail("No token given. claude.ai shows it once, when you generate it on the routine's API trigger.");

    const body = { environment, name, url, token, phone_numbers: phoneNumbers };
    if (quiet !== null) body.quiet_seconds = quiet;
    const routine = await client.createRoutine(body);
    if (json) return console.log(JSON.stringify(routine, null, 2));
    console.log(`${paint("green", "✓")} Created routine #${routine.id} (${routine.name}) on ${routine.environment}`);
    printRoutine(routine);
    console.log("");
    console.log("Give the routine a server key so it can read the conversation: vatio keys create --env " +
      `${routine.environment} --label ${routine.name}`);
    console.log(`Then check it starts: vatio routines test ${routine.id}`);
    return;
  }

  if (sub === "update") {
    const name = takeValue(args, "--name");
    const url = takeValue(args, "--url");
    const phoneNumbers = takeAll(args, "--phone");
    const newToken = takeFlag(args, "--new-token");
    const quiet = takeQuiet(args);
    const id = args.shift();
    if (!id || args.length > 0) fail(`Usage: ${UPDATE_USAGE}`);

    const body = {};
    if (name !== null) body.name = name;
    if (url !== null) body.url = url;
    if (phoneNumbers.length > 0) body.phone_numbers = phoneNumbers;
    if (quiet !== null) body.quiet_seconds = quiet;
    if (newToken) {
      body.token = await askSecret(`${paint("green", "?")} Paste the new API token: `);
      if (body.token === "") fail("No token given");
    }
    if (Object.keys(body).length === 0) fail(`Nothing to change. ${UPDATE_USAGE}`);

    const routine = await client.updateRoutine({ id, ...body });
    if (json) return console.log(JSON.stringify(routine, null, 2));
    console.log(`${paint("green", "✓")} Updated routine #${routine.id}`);
    printRoutine(routine);
    return;
  }

  if (sub === "test") {
    const id = args.shift();
    if (!id) fail("Usage: vatio routines test ID");
    const run = await client.testRoutine({ id });
    console.log(`Fired a ping (run #${run.id}). It starts a real Claude session; the routine's prompt decides what a ping does.`);
    const deadline = Date.now() + 30_000;
    for (;;) {
      await sleep(WAIT_INTERVAL_MS);
      const { runs: list = [] } = await client.listRoutineRuns({ id });
      const current = list.find((entry) => entry.id === run.id);
      if (current && current.status !== "pending") {
        printRun(current);
        return;
      }
      if (Date.now() > deadline) {
        console.log(`No answer yet. Check later with: vatio routines runs ${id}`);
        return;
      }
    }
  }

  if (sub === "runs") {
    const id = args.shift();
    if (!id) fail("Usage: vatio routines runs ID");
    const { runs: list = [] } = await client.listRoutineRuns({ id });
    if (json) return console.log(JSON.stringify(list, null, 2));
    if (list.length === 0) {
      console.log("No runs yet.");
      return;
    }
    for (const run of list) printRun(run);
    return;
  }

  if (sub === "enable") {
    const id = args.shift();
    if (!id) fail("Usage: vatio routines enable ID");
    await client.updateRoutine({ id, enabled: true });
    console.log(`Enabled routine #${id}`);
    return;
  }

  if (sub === "rm" || sub === "remove" || sub === "delete") {
    const id = args.shift();
    if (!id) fail("Usage: vatio routines rm ID");
    await client.deleteRoutine({ id });
    console.log(`Removed routine #${id}`);
    return;
  }

  fail(USAGE);
}

function printRoutine(routine) {
  const state = routine.enabled ? paint("green", "enabled") : paint("red", "disabled");
  console.log(`  #${routine.id}  ${routine.name}  ${routine.environment}  ${state}`);
  console.log(`    numbers: ${routine.phone_numbers.join(", ")}`);
  console.log(`    waits ${routine.quiet_seconds}s after the last message, then fires and the agent answers` +
    (routine.consecutive_failures > 0 ? `   failing: ${routine.consecutive_failures} in a row` : ""));
}

function printRun(run) {
  const status = run.status === "fired"
    ? paint("green", "fired")
    : run.status === "failed" ? paint("red", "failed") : paint("cyan", "pending");
  const http = run.response_status ? ` HTTP ${run.response_status}` : "";
  const chat = run.chat_id ? `  chat ${run.chat_id}` : "";
  console.log(`  #${run.id}  ${run.event}  ${status}${http}${chat}  attempts ${run.attempts}  ${run.created_at}`);
  if (run.session_url) console.log(`    ${run.session_url}`);
  if (run.last_error) console.log(`    ${paint("red", run.last_error)}`);
}
