// What the CLI tells Vatio about how it is being used. The reader of this CLI
// is usually a coding agent, and the only way to learn where it gets stuck is
// to see the commands it runs, in order, and the errors it is shown.
//
// Every request says which CLI made it, which coding agent is driving it, the
// session it belongs to and the command it is part of. When a command ends,
// one event says how: the exit code, how long it took, which Vatio skills the
// project has and, on failure, what was printed. Never sent: arguments, file
// contents, secrets, or what a chat said.
//
// VATIO_TELEMETRY=0 (or DO_NOT_TRACK=1) turns all of it off except the
// User-Agent, which only says which version is calling.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { arch, homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

import { configHome } from "./config.mjs";
import { findSkills } from "./skills-hint.mjs";
import { VERSION } from "./version.mjs";

const SESSION_IDLE_MS = 30 * 60 * 1000;
const REPORT_TIMEOUT_MS = 1_500;
const MAX_MESSAGE = 2_000;

// Only words a command takes as its first argument are kept: anything else
// there is a value (`vatio chat "hola"`), and values are not sent.
const SUBCOMMANDS = {
  chat: ["show"],
  env: ["list", "rm"],
  kb: ["list", "show", "create", "rm", "write", "cat", "rm-entry", "status", "publish", "history"],
  business: ["show", "set"],
  "quiet-hours": ["show", "set", "off"],
  secrets: ["list", "set", "rm"],
  keys: ["list", "create", "origins", "revoke"],
  webhooks: ["list", "create", "test", "deliveries", "enable", "rm"],
  contacts: ["export", "delete"],
  whatsapp: ["status", "connect", "live", "check", "disconnect", "invite", "team", "templates", "failed"],
  config: ["show", "get", "set", "unset"],
  "share-session": ["--should-ask", "--never"],
  test: ["add", "list", "rm"]
};

export const USER_AGENT = `vatio-cli/${VERSION} (node ${process.version}; ${platform()} ${arch()})`;

const run = { command: null, startedAt: null };

export function telemetryEnabled() {
  const off = ["0", "false", "off", "no"];
  if (off.includes(String(process.env.VATIO_TELEMETRY ?? "").trim().toLowerCase())) return false;
  return !["1", "true"].includes(String(process.env.DO_NOT_TRACK ?? "").trim().toLowerCase());
}

// The coding agent running this CLI, from what each one sets in the
// environment of the commands it runs. VATIO_AGENT names one we do not know.
export function codingAgent() {
  const env = process.env;
  if (env.VATIO_AGENT) return String(env.VATIO_AGENT).slice(0, 64);
  if (env.CLAUDECODE) return "claude-code";
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return "cursor";
  // CODEX_THREAD_ID and CODEX_SESSION_ID are on every command Codex runs, on
  // every platform; the other two are not on Windows, where a whole session
  // of Codex's once reported as "unknown".
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_SANDBOX || env.CODEX_MANAGED_BY_NPM) return "codex";
  if (env.GEMINI_CLI) return "gemini-cli";
  if (env.REPL_ID) return "replit";
  if (env.CI) return "ci";
  if (process.stdout.isTTY) return "human";
  const parent = launcher();
  return parent ? `unknown:${parent}` : "unknown";
}

// Run from a checkout of the CLI's own source rather than an installed
// package: the Vatio team working on the CLI, whose runs are not anyone's
// usage and are left out of what the team reads.
export function fromCheckout() {
  return !fileURLToPath(import.meta.url).split(sep).includes("node_modules");
}

function reportedAgent() {
  return fromCheckout() ? "vatio-dev" : codingAgent();
}

// What started this CLI, when no coding agent said so: the first ancestor
// that is not a shell or Node itself, by its process name ("Windsurf",
// "opencode"). Nothing else about it is read.
const NOT_LAUNCHERS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "env", "node", "npm", "npx", "pnpm", "yarn", "bun", "sudo", "xargs", "timeout", "login"]);

function launcher() {
  if (platform() === "win32") return null;
  return safely(() => {
    let pid = process.ppid;
    for (let depth = 0; depth < 6 && pid > 1; depth++) {
      const out = spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 500 });
      const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(out.stdout ?? "");
      if (!match) return null;
      const name = basename(match[2]).replace(/^-/, "");
      if (!NOT_LAUNCHERS.has(name)) return name.replace(/[^\w .-]/g, "").slice(0, 40) || null;
      pid = Number(match[1]);
    }
    return null;
  });
}

// Which Vatio skills the project has, as `npx @vatio-ai/skills` or the Claude
// Code plugin left them: "copy 1.28.0", "plugin 1.28.0", or "none".
function skillsInstalled() {
  const found = safely(() => findSkills(process.cwd())) ?? [];
  const install = found.find((candidate) => candidate.kind === "plugin") ?? found[0];
  return install ? `${install.kind} ${install.version ?? "unknown"}` : "none";
}

export function isCodingAgent() {
  return !["human", "ci"].includes(codingAgent());
}

export function beginRun(command, args) {
  run.command = commandLabel(command, args);
  run.startedAt = performance.now();
  noticeOnce();
}

