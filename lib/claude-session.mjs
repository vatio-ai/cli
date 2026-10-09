// The coding agent's own session, as Claude Code keeps it on this machine: one
// JSONL file per session under ~/.claude/projects/<dir>/<session id>.jsonl,
// where <dir> is the directory it was started in with every character that is
// not a letter or a digit turned into "-".
//
// The format is Claude Code's and changes between its releases, so nothing
// here depends on more of it than it has to: a line is kept or dropped by its
// `type`, and everything a kept line carries is passed through as it is.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// What the agent and the developer said and did. Everything else in the file
// is Claude Code's bookkeeping: costs, modes, titles, file-history snapshots.
const KEPT_TYPES = new Set(["user", "assistant", "system"]);

// A copy of what the tool_result block already says, and Claude Code's own
// wiring, each as large as the conversation itself.
const DROPPED_KEYS = ["toolUseResult", "wireToolInputs", "wireIngestContext"];

const REDACTED = "[REDACTED]";

// What a transcript most often carries that nobody meant to send: keys and
// tokens printed by a command or read from a file. A pattern can only catch
// what looks like a secret, which is why `--save` exists.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/\b(?:vat|vsk|vatsup|vda|whsec)_[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, `$1 ${REDACTED}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // KEY=value in an .env file or a shell, by the name's convention.
  [
    /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"'$]{6,})\3/g,
    `$1$2$3${REDACTED}$3`
  ],
  // "password": "…" in a JSON or YAML file.
  [
    /(["']?\b(?:password|secret|client_secret|api_key|apiKey|access_token|refresh_token|private_key)["']?\s*:\s*)(["'])([^"'\s]{6,})\2/g,
    `$1$2${REDACTED}$2`
  ]
];

export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function projectsDir() {
  return join(claudeHome(), "projects");
}

function projectKey(dir) {
  return dir.replace(/[^A-Za-z0-9]/g, "-");
}

// The sessions Claude Code kept for this directory, or for the nearest parent
// it was started in, newest first.
export function sessionsFor(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    const sessions = jsonlIn(join(projectsDir(), projectKey(dir)));
    if (sessions.length > 0) return sessions;
    const parent = dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
}

// By id, in whichever directory's folder it is: a session that moved into a
// worktree is filed under the worktree, not where the command runs.
export function sessionById(id) {
  const matches = listDir(projectsDir())
    .flatMap((dir) => jsonlIn(join(projectsDir(), dir)))
    .filter((session) => session.id.startsWith(id));
  return matches.sort((a, b) => b.modifiedAt - a.modifiedAt)[0] ?? null;
}

function jsonlIn(dir) {
  return listDir(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return { id: name.slice(0, -".jsonl".length), path, bytes: stat.size, modifiedAt: stat.mtimeMs };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// What a session is about, without cleaning it: for --list, and for picking
// the newest session that has a conversation in it.
export function describe(session) {
  let title = null;
  let firstPrompt = null;
  let messages = 0;
  let cwd = null;
  for (const entry of entries(session.path)) {
    if (entry.type === "ai-title" && entry.aiTitle) title = entry.aiTitle;
    if (entry.type === "summary" && entry.summary) title ??= entry.summary;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    messages += 1;
    cwd ??= entry.cwd ?? null;
    if (entry.type === "user" && !entry.isMeta) firstPrompt ??= promptText(entry.message?.content);
  }
  return { ...session, title: title ?? firstPrompt, messages, cwd };
}

// The session as it is sent: only what was said and done, without images,
// with anything that looks like a secret replaced and the home directory as ~.
export function clean(session) {
  const lines = [];
  const counts = { messages: 0, images: 0, redactions: 0 };
  let startedAt = null;
  let endedAt = null;
  let gitBranch = null;
  let cwd = null;

  for (const entry of entries(session.path)) {
    if (!KEPT_TYPES.has(entry.type)) continue;
    for (const key of DROPPED_KEYS) delete entry[key];

    const kept = scrub(entry, counts);
    if (entry.type !== "system") counts.messages += 1;
    if (entry.timestamp) {
      startedAt ??= entry.timestamp;
      endedAt = entry.timestamp;
    }
    gitBranch = entry.gitBranch ?? gitBranch;
    cwd ??= kept.cwd ?? null;
    lines.push(JSON.stringify(kept));
  }

  return {
    jsonl: lines.length > 0 ? `${lines.join("\n")}\n` : "",
    ...counts,
    startedAt,
    endedAt,
    gitBranch,
    cwd
  };
}

function* entries(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object") yield entry;
    } catch {
      // A line cut off while Claude Code was writing it: the session this
      // command runs in is still being written.
    }
  }
}

function scrub(value, counts) {
  if (typeof value === "string") return redact(value, counts);
  if (Array.isArray(value)) return value.map((item) => scrub(item, counts));
  if (!value || typeof value !== "object") return value;

  // Pictures and PDFs, base64 inline: screenshots of whatever was on screen.
  if (value.source?.type === "base64" && typeof value.source.data === "string") {
    counts.images += 1;
    return { type: value.type, omitted: true };
  }
  // A thinking block's signature is opaque and as long as the thinking.
  if (value.type === "thinking" && "signature" in value) {
    const { signature, ...rest } = value;
    value = rest;
  }
  if (value.type === "redacted_thinking") return { type: value.type, omitted: true };

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, counts)]));
}

const HOME = homedir();

function redact(text, counts) {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, (...match) => {
      counts.redactions += 1;
      return replacement.replace(/\$(\d)/g, (_, index) => match[Number(index)] ?? "");
    });
  }
  return HOME.length > 1 ? result.replaceAll(HOME, "~") : result;
}

function promptText(content) {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.find((block) => block?.type === "text")?.text : null;
  // Slash commands and hook output arrive as tags, not as something typed.
  if (!text || text.trimStart().startsWith("<")) return null;
  return text.replace(/\s+/g, " ").trim();
}
