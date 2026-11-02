// test / tools -- what the agent should do and what supervisors reported,
// proving a fix for it, and how the tools' backend has been answering.
//
// All print markdown, because the reader is usually a coding agent: `vatio
// test list` is the document it fixes the agent from, `vatio test` is the
// evidence that the fix worked on preview before `vatio publish` takes it
// live, and `vatio tools` is how each tool's backend has been answering, for
// the failures nobody reported.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { HttpClient, NotFoundError, throwIfOutdated } from "../http.mjs";
import { rememberedChatId } from "./chat.mjs";
import { clientHeaders } from "../telemetry.mjs";
import { fail, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";
import { printSkillsHint } from "../skills-hint.mjs";
import { takeIdentity, tokenFor } from "../visitor-identity.mjs";

const POLL_MS = 3_000;
const DEFAULT_TIMEOUT_S = 900;
// A test run's report renders every case's turn, so it is the slowest read in
// the CLI; a flags document is the same shape.
const MARKDOWN_TIMEOUT_MS = 60_000;

function workspaceBase(config) {
  const base = config.resolveBaseUrl();
  const token = config.resolveToken();
  if (!token) fail(`Run \`vatio login\` first (no token in ${config.configPath})`);
  return { url: `${base}/api/v1/${config.resolveWorkspaceRequired()}`, token };
}

async function fetchMarkdown(config, path, what) {
  const { url, token } = workspaceBase(config);
  let response;
  try {
    response = await fetch(`${url}${path}`, {
      headers: { ...clientHeaders(), Accept: "text/markdown, text/plain", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MARKDOWN_TIMEOUT_MS)
    });
  } catch (error) {
    // AbortSignal.timeout rejects with a bare DOMException, which reached the
    // top as `DOMException: TimeoutError: The operation was aborted due to
    // timeout` and a stack trace: the two sessions it happened to both ended
    // there. A long report is the usual reason, and it is still on Vatio's
    // servers, so say what to run to read it.
    const reason = error?.name === "TimeoutError" ? `took longer than ${MARKDOWN_TIMEOUT_MS / 1000}s to render` : "could not be read";
    fail(`${what} ${reason}. Nothing was lost — it is on Vatio's servers. Try the same command again.`);
  }
  await throwIfOutdated(response);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const reason = body?.error?.message ?? `HTTP ${response.status}`;
    fail(`Could not read ${what} (${reason})`);
  }
  try {
    // The signal covers the body too, so a render that streams slowly aborts
    // here rather than at the call above.
    return await response.text();
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? `stopped arriving after ${MARKDOWN_TIMEOUT_MS / 1000}s` : "could not be read";
    fail(`${what} ${reason}. Nothing was lost — it is on Vatio's servers. Try the same command again.`);
  }
}

// Each tool's calls, error rate, timeouts and p50/p95 latency over a period,
// then the calls that failed with what your backend answered.
export async function tools(config, args) {
  const environment = takeEnv(args, { fallback: "live" });
  const period = takeValue(args, "--period");
  const json = takeFlag(args, "--json");
  if (args.length > 0) fail("Usage: vatio tools [--period 1h|1d|7d|30d] [--json]");

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
  return await runTests(config, args);
}

const TEST_ADD_USAGE =
  'vatio test add "QUESTION" "WHAT IT SHOULD DO" [--as-phone me|PHONE] [--as-subject ID]\n' +
  '       vatio test add "WHAT IT SHOULD DO" [--chat ID | --message ID]';

