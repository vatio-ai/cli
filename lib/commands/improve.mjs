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
  return await runTests(config, args, { name: "test", waitByDefault: false });
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
    console.log("No reports to test yet. Report a reply in the inbox and write what it should have said.");
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
