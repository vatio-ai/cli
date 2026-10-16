// The coding agent's own session, as Codex keeps it on this machine: one JSONL
// file per thread under $CODEX_HOME/sessions/YYYY/MM/DD/, named
// rollout-<time>-<thread id>.jsonl, with $CODEX_HOME at ~/.codex unless it is
// set. Codex gives every command it runs the thread's id in CODEX_THREAD_ID.
// Each line is {timestamp, type, payload}; the first is the session_meta, with
// the directory the session was started in.
//
// The format is Codex's and changes between its releases, so nothing here
// depends on more of it than it has to: a line is kept or dropped by its
// `type`, and everything a kept line carries is passed through as it is.

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { redact } from "./claude-session.mjs";

// What the agent and the developer said and did, and where. Everything else is
// Codex's bookkeeping: events that repeat the items, token counts, turn
// settings, compaction summaries of items the file still holds.
const KEPT_TYPES = new Set(["session_meta", "response_item"]);

// Codex's own system prompt and tool list, as long as a conversation, and the
// opaque encrypted copies of reasoning and arguments.
const DROPPED_META_KEYS = ["base_instructions", "dynamic_tools"];
const DROPPED_KEYS = new Set(["encrypted_content", "encrypted_function_args"]);

// Reading every session's first line to find the ones for a directory is the
// slow part; the newest are the ones anyone sends.
const SCANNED = 200;

const THREAD_ID = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[0-9a-f-]+)?\.jsonl$/i;

export function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

// The sessions Codex kept for this directory, or for the nearest parent it was
// started in, newest first.
export function sessionsFor(startDir) {
  const byDir = new Map();
  for (const session of rollouts().slice(0, SCANNED)) {
    const cwd = metaOf(session.path)?.cwd;
    if (typeof cwd !== "string") continue;
    const key = dirKey(cwd);
    byDir.set(key, [...(byDir.get(key) ?? []), session]);
  }

  let dir = resolve(startDir);
  for (;;) {
    const sessions = byDir.get(dirKey(dir));
    if (sessions) return sessions;
    const parent = dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
}

export function sessionById(id) {
  return rollouts().find((session) => session.id.startsWith(id)) ?? null;
}

// What a session is about, without cleaning it: for --list, and for picking
// the newest session that has a conversation in it.
export function describe(session) {
  let firstPrompt = null;
  let messages = 0;
  let cwd = null;
  for (const line of lines(session.path)) {
    if (line.type === "session_meta") cwd ??= line.payload?.cwd ?? null;
    const item = line.type === "response_item" ? line.payload : null;
    if (item?.type !== "message" || !["user", "assistant"].includes(item.role)) continue;
    messages += 1;
    if (item.role === "user") firstPrompt ??= promptText(item.content);
  }
  return { ...session, title: firstPrompt, messages, cwd };
}

// The session as it is sent: only what was said and done, without images,
// with anything that looks like a secret, an email or a phone replaced and the
// home directory as ~.
export function clean(session) {
  const kept = [];
  const counts = { messages: 0, images: 0, redactions: 0, personal: 0 };
  let startedAt = null;
  let endedAt = null;
  let gitBranch = null;
  let cwd = null;

  for (const line of lines(session.path)) {
    if (!KEPT_TYPES.has(line.type)) continue;
    if (line.type === "session_meta" && line.payload && typeof line.payload === "object") {
      for (const key of DROPPED_META_KEYS) delete line.payload[key];
      gitBranch = line.payload.git?.branch ?? gitBranch;
    }

    const scrubbed = scrub(line, counts);
    const item = line.payload;
    if (line.type === "response_item" && item?.type === "message" && ["user", "assistant"].includes(item.role)) {
      counts.messages += 1;
    }
    if (line.timestamp) {
      startedAt ??= line.timestamp;
      endedAt = line.timestamp;
    }
    if (line.type === "session_meta") cwd ??= scrubbed.payload?.cwd ?? null;
    kept.push(JSON.stringify(scrubbed));
  }

  return {
    jsonl: kept.length > 0 ? `${kept.join("\n")}\n` : "",
    ...counts,
    startedAt,
    endedAt,
    gitBranch,
    cwd
  };
}

// Every session file, newest first. Compressed ones (.jsonl.zst) are old ones
// Codex packed away, and are left out.
function rollouts() {
  const root = join(codexHome(), "sessions");
  const files = [];
  for (const year of listDir(root)) {
    for (const month of listDir(join(root, year))) {
      for (const day of listDir(join(root, year, month))) {
        const dir = join(root, year, month, day);
        for (const name of listDir(dir)) {
          const match = THREAD_ID.exec(name);
          if (!match) continue;
          const path = join(dir, name);
          const stat = statSync(path);
          files.push({ agent: "codex", id: match[1].toLowerCase(), path, bytes: stat.size, modifiedAt: stat.mtimeMs });
        }
      }
    }
  }
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// The first line alone, which carries the system prompt and can be long, but
// never the whole file, which can be many megabytes.
function metaOf(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const chunk = Buffer.alloc(64 * 1024);
    const parts = [];
    for (let total = 0; total < 4 * 1024 * 1024; ) {
      const read = readSync(fd, chunk, 0, chunk.length, total);
      if (read === 0) break;
      const newline = chunk.subarray(0, read).indexOf(10);
      parts.push(Buffer.from(chunk.subarray(0, newline === -1 ? read : newline)));
      if (newline !== -1) break;
      total += read;
    }
    const line = JSON.parse(Buffer.concat(parts).toString("utf8"));
    return line?.type === "session_meta" ? line.payload : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function* lines(path) {
  for (const text of readFileSync(path, "utf8").split("\n")) {
    if (text.trim() === "") continue;
    try {
      const line = JSON.parse(text);
      if (line && typeof line === "object") yield line;
    } catch {
      // A line cut off while Codex was writing it: the session this command
      // runs in is still being written.
    }
  }
}

function scrub(value, counts) {
  if (typeof value === "string") return redact(value, counts);
  if (Array.isArray(value)) return value.map((item) => scrub(item, counts));
  if (!value || typeof value !== "object") return value;

  // Pictures, base64 inline in a data: URL: screenshots of whatever was on
  // screen.
  if (value.type === "input_image") {
    counts.images += 1;
    return { type: value.type, omitted: true };
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !DROPPED_KEYS.has(key))
      .map(([key, item]) => [key, scrub(item, counts)])
  );
}

// Codex puts its own context in user messages too: the environment as a tag,
// and AGENTS.md under a heading of its own.
function promptText(content) {
  const text = Array.isArray(content)
    ? content.find((block) => block?.type === "input_text")?.text
    : typeof content === "string" ? content : null;
  if (!text) return null;
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<") || trimmed.startsWith("# AGENTS.md")) return null;
  return text.replace(/\s+/g, " ").trim();
}

// Windows paths compare without case, as Windows does.
function dirKey(path) {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function listDir(dir) {
  try {
    return readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}