// What the agent should do when asked something, checked on every version.
// With a question, Vatio asks it in a new chat and the test is made on that
// turn; with only what it should do, on the agent's last reply in the chat
// `vatio chat` is in, or --chat's, or --message's (a reply a visitor got, or a
// report's, whose note it rewrites). The platform saves and judges it in the
// background, the way the MCP's add_test does; this waits for the verdict, so
// you know whether the test is a guard or work still to do.
async function addTest(config, args) {
  const environment = takeEnv(args, { fallback: "preview" });
  const chatId = takeValue(args, "--chat");
  const messageId = takeValue(args, "--message");
  const asPhone = takeValue(args, "--as-phone");
  const timeout = Number(takeValue(args, "--timeout") ?? 120);
  const identity = takeIdentity(args, config);
  if (args.some((arg) => arg.startsWith("--"))) fail(`Usage: ${TEST_ADD_USAGE}`);
  if (args.length > 2) {
    fail(`Put the question and what the agent should do in quotes, one argument each. Usage: ${TEST_ADD_USAGE}`);
  }
  const [first, second] = args.map((arg) => arg.trim());
  if (!first || (args.length === 2 && !second)) fail(`Usage: ${TEST_ADD_USAGE}`);

  let body;
  if (args.length === 2) {
    if (chatId || messageId) fail("A question opens its own chat: drop --chat and --message, or the question.");
    body = { question: first, should: second, environment, as_phone: asPhone, visitor_token: identity ? tokenFor(identity) : null };
  } else {
    if (asPhone || identity) fail("--as-phone and --as-subject go with a question: `vatio test add \"QUESTION\" \"WHAT IT SHOULD DO\"`.");
    if (chatId && messageId) fail(`--chat or --message, not both. Usage: ${TEST_ADD_USAGE}`);
    const target = messageId ? { message_id: messageId } : { chat_id: chatId ?? rememberedChatId(config, environment) };
    if (!target.message_id && !target.chat_id) {
      fail(`No ${environment} chat yet: \`vatio test add "QUESTION" "WHAT IT SHOULD DO"\` asks it, or pass --chat ID or --message ID.`);
    }
    body = { ...target, should: first };
  }

  const { url, token } = workspaceBase(config);
  const api = new HttpClient({ baseUrl: url, token });
  const deadline = Date.now() + timeout * 1000;
  let answer = await api.post("/evals/cases", Object.fromEntries(Object.entries(body).filter(([, value]) => value)));
  while (!answer.text) {
    if (Date.now() >= deadline) {
      fail(`Still ${answer.status} after ${timeout}s: \`vatio test list\` shows the test once it is saved.`);
    }
    await sleep(Math.max(1, Math.min(answer.check_in_seconds ?? 5, (deadline - Date.now()) / 1000)) * 1000);
    answer = await api.get("/evals/cases/lookup", { chat_id: answer.chat_id });
  }
  console.log(answer.text);
}