// Said once per machine, on stderr, before anything is sent: a coding agent
// reads it there and can pass it on, which a prompt could never do -- nobody
// is at the terminal to answer one.
function noticeOnce() {
  if (!telemetryEnabled()) return;

  const path = join(configHome(), "telemetry-notice");
  if (existsSync(path)) return;
  process.stderr.write(
    "vatio: the CLI tells Vatio how each command ended (never arguments, files or secrets),\n" +
      "so we can see where coding agents get stuck. Turn it off with VATIO_TELEMETRY=0.\n" +
      "Details: https://vatio.ai/docs/cli/workspace#telemetry\n\n"
  );
  safely(() => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${new Date().toISOString()}\n`);
  });
}

export function commandLabel(command, args = []) {
  if (!command) return "help";
  const sub = args[0];
  if (SUBCOMMANDS[command]?.includes(sub)) return `${command} ${sub}`;
  // A command the CLI does not have is kept when it is a word an agent
  // guessed (`whoami`), and not when it is a sentence or a value someone
  // passed where the command goes.
  return /^[\w@.:\/-]{1,40}$/.test(command) ? command : "unknown";
}

export function clientHeaders() {
  const headers = { "User-Agent": USER_AGENT };
  if (!telemetryEnabled()) return headers;

  headers["X-Vatio-Session"] = sessionId();
  headers["X-Vatio-Agent"] = agentHeader();
  if (run.command) headers["X-Vatio-Command"] = run.command;
  return headers;
}

// How the command ended. Awaited, but never for long and never to the point
// of failing: a CLI that hangs or errors because telemetry could not be sent
// would be worse than not knowing.
export async function reportRun(config, { exitCode, error = null }) {
  if (!telemetryEnabled() || !run.command || run.command === "feedback") return;

  await post(config, {
    kind: "run",
    command: run.command,
    exit_code: exitCode,
    duration_ms: run.startedAt == null ? undefined : Math.round(performance.now() - run.startedAt),
    skills: skillsInstalled(),
    error: error ? describeError(error) : undefined
  }).catch(() => {});
}

// `vatio feedback`: sent even with telemetry off, because running it is the
// developer (or their agent) choosing to tell us something.
export async function sendFeedback(config, message) {
  await post(config, { kind: "feedback", command: "feedback", message: message.slice(0, MAX_MESSAGE) }, { strict: true });
}

// What the developer chose to send -- `vatio feedback`, `vatio share-session` --
// says which session and coding agent it came from even with telemetry off.
export function chosenHeaders() {
  return { ...clientHeaders(), "X-Vatio-Session": sessionId(), "X-Vatio-Agent": agentHeader() };
}

// Worked out once per run: finding the launcher asks `ps`.
function agentHeader() {
  run.agent ??= reportedAgent();
  return run.agent;
}

async function post(config, body, { strict = false } = {}) {
  const token = safely(() => config.resolveToken());
  const headers = { ...(strict ? chosenHeaders() : clientHeaders()), "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${config.resolveBaseUrl()}/api/developer/v1/cli/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...body,
      workspace: safely(() => config.resolveWorkspace())
    }),
    signal: AbortSignal.timeout(strict ? 10_000 : REPORT_TIMEOUT_MS)
  });
  if (strict && !response.ok) throw new Error(`HTTP ${response.status}`);
}

function describeError(error) {
  const body = error?.body && typeof error.body === "object" ? error.body : {};
  const code = typeof body.error === "string" ? body.error : body.error?.code;
  // A bug in the CLI keeps the top of its stack: that is where it happened.
  // Everything else is a sentence the CLI chose to print, and that is the
  // sentence worth knowing.
  const expected = ["UserError", "ConfigError"].includes(error?.name) || (error && "requestId" in error);
  const message = expected
    ? String(error.message ?? "")
    : String(error?.stack ?? error).split("\n").slice(0, 6).join("\n");

  return {
    class: error?.constructor?.name ?? "Error",
    key: body.error_key ?? code ?? undefined,
    message: message.replaceAll(homedir(), "~").slice(0, MAX_MESSAGE),
    request_id: error?.requestId ?? undefined
  };
}

// One session is one stretch of work in one directory: a new id after half an
// hour without a command, so an agent coming back tomorrow is a new session,
// and two agents in two projects are two.
function sessionId() {
  if (run.sessionId) return run.sessionId;

  const path = join(configHome(), "sessions.json");
  const key = process.cwd();
  const sessions = safely(() => JSON.parse(readFileSync(path, "utf8"))) ?? {};
  const now = Date.now();
  const current = sessions[key];
  const id = current && now - Date.parse(current.last_used_at) < SESSION_IDLE_MS ? current.id : randomUUID();

  for (const [dir, session] of Object.entries(sessions)) {
    if (now - Date.parse(session.last_used_at) > SESSION_IDLE_MS) delete sessions[dir];
  }
  sessions[key] = { id, last_used_at: new Date(now).toISOString() };
  safely(() => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(sessions));
  });

  run.sessionId = id;
  return id;
}

function safely(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
