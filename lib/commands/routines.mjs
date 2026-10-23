// `vatio routines` — Claude Code routines the agent can hand work to. A routine
// is the trigger and token of one on claude.ai, and the WhatsApp numbers whose
// conversations may use it; the agent gets it as a tool in the manifest
// (tools/<key>.yml with `routine: <name>`). Calling it starts the routine with
// where the conversation is, and Claude reads it with a server key
// (GET /api/server/v1/:ws/chats/:id/messages).

import { deployClient } from "./deploy.mjs";
import { askSecret, fail, paint, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";

const WAIT_INTERVAL_MS = 2_000;

const CREATE_USAGE = "vatio routines create NAME --url URL --phone NUMBER [--phone NUMBER]... [--env NAME]";
const UPDATE_USAGE = "vatio routines update ID [--name NAME] [--url URL] [--phone NUMBER]... [--new-token]";
const USAGE = `Usage: vatio routines list|create NAME …|update ID …|test ID|runs ID|enable ID|rm ID\n` +
  `       ${CREATE_USAGE}\n       ${UPDATE_USAGE}`;

// Repeatable: `--phone +56911111111 --phone +56922222222`.
function takeAll(args, name) {
  const values = [];
  for (let value = takeValue(args, name); value !== null; value = takeValue(args, name)) values.push(value);
  return values;
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
    const name = args.shift();
    if (!name || !url || phoneNumbers.length === 0 || args.length > 0) fail(`Usage: ${CREATE_USAGE}`);

    // Asked for rather than typed on the command line, where it would stay in
    // shell history; piped in works too: `op read … | vatio routines create …`.
    const token = await askSecret(`${paint("green", "?")} Paste the routine's API token (sk-ant-oat01-…): `);
    if (token === "") fail("No token given. claude.ai shows it once, when you generate it on the routine's API trigger.");

    const body = { environment, name, url, token, phone_numbers: phoneNumbers };
    const routine = await client.createRoutine(body);
    if (json) return console.log(JSON.stringify(routine, null, 2));
    console.log(`${paint("green", "✓")} Created routine #${routine.id} (${routine.name}) on ${routine.environment}`);
    printRoutine(routine);
    console.log("");
    console.log("Give the routine a secret key so it can read the conversation: vatio keys create secret --env " +
      `${routine.environment} --label ${routine.name}`);
    console.log(`Check it starts: vatio routines test ${routine.id}`);
    console.log(`Then give it to the agent: tools/${routine.name}.yml with \`routine: ${routine.name}\`, ` +
      `${routine.name} in agent.tools, and vatio push`);
    return;
  }

  if (sub === "update") {
    const name = takeValue(args, "--name");
    const url = takeValue(args, "--url");
    const phoneNumbers = takeAll(args, "--phone");
    const newToken = takeFlag(args, "--new-token");
    const id = args.shift();
    if (!id || args.length > 0) fail(`Usage: ${UPDATE_USAGE}`);

    const body = {};
    if (name !== null) body.name = name;
    if (url !== null) body.url = url;
    if (phoneNumbers.length > 0) body.phone_numbers = phoneNumbers;
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
  console.log(`    the agent can use it with: ${routine.phone_numbers.join(", ")}` +
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
