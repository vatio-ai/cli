// "A new release of vatio is available", after a command, the way gh does it.
//
// The registry is asked at most once a day and the answer is kept in
// ~/.vatio/update-check.json, so only the run that refreshes it makes a
// request -- and that request runs alongside the command, not before it.
// Nothing prints unless stderr is a terminal: a pipe, CI, or `vatio mcp`
// (whose children write to a pipe) never sees it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configHome } from "./config.mjs";
import { VERSION } from "./version.mjs";
import { paint } from "./support.mjs";

const PACKAGE = "@vatio-ai/cli";
const LATEST_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_500;
const SKIPPED_COMMANDS = ["mcp", "version", "--version", "-v"];

export function startUpdateCheck(command) {
  if (!shouldCheck(command)) return null;

  const path = join(configHome(), "update-check.json");
  const cached = readState(path);
  if (cached && Date.now() - Date.parse(cached.checked_at) < CHECK_EVERY_MS) {
    return Promise.resolve(cached.latest);
  }
  return fetchLatest().then((latest) => {
    if (latest) writeState(path, { checked_at: new Date().toISOString(), latest });
    return latest ?? cached?.latest ?? null;
  });
}

export async function printUpdateNotice(check) {
  if (!check) return;
  const latest = await check.catch(() => null);
  if (!latest || !isNewer(latest, VERSION)) return;

  // npx sets npm_command=exec; a global install has no npm around it at all.
  const upgrade = process.env.npm_command === "exec"
    ? `npx ${PACKAGE}@latest`
    : `npm install -g ${PACKAGE}@latest`;
  process.stderr.write(
    `\n${paint("yellow", `A new release of vatio is available: ${VERSION} → ${latest}`)}\n` +
    `To upgrade, run: ${upgrade}\n` +
    `${paint("cyan", "https://docs.vatio.ai/changelog")}\n`
  );
}

function shouldCheck(command) {
  if (SKIPPED_COMMANDS.includes(command)) return false;
  if (!process.stderr.isTTY) return false;
  if (process.env.CI || process.env.VATIO_NO_UPDATE_NOTIFIER) return false;
  return true;
}

async function fetchLatest() {
  try {
    const response = await fetch(LATEST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const version = (await response.json())?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function readState(path) {
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return typeof state?.latest === "string" && typeof state?.checked_at === "string" ? state : null;
  } catch {
    return null;
  }
}

function writeState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state)}\n`);
  } catch {
    // A read-only home only means the next run asks the registry again.
  }
}

// Plain x.y.z; a prerelease on either side is never announced.
function isNewer(candidate, current) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
