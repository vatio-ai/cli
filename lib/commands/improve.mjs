// flags / test / tools -- what supervisors reported, proving a fix for it, and
// how the tools' backend has been answering.
//
// All print markdown, because the reader is usually a coding agent: `vatio
// flags` is the document it fixes the agent from, `vatio test` is the
// evidence that the fix worked on preview before `vatio publish` takes it
// live, and `vatio tools` is the inbox's Tools page for the failures nobody
// reported.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { HttpClient, NotFoundError, throwIfOutdated } from "../http.mjs";
import { rememberedChatId } from "./chat.mjs";
import { clientHeaders } from "../telemetry.mjs";
import { fail, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";
import { printSkillsHint } from "../skills-hint.mjs";

const POLL_MS = 3_000;
const DEFAULT_TIMEOUT_S = 900;

function workspaceBase(config) {
  const base = config.resolveBaseUrl();
  const token = config.resolveToken();
  if (!token) fail(`Run \`vatio login\` first (no token in ${config.configPath})`);
  return { url: `${base}/api/developer/v1/${config.resolveWorkspaceRequired()}`, token };
}

async function fetchMarkdown(config, path, what) {
  const { url, token } = workspaceBase(config);
  const response = await fetch(`${url}${path}`, {
    headers: { ...clientHeaders(), Accept: "text/markdown, text/plain", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  await throwIfOutdated(response);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const reason = body?.error?.message ?? `HTTP ${response.status}`;
    fail(`Could not read ${what} (${reason})`);
  }
  return await response.text();
}

// The open flags as one document: each flagged reply with the conversation
// before it, every tool call of that turn with what your backend answered,
// and what the supervisor says should have happened.
export async function flags(config, args) {
  if (args[0] === "add") return await addFlag(config, args.slice(1));
  if (["rm", "remove", "delete"].includes(args[0])) return await removeFlags(config, args.slice(1));

  const json = takeFlag(args, "--json");
  const save = takeFlag(args, "--save");
  const savePath = save ? args.shift() ?? null : null;

  if (json) {
    const { url, token } = workspaceBase(config);
    const body = await new HttpClient({ baseUrl: url, token }).get("/flags");
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }

  const markdown = await fetchMarkdown(config, "/flags.md", "the flags");
  if (!save) {
    process.stdout.write(markdown);
    await printSkillsHint();
    return;
  }

  const target = resolve(savePath ?? "vatio-flags.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`Wrote ${target}. Hand it to your coding agent; re-run \`vatio flags --save\` to refresh.`);
  await printSkillsHint();
}

const ADD_USAGE = 'vatio flags add "WHAT IT SHOULD DO" [--chat ID | --message ID] [--env NAME]';

// The reply `vatio flags add` reports and `vatio test add` keeps: the agent's
// last one in the chat `vatio chat` is in, or --chat's, or --message.
function replyTarget(config, args, usage) {
  const environment = takeEnv(args, { fallback: "preview" });
  const chatId = takeValue(args, "--chat");
  const messageId = takeValue(args, "--message");
  const note = args.join(" ").trim();
  if (note === "" || args.some((arg) => arg.startsWith("--"))) fail(`Usage: ${usage}`);
  if (chatId && messageId) fail(`--chat or --message, not both. Usage: ${usage}`);

  const target = messageId ? { message_id: messageId } : { chat_id: chatId ?? rememberedChatId(config, environment) };
  if (!target.message_id && !target.chat_id) {
    fail(`No ${environment} chat yet: run \`vatio chat "hello"\` first, or pass --chat ID or --message ID.`);
  }
  return { ...target, note };
}

// What the inbox's Reportar does, from the terminal: a reply that was wrong,
// and what it should have done. The note makes it a test case. A reply that
// is already right is not a report: `vatio test add` keeps it.
async function addFlag(config, args) {
  if (args.includes("--passes")) {
    fail('A reply that is already right is a test, not a report: `vatio test add "WHAT IT SHOULD DO"` keeps it.');
  }
  const body = replyTarget(config, args, ADD_USAGE);

  const { url, token } = workspaceBase(config);
  let flag;
  try {
    flag = await new HttpClient({ baseUrl: url, token }).post("/flags", body);
  } catch (error) {
    // The platform's own words name the chat or message and where to find the right one.
    if (error instanceof NotFoundError) fail(error.message);
    throw error;
  }

  const reply = String(flag.reply ?? "").trim().replace(/\s+/g, " ");
  console.log(`${flag.rewritten ? "Rewrote" : "Reported"} ${flag.public_id}, chat ${flag.chat_id} on ${flag.environment}:`);
  console.log(`  [agent #${flag.message_id}] ${reply.length > 200 ? `${reply.slice(0, 200)}…` : reply}`);
  if (flag.test_case) {
    console.log("It is a test case now: `vatio test` replays it, `vatio flags` lists it, `vatio flags rm` removes it.");
  } else {
    console.log("No visitor message comes before that reply, so there is nothing to replay: it is not a test case.");
  }
}

// What the inbox's Quitar does, by the ids `vatio flags` prints: the flag and
// its test case go, for everyone in the workspace. The developer's call, not
// the coding agent's: the vatio-improve skill says to run it only when asked.
async function removeFlags(config, ids) {
  if (ids.length === 0 || ids.some((id) => id.startsWith("-"))) fail("Usage: vatio flags rm ID [ID...]");

  const { url, token } = workspaceBase(config);
  const client = new HttpClient({ baseUrl: url, token });
  for (const id of ids) {
    let removed;
    try {
      removed = await client.delete(`/flags/${encodeURIComponent(id)}`);
    } catch (error) {
      // The platform's own words name the id and where to find the right one.
      if (error instanceof NotFoundError) fail(error.message);
      throw error;
    }
    const was = removed.state === "resolved" ? "a resolved flag, so no longer a regression case" : "an open flag";
    console.log(`Removed ${removed.id} (${was}) and its test case.`);
  }
}

// Each tool's calls, error rate, timeouts and p50/p95 latency over a period,
// then the calls that failed with what your backend answered: the inbox's
// Tools page.
export async function tools(config, args) {
  const environment = takeEnv(args, { fallback: "live" });
  const period = takeValue(args, "--period");
  const json = takeFlag(args, "--json");
  if (args.length > 0) fail("Usage: vatio tools [--env NAME] [--period 1h|1d|7d|30d] [--json]");

  if (json) {
    const { url, token } = workspaceBase(config);
    const body = await new HttpClient({ baseUrl: url, token }).get("/tools", { environment, period });
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }

  const query = new URLSearchParams({ environment, ...(period ? { period } : {}) });
  process.stdout.write(await fetchMarkdown(config, `/tools.md?${query}`, "the tools"));
}

// Replays every report with a note against an environment. Starts the runs
// and returns: a run takes minutes, and a command that sat waiting for it was
// one a coding agent had to remember to put in the background. `--wait` waits
// for the judge and exits 1 when a case fails, so it can gate CI.
export async function test(config, args) {
  if (args[0] === "add") return await addTest(config, args.slice(1));
  if (args[0] === "list") return await listTests(config, args.slice(1));
  if (["rm", "remove", "delete"].includes(args[0])) return await removeTests(config, args.slice(1));
  return await runTests(config, args, { name: "test", waitByDefault: false });
}

const TEST_ADD_USAGE = 'vatio test add "WHAT IT SHOULD DO" [--chat ID | --message ID] [--env NAME]';

// A reply that is right, kept as a test so it stays right: a photo of its
// turn, like a report's case, with no report for Vatio to triage or fix. A
// set of `vatio chat --new` + `vatio test add` is a test suite.
async function addTest(config, args) {
  const body = replyTarget(config, args, TEST_ADD_USAGE);
  const { url, token } = workspaceBase(config);
  let added;
  try {
    added = await new HttpClient({ baseUrl: url, token }).post("/evals/cases", body);
  } catch (error) {
    if (error instanceof NotFoundError) fail(error.message);
    throw error;
  }
  console.log(`${added.rewritten ? "Rewrote" : "Added"} test ${added.id} (agent \`${added.agent}\`, chat ${added.chat_id}):`);
  console.log(`  Visitor: ${String(added.asked ?? "").trim().replace(/\s+/g, " ").slice(0, 200)}`);
  console.log(`  Should: ${added.note}`);
  console.log(
    "`vatio test` replays its turn on every version; once live passes it, `vatio publish` refuses a version that fails it."
  );
}

async function listTests(config, args) {
  const json = takeFlag(args, "--json");
  if (args.length > 0) fail("Usage: vatio test list [--json]");
  const { url, token } = workspaceBase(config);
  const body = await new HttpClient({ baseUrl: url, token }).get("/evals/cases");
  if (json) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  const tests = body.tests ?? [];
  if (tests.length === 0) {
    console.log('No tests yet. `vatio chat --new "..."`, then `vatio test add "WHAT IT SHOULD DO"` keeps a reply that is right.');
    return;
  }
  for (const row of tests) {
    console.log(`${row.id}  ${row.agent}  ${String(row.asked ?? "").trim().replace(/\s+/g, " ").slice(0, 80)}`);
    console.log(`         should: ${row.note}`);
  }
  console.log("Reports are tests too: `vatio flags` lists the open ones.");
}

async function removeTests(config, ids) {
  if (ids.length === 0 || ids.some((id) => id.startsWith("-"))) fail("Usage: vatio test rm ID [ID...]");
  const { url, token } = workspaceBase(config);
  const client = new HttpClient({ baseUrl: url, token });
  for (const id of ids) {
    try {
      await client.delete(`/evals/cases/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof NotFoundError) fail(error.message);
      throw error;
    }
    console.log(`Removed test ${id.toUpperCase()}.`);
  }
}

// What `vatio test` was called until 0.81.0. Kept, waiting as it always did,
// for the CI jobs and older skills that still call it; the name also reads as
// the shell's eval to command guards, which refused it.
export async function evalCommand(config, args) {
  console.error("vatio: `vatio eval` is deprecated; use `vatio test --wait` (or `vatio test` to start the run and return).");
  return await runTests(config, args, { name: "eval", waitByDefault: true });
}

async function runTests(config, args, { name, waitByDefault }) {
  const show = takeValue(args, "--show");
  if (show) return await testShow(config, show);

  const environment = takeEnv(args, { fallback: "preview" });
  const agent = takeValue(args, "--agent");
  const wait = takeFlag(args, "--wait");
  const noWait = takeFlag(args, "--no-wait");
  const timeoutS = Number(takeValue(args, "--timeout") ?? DEFAULT_TIMEOUT_S);
  const waiting = wait || (waitByDefault && !noWait);

  const { url, token } = workspaceBase(config);
  const client = new HttpClient({ baseUrl: url, token });
  const started = await client.post("/evals/runs", { environment, agent: agent ?? undefined });

  for (const slug of started.missing_agents ?? []) {
    console.error(`vatio: no agent \`${slug}\` on ${environment}; its cases were skipped`);
  }
  const runs = started.runs ?? [];
  if (runs.length === 0) {
    console.log(
      "No reports to test yet. Report a reply in the inbox, or after a `vatio chat` with\n" +
        '`vatio flags add "what it should have done"`.'
    );
    return;
  }

  const total = runs.reduce((sum, run) => sum + run.cases, 0);
  console.error(`vatio: replaying ${total} case${total === 1 ? "" : "s"} on ${environment}…`);
  await printSkillsHint();
  if (!waiting) {
    for (const run of runs) console.log(`Run ${run.id} (${run.agent}): vatio ${name} --show ${run.id}`);
    if (name === "test") {
      console.log(
        "The runs keep going on Vatio's servers, five cases at a time. `vatio test --show RUN_ID` prints the\n" +
          "report so far; `vatio test --wait` waits for this version's runs and exits 1 if a case fails."
      );
    }
    return;
  }
  // Said before waiting, so the id is there to read the run again later
  // however this command ends.
  for (const run of runs) console.error(`vatio: run ${run.id} (${run.agent}): vatio ${name} --show ${run.id}`);

  const deadline = Date.now() + timeoutS * 1000;
  const finished = [];
  for (const run of runs) {
    let row = run;
    while (!row.finished) {
      if (Date.now() > deadline) fail(`Timed out after ${timeoutS}s; the run keeps going. See it with: vatio ${name} --show ${run.id}`);
      await sleep(POLL_MS);
      row = await client.get(`/evals/runs/${run.id}`);
    }
    finished.push(row);
  }

  for (const run of finished) {
    process.stdout.write(await fetchMarkdown(config, `/evals/runs/${run.id}.md`, `test run ${run.id}`));
  }
  if (finished.some((run) => run.failed > 0)) process.exitCode = 1;
}

async function testShow(config, id) {
  process.stdout.write(await fetchMarkdown(config, `/evals/runs/${encodeURIComponent(id)}.md`, `test run ${id}`));
}
