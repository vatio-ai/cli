// docs, feedback and share-session — the commands that are about Vatio rather
// than about a deployment.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { clean, describe, sessionById, sessionsFor } from "../claude-session.mjs";
import { configHome } from "../config.mjs";
import { ask, fail, takeFlag, takeValue } from "../support.mjs";
import { chosenHeaders, clientHeaders, sendFeedback, telemetryEnabled } from "../telemetry.mjs";
import { ensureAuthorized } from "./deploy.mjs";
import { DOCS_URL } from "./misc.mjs";

// The whole developer contract as markdown, live from the platform. Fetched
// rather than bundled: the docs describe the deploy you are talking to, and a
// copy shipped inside this package would start lying the day either moves.
export async function docs(config, args) {
  const save = takeFlag(args, "--save");
  const savePath = takeValue(args, "--save-to") ?? (save ? args.shift() ?? null : null);

  const baseUrl = config.resolveBaseUrl();
  let markdown;
  try {
    const response = await fetch(`${baseUrl}/docs.md`, {
      headers: { ...clientHeaders(), Accept: "text/markdown, text/plain" },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    markdown = await response.text();
  } catch (error) {
    fail(`Could not fetch the docs: ${error.message}\nRead them at ${DOCS_URL} instead.`);
  }

  if (!save) {
    process.stdout.write(markdown);
    return;
  }

  const target = resolve(savePath ?? "vatio-docs.md");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`Wrote ${target} (${markdown.split("\n").length} lines, from ${baseUrl})`);
  console.log("Point your coding agent at it, and re-run `vatio docs --save` to refresh.");
}

// What got in the way, in the words of whoever hit it -- usually a coding agent
// that just spent ten commands on something the docs should have said. It goes
// to the Vatio team with the commands that came before it in this session.
export async function feedback(config, args) {
  let message = args.join(" ").trim();
  if (message === "" && !process.stdin.isTTY) message = (await readStdin()).trim();
  if (message === "") {
    fail(
      'Say what you were trying to do and what got in the way:\n\n' +
        '  vatio feedback "I ran push twice because the error did not say which field was wrong"'
    );
  }

  try {
    await sendFeedback(config, message);
  } catch (error) {
    fail(`Could not send it: ${error.message}. Open an issue at https://github.com/vatio-ai/cli/issues instead.`);
  }
  console.log("Sent to the Vatio team, with the commands this session ran before it. Thank you.");
}

// The coding agent's whole session, for when a sentence is not enough: the
// team reads what the agent read, ran and was told, and where it went wrong.
// It is the developer's conversation, so nothing leaves without them seeing
// what it is and saying yes -- at a terminal by answering, and from a coding
// agent by it asking them and passing --yes. The session goes on its own;
// feedback in the developer's words rides along when they give some.
export async function shareSession(config, args) {
  const list = takeFlag(args, "--list");
  const yes = takeFlag(args, "--yes") || takeFlag(args, "-y");
  const id = takeValue(args, "--id");
  const savePath = takeValue(args, "--save");
  const shouldAsk = takeFlag(args, "--should-ask");
  const never = takeFlag(args, "--never");
  let feedback = args.join(" ").trim();

  if (list) return listSessions();
  if (shouldAsk) return answerShouldAsk();
  if (never) return stopOffering();

  const session = findSession(id);
  const transcript = clean(session);
  if (transcript.messages === 0) fail(`Session ${short(session.id)} has no messages yet.`);
  const gzipped = gzipSync(transcript.jsonl);

  const { title } = describe(session);
  console.log(`Claude Code session ${short(session.id)}${title ? ` — ${truncate(title, 70)}` : ""}`);
  console.log(`  ${tilde(transcript.cwd ?? process.cwd())}${transcript.gitBranch ? ` (${transcript.gitBranch})` : ""}`);
  console.log(`  ${transcript.messages} messages, ${when(transcript.startedAt)} → ${when(transcript.endedAt)}`);
  console.log(`  ${size(Buffer.byteLength(transcript.jsonl))}, ${size(gzipped.length)} compressed`);
  console.log(
    `  Left out: ${transcript.images > 0 ? `${transcript.images} image(s) and ` : ""}Claude Code's own bookkeeping.` +
      (transcript.redactions > 0 ? ` ${transcript.redactions} thing(s) that looked like a key, token or password are [REDACTED].` : "")
  );

  if (savePath) {
    const target = resolve(savePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, transcript.jsonl);
    console.log(`\nWrote ${target}: exactly what would be sent. Nothing was sent.`);
    return;
  }

  console.log("\nOnly the Vatio team reads it, to see where you and your coding agent got stuck.");
  if (!yes) {
    if (!process.stdin.isTTY) {
      fail(
        "Not sent: this is the whole conversation. Ask the person you work for, and whether they want to\n" +
          'add feedback in their own words, then run it again with --yes ["FEEDBACK"]\n' +
          "(--save FILE writes what would be sent, if they want to read it first)."
      );
    }
    const answer = (await ask("Send it? [y/N] ")).toLowerCase();
    if (!["y", "yes", "s", "si", "sí"].includes(answer)) {
      console.log("Not sent.");
      return;
    }
    if (!feedback) feedback = await ask("Feedback for the Vatio team, if you have any (Enter to skip): ");
  }

  await ensureAuthorized(config, { message: "Before I can send this, I need to know who it is from." });

  const form = new FormData();
  form.set("transcript", new Blob([gzipped], { type: "application/gzip" }), `${session.id}.jsonl.gz`);
  form.set("source", "claude-code");
  form.set("source_session_id", session.id);
  form.set("messages", String(transcript.messages));
  if (transcript.startedAt) form.set("started_at", transcript.startedAt);
  if (transcript.endedAt) form.set("ended_at", transcript.endedAt);
  if (feedback) form.set("feedback", feedback);
  const workspace = config.resolveWorkspace();
  if (workspace) form.set("workspace", workspace);

  let response;
  try {
    response = await fetch(`${config.resolveBaseUrl()}/api/developer/v1/cli/transcripts`, {
      method: "POST",
      headers: { ...chosenHeaders(), Authorization: `Bearer ${config.resolveToken()}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    fail(`Could not send it: ${error?.cause?.code ?? error.message}. Try again in a moment.`);
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) fail("Your sign-in has expired. Run `vatio login`, then this again.");
  if (!response.ok) fail(`Could not send it: ${body.error_description ?? `HTTP ${response.status}`}`);

  console.log(`Sent to the Vatio team (#${body.id}). Thank you.`);
  rememberOffer(session.id);
}

// Coding agents offer to send the session when their work is done -- the
// skills say when -- and ask this first. A yes counts as the offer: never twice
// in one session, at most once a week, and never again after --never.
const OFFER_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

function answerShouldAsk() {
  const reason = reasonNotToOffer();
  if (reason) {
    console.log(`no — ${reason}`);
    return;
  }
  rememberOffer(process.env.CLAUDE_CODE_SESSION_ID);
  console.log(
    "yes — ask the person you work for whether to send this session to the Vatio team: send it, " +
      "not now, or don't ask again (`vatio share-session --never`)."
  );
}

function reasonNotToOffer() {
  if (process.env.CI) return "this is CI";
  if (!telemetryEnabled()) return "telemetry is off, so they would rather send nothing";
  const state = readOfferState();
  if (state.never) return "they said not to ask again";
  const current = process.env.CLAUDE_CODE_SESSION_ID;
  if (!current || !sessionById(current)) return "only a Claude Code session can be sent, from inside it";
  if (state.session === current) return "already offered in this session";
  if (Date.now() - Date.parse(state.offered_at ?? "") < OFFER_EVERY_MS) return "already offered this week";
  return null;
}

function stopOffering() {
  writeOfferState({ ...readOfferState(), never: true });
  console.log("Coding agents won't offer to send a session again. `vatio share-session` still sends one when you want.");
  console.log(`To be asked again, delete ${tilde(offerStatePath())}.`);
}

function rememberOffer(sessionId) {
  try {
    writeOfferState({ ...readOfferState(), offered_at: new Date().toISOString(), session: sessionId });
  } catch {
    // Not remembering only means the next offer comes sooner.
  }
}

function offerStatePath() {
  return join(configHome(), "share-session.json");
}

function readOfferState() {
  try {
    const state = JSON.parse(readFileSync(offerStatePath(), "utf8"));
    return state && typeof state === "object" && !Array.isArray(state) ? state : {};
  } catch {
    return {};
  }
}

function writeOfferState(state) {
  const path = offerStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`);
}

// The one this coding agent is running in, when it is Claude Code; otherwise
// the newest one with a conversation in it, started here or above.
function findSession(id) {
  const current = process.env.CLAUDE_CODE_SESSION_ID;
  if (id || current) {
    const session = sessionById(id ?? current);
    if (session) return session;
    if (id) fail(`No Claude Code session ${id} on this machine. \`vatio share-session --list\` shows them.`);
  }

  const session = sessionsFor(process.cwd()).map(describe).find((candidate) => candidate.messages > 0);
  if (session) return session;
  fail(
    "No Claude Code session found for this directory. Run this from the project Claude Code was working in.\n" +
      'Only Claude Code sessions for now: from another coding agent, tell us with `vatio feedback "…"`.'
  );
}

function listSessions() {
  const sessions = sessionsFor(process.cwd()).slice(0, 20).map(describe).filter((session) => session.messages > 0).slice(0, 10);
  if (sessions.length === 0) fail("No Claude Code sessions for this directory.");

  const current = process.env.CLAUDE_CODE_SESSION_ID;
  for (const session of sessions) {
    const mark = session.id === current ? "*" : " ";
    const title = session.title ? truncate(session.title, 60) : "";
    const modified = when(new Date(session.modifiedAt).toISOString());
    console.log(`${mark} ${short(session.id)}  ${modified}  ${String(session.messages).padStart(5)} msgs  ${title}`);
  }
  console.log("\nSend one with `vatio share-session --id ID`.");
}

function short(id) {
  return id.slice(0, 8);
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function when(iso) {
  if (!iso) return "?";
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function tilde(path) {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
