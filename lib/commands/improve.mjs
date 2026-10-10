// flags / eval / tools -- what supervisors reported, proving a fix for it, and
// how the tools' backend has been answering.
//
// All print markdown, because the reader is usually a coding agent: `vatio
// flags` is the document it fixes the agent from, `vatio eval` is the
// evidence that the fix worked on preview before `vatio publish` takes it
// live, and `vatio tools` is the console's Tools page for the failures nobody
// reported.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { HttpClient } from "../http.mjs";
import { clientHeaders } from "../telemetry.mjs";
import { fail, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";

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
    return;
  }

  const target = resolve(savePath ?? "vatio-flags.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`Wrote ${target}. Hand it to your coding agent; re-run \`vatio flags --save\` to refresh.`);
}

// Each tool's calls, error rate, timeouts and p50/p95 latency over a period,
// then the calls that failed with what your backend answered: the console's
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

// Replays every report with a note against an environment and waits for the
// judge. Exits 1 when a case fails, so it can gate CI.
export async function evalCommand(config, args) {
  const show = takeValue(args, "--show");
  if (show) return await evalShow(config, show);

  const environment = takeEnv(args, { fallback: "preview" });
  const agent = takeValue(args, "--agent");
  const noWait = takeFlag(args, "--no-wait");
  const timeoutS = Number(takeValue(args, "--timeout") ?? DEFAULT_TIMEOUT_S);

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
  if (noWait) {
    for (const run of runs) console.log(`Run ${run.id} (${run.agent}): vatio eval --show ${run.id}`);
    return;
  }

  const deadline = Date.now() + timeoutS * 1000;
  const finished = [];
  for (const run of runs) {
    let row = run;
    while (!row.finished) {
      if (Date.now() > deadline) fail(`Timed out after ${timeoutS}s; the run keeps going. See it with: vatio eval --show ${run.id}`);
      await sleep(POLL_MS);
      row = await client.get(`/evals/runs/${run.id}`);
    }
    finished.push(row);
  }

  for (const run of finished) {
    process.stdout.write(await fetchMarkdown(config, `/evals/runs/${run.id}.md`, `eval run ${run.id}`));
  }
  if (finished.some((run) => run.failed > 0)) process.exitCode = 1;
}

export async function evalShow(config, id) {
  if (!id) fail("Usage: vatio eval --show RUN_ID");
  process.stdout.write(await fetchMarkdown(config, `/evals/runs/${encodeURIComponent(id)}.md`, `eval run ${id}`));
}