// What there is to fix, then the whole suite: the reports still open, each
// with its conversation and what every tool answered; the tests that fail on
// preview or that the agent answers differently each time; every test.
async function listTests(config, args) {
  const json = takeFlag(args, "--json");
  const save = takeFlag(args, "--save");
  const savePath = save ? args.shift() ?? null : null;
  if (args.length > 0) fail("Usage: vatio test list [--save [PATH] | --json]");

  if (json) {
    const { url, token } = workspaceBase(config);
    const client = new HttpClient({ baseUrl: url, token });
    const [tests, flags] = await Promise.all([client.get("/evals/cases"), client.get("/flags")]);
    process.stdout.write(`${JSON.stringify({ tests: tests.tests ?? [], flags: flags.flags ?? [] }, null, 2)}\n`);
    return;
  }

  const markdown = await fetchMarkdown(config, "/flags.md", "the tests");
  if (!save) {
    process.stdout.write(markdown);
    await printSkillsHint();
    return;
  }

  const target = resolve(savePath ?? "vatio-tests.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`Wrote ${target}. Hand it to your coding agent; re-run \`vatio test list --save\` to refresh.`);
  await printSkillsHint();
}

// A report (F-) goes with its test, for everyone, as the inbox's Remove does.
async function removeTests(config, ids) {
  if (ids.length === 0 || ids.some((id) => id.startsWith("-"))) fail("Usage: vatio test rm ID [ID...]");
  const { url, token } = workspaceBase(config);
  const client = new HttpClient({ baseUrl: url, token });
  for (const id of ids) {
    let removed;
    try {
      removed = await client.delete(`/evals/cases/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof NotFoundError) fail(error.message);
      throw error;
    }
    console.log(removed.report ? `Removed report ${removed.id} and its test.` : `Removed test ${removed.id}.`);
  }
}

async function runTests(config, args) {
  const show = takeValue(args, "--show");
  if (show) return await testShow(config, show);

  const environment = takeEnv(args, { fallback: "preview" });
  const agent = takeValue(args, "--agent");
  const wait = takeFlag(args, "--wait");
  const timeoutS = Number(takeValue(args, "--timeout") ?? DEFAULT_TIMEOUT_S);
  const identity = takeIdentity(args, config);

  const { url, token } = workspaceBase(config);
  const client = new HttpClient({ baseUrl: url, token });
  // Every case of the run replays as that visitor, signed in: what a tool
  // marked `access: private` needs to run. Vatio keeps the token only until
  // the run ends.
  const started = await client.post("/evals/runs", {
    environment,
    agent: agent ?? undefined,
    visitor_token: identity ? tokenFor(identity) : undefined
  });
  if (identity) console.error(`vatio: replaying every case signed in as ${identity.subject}`);

  for (const slug of started.missing_agents ?? []) {
    console.error(`vatio: no agent \`${slug}\` on ${environment}; its cases were skipped`);
  }
  const runs = started.runs ?? [];
  if (runs.length === 0) {
    // "No tests" and "every test was skipped" are different answers, and the
    // second one is the agent filter or an agent that is not on this
    // environment (reported above) rather than an empty suite.
    if (agent || (started.missing_agents ?? []).length > 0) {
      console.log(
        `No tests ran on ${environment}${agent ? ` for agent \`${agent}\`` : ""}. ` +
          "`vatio test list` shows the suite and which agent each case belongs to."
      );
      return;
    }
    // "Report a reply in the inbox" read as "nothing to do here" on a
    // workspace where nothing had gone wrong yet, and the suite never got
    // started. A suite is what the agent should do when asked, written down.
    console.log(
      "No tests yet, so there is nothing to replay.\n" +
        "\n" +
        "A test is what the agent should do when someone asks something:\n" +
        '  vatio test add "what a visitor would ask" "what the answer has to do"\n' +
        "\n" +
        "Then `vatio test` replays them all on every version, and a change that breaks one\n" +
        "does not reach everyone. Replies the team reports in the inbox become tests too."
    );
    return;
  }

  const total = runs.reduce((sum, run) => sum + run.cases, 0);
  console.error(`vatio: replaying ${total} case${total === 1 ? "" : "s"} on ${environment}…`);
  await printSkillsHint();
  if (!wait) {
    for (const run of runs) console.log(`Run ${run.id} (${run.agent}): vatio test --show ${run.id}`);
    console.log(
      "The runs keep going on Vatio's servers, five cases at a time. `vatio test --show RUN_ID` prints the\n" +
        "report so far; `vatio test --wait` waits for this version's runs and exits 1 if a case fails."
    );
    return;
  }
  // Said before waiting, so the id is there to read the run again later
  // however this command ends.
  for (const run of runs) console.error(`vatio: run ${run.id} (${run.agent}): vatio test --show ${run.id}`);

  const deadline = Date.now() + timeoutS * 1000;
  const finished = [];
  for (const run of runs) {
    let row = run;
    while (!row.finished) {
      if (Date.now() > deadline) fail(`Timed out after ${timeoutS}s; the run keeps going. See it with: vatio test --show ${run.id}`);
      await sleep(POLL_MS);
      row = await client.get(`/evals/runs/${run.id}`);
    }
    finished.push(row);
  }

  // The verdict first, so it is what this command exits with. A report that
  // will not render is a reading problem, and it used to decide the exit code:
  // `fetchMarkdown` failing made a run that passed exit 1, and skipped the
  // reports of every run after it.
  if (finished.some((run) => run.failed > 0)) process.exitCode = 1;

  for (const run of finished) {
    try {
      process.stdout.write(await fetchMarkdown(config, `/evals/runs/${run.id}.md`, `test run ${run.id}`));
    } catch (error) {
      console.error(`vatio: ${error.message}`);
      console.error(`vatio: run ${run.id} finished ${run.failed > 0 ? `with ${run.failed} failing` : "with every case passing"}.`);
    }
  }
}

async function testShow(config, id) {
  process.stdout.write(await fetchMarkdown(config, `/evals/runs/${encodeURIComponent(id)}.md`, `test run ${id}`));
}
