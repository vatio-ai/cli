// docs, feedback and share-session — the commands that are about Vatio rather
// than about a deployment.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import * as claudeSessions from "../claude-session.mjs";
import * as codexSessions from "../codex-session.mjs";
import { configHome } from "../config.mjs";
import { pageArgument, sectionsOf } from "../docs-sections.mjs";
import { ask, fail, takeFlag, takeValue } from "../support.mjs";
import { chosenHeaders, clientHeaders, sendFeedback, telemetryEnabled } from "../telemetry.mjs";
import { ensureAuthorized } from "./deploy.mjs";
import { DOCS_URL } from "./misc.mjs";

// The whole developer contract as markdown, live from the platform. Fetched
// rather than bundled: the docs describe the deploy you are talking to, and a
// copy shipped inside this package would start lying the day either moves.
//
// The whole of it is thousands of lines. `vatio docs PAGE` prints one page,
// and `vatio docs search TERM` the sections that mention something.
export async function docs(config, args) {
  const saveTo = takeValue(args, "--save-to");
  const save = takeFlag(args, "--save") || saveTo != null;
  const savePath = saveTo ?? (save ? args.shift() ?? null : null);
  if (!save && args[0] === "search") return await searchDocs(config, args.slice(1));
  if (!save && args.length > 0) return await docsPage(config, args);

  const baseUrl = config.resolveBaseUrl();
  const markdown = await fetchContract(config);

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

const DOCS_SEARCH_USAGE = "vatio docs search TERM [--all]";
// Sections `vatio docs search` prints unless --all, and matches per section.
const SEARCH_SECTIONS = 20;
const SEARCH_MATCHES = 3;
const SEARCH_CONTEXT = 2;

async function fetchMarkdown(url, { method = "GET" } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...clientHeaders(), Accept: "text/markdown, text/plain" },
    signal: AbortSignal.timeout(30_000)
  });
  return { ok: response.ok, status: response.status, url: response.url, text: method === "HEAD" ? "" : await response.text() };
}

// docs.md, by way of the base URL, which redirects to where the docs live.
async function fetchContract(config) {
  try {
    const response = await fetchMarkdown(`${config.resolveBaseUrl()}/docs.md`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text;
  } catch (error) {
    fail(`Could not fetch the docs: ${error.message}\nRead them at ${DOCS_URL} instead.`);
  }
}

// Where the pages' Markdown twins are: beside the docs.md the base URL leads
// to, https://vatio.ai/docs/ unless that says otherwise.
async function docsRoot(config) {
  try {
    const { ok, url } = await fetchMarkdown(`${config.resolveBaseUrl()}/docs.md`, { method: "HEAD" });
    if (ok && url.endsWith("/docs.md")) return url.slice(0, -"docs.md".length);
  } catch {
    // The page fetch says what went wrong, if anything does.
  }
  return `${DOCS_URL}/`;
}

// One page as Markdown, by its path under /docs: `tools`, `cli/chat`, `cli`
// for cli/, a pasted https://vatio.ai/docs/tools#anchor too.
async function docsPage(config, args) {
  if (args.length > 1) fail(`vatio docs takes one page (\`vatio docs tools\`), or \`${DOCS_SEARCH_USAGE}\`.`);
  const page = args[0]
    .trim()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[#?].*$/, "")
    .replace(/^\/+/, "")
    .replace(/^docs(\/|$)/, "")
    .replace(/\.md$/, "");
  const root = await docsRoot(config);
  const candidates = page === "" || page === "index" ? ["index.md"] : page.endsWith("/") ? [`${page}index.md`] : [`${page}.md`, `${page}/index.md`];

  for (const candidate of candidates) {
    let response;
    try {
      response = await fetchMarkdown(`${root}${candidate}`);
    } catch (error) {
      fail(`Could not fetch ${root}${candidate}: ${error.message}`);
    }
    if (response.ok) {
      process.stdout.write(response.text.endsWith("\n") ? response.text : `${response.text}\n`);
      return;
    }
    if (response.status !== 404) fail(`Could not fetch ${root}${candidate}: HTTP ${response.status}`);
  }

  fail(await noSuchPage(root, page));
}

// The pages llms.txt lists whose path or title has the word in it, or all of
// them: the reader needs a name to pass, not a 404.
async function noSuchPage(root, page) {
  let pages = [];
  try {
    const response = await fetchMarkdown(`${root}llms.txt`);
    if (response.ok) {
      pages = [...response.text.matchAll(/^- \[([^\]]+)\]\((https?:\/\/[^)]+)\.md\)/gm)].map(([, title, url]) => ({
        title,
        name: pageArgument(`${url.replace(/(^|\/)index$/, "$1")}`)
      }));
    }
  } catch {
    // Said below without the list.
  }
  const words = page.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const close = pages.filter(({ title, name }) => words.some((word) => `${name} ${title}`.toLowerCase().includes(word)));
  const listed = close.length > 0 ? close : pages;
  const width = Math.max(0, ...listed.map(({ name }) => name.length));
  return [
    `No docs page ${JSON.stringify(page)}. \`${DOCS_SEARCH_USAGE}\` looks inside the pages.`,
    ...(listed.length > 0 ? ["", close.length > 0 ? "Pages like it:" : "The pages:"] : []),
    ...listed.map(({ title, name }) => `  vatio docs ${name.padEnd(width)}  ${title}`)
  ].join("\n");
}

// The sections of the reference that mention TERM, case-insensitively: each
// with its heading path, its URL and the lines around each match, numbered as
// in docs.md (`vatio docs --save`).
async function searchDocs(config, args) {
  const all = takeFlag(args, "--all");
  const term = args.join(" ").trim();
  if (term === "") fail(`Say what to look for: ${DOCS_SEARCH_USAGE}`);

  const markdown = await fetchContract(config);
  const needle = term.toLowerCase();
  const hits = sectionsOf(markdown)
    .map((section) => ({ ...section, matches: section.lines.filter((line) => line.text.toLowerCase().includes(needle)) }))
    .filter((section) => section.matches.length > 0);

  if (hits.length === 0) {
    console.log(
      `Nothing in the reference mentions ${JSON.stringify(term)}. Try another word, or \`vatio docs PAGE\` for a page; ` +
        "the guides are not in the reference, and `vatio docs guides/NAME` prints one."
    );
    return;
  }

  const shown = all ? hits : hits.slice(0, SEARCH_SECTIONS);
  const count = hits.length === 1 ? "1 section" : `${hits.length} sections`;
  console.log(`${count} of the reference mention ${JSON.stringify(term)}${shown.length < hits.length ? `; the first ${shown.length}` : ""}.`);

  for (const section of shown) {
    console.log("");
    console.log(section.path.join(" › "));
    console.log(`${section.url}  (vatio docs ${pageArgument(section.url)})`);
    for (const line of excerpt(section)) console.log(line);
  }

  if (shown.length < hits.length) {
    console.log("");
    const quoted = /\s/.test(term) ? JSON.stringify(term) : term;
    console.log(`${hits.length - shown.length} more: \`vatio docs search ${quoted} --all\`, or a narrower term.`);
  }
}

// grep -n -C2 style: `288:` a matching line, `287-` one around it, `--`
// between runs that do not touch.
function excerpt(section) {
  const { lines, matches } = section;
  const wanted = new Set();
  for (const match of matches.slice(0, SEARCH_MATCHES)) {
    const at = lines.indexOf(match);
    for (let i = Math.max(0, at - SEARCH_CONTEXT); i <= Math.min(lines.length - 1, at + SEARCH_CONTEXT); i++) wanted.add(i);
  }
  const hit = new Set(matches);
  const out = [];
  let previous = null;
  for (const index of [...wanted].sort((a, b) => a - b)) {
    if (previous !== null && index > previous + 1) out.push("--");
    const line = lines[index];
    out.push(`${line.number}${hit.has(line) ? ":" : "-"} ${line.text}`);
    previous = index;
  }
  const more = matches.length - SEARCH_MATCHES;
  if (more > 0) out.push(`(${more} more in this section)`);
  return out;
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
  const { label, reader } = AGENTS[session.agent];
  const transcript = reader.clean(session);
  if (transcript.messages === 0) fail(`Session ${short(session.id)} has no messages yet.`);
  const gzipped = gzipSync(transcript.jsonl);

  const { title } = reader.describe(session);
  console.log(`${label} session ${short(session.id)}${title ? ` — ${truncate(title, 70)}` : ""}`);
  console.log(`  ${tilde(transcript.cwd ?? process.cwd())}${transcript.gitBranch ? ` (${transcript.gitBranch})` : ""}`);
  console.log(`  ${transcript.messages} messages, ${when(transcript.startedAt)} → ${when(transcript.endedAt)}`);
  console.log(`  ${size(Buffer.byteLength(transcript.jsonl))}, ${size(gzipped.length)} compressed`);
  console.log(
    `  Left out: ${transcript.images > 0 ? `${transcript.images} image(s) and ` : ""}${label}'s own bookkeeping.` +
      (transcript.redactions > 0 ? ` ${transcript.redactions} thing(s) that looked like a key, token or password are [REDACTED].` : "") +
      (transcript.personal > 0 ? ` ${transcript.personal} email address(es), phone number(s) and RUT(s) are [EMAIL], [PHONE] and [RUT].` : "")
  );

  if (savePath) {
    const target = resolve(savePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, transcript.jsonl);
    console.log(`\nWrote ${target}: exactly what would be sent. Nothing was sent.`);
    return;
  }

  console.log(
    "\nOnly the Vatio team reads it, to see where you and your coding agent got stuck. Every read is logged,\n" +
      "and it is deleted 30 days after it arrives."
  );
  if (!yes) {
    if (!process.stdin.isTTY) {
      fail(
        "Not sent: this is the whole conversation. Ask the person you work for, and whether they want to\n" +
          'add feedback in their own words, then run it again with --yes ["FEEDBACK"]\n' +
          "(--save FILE writes what would be sent, if they want to read it first).\n" +
          // A person typing `! vatio share-session` in Claude Code lands here
          // too: that prompt has no terminal to answer from.
          'Running it yourself, after ! in Claude Code? It cannot ask you there: add --yes ["FEEDBACK"].'
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
  form.set("source", session.agent);
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

  console.log(`Sent to the Vatio team (#${body.id}).${body.expires_at ? ` It is deleted on ${when(body.expires_at)}.` : ""} Thank you.`);
  rememberSent(session.id, body.id);
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
  rememberOffer(currentSession()?.id);
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
  const current = currentSession();
  if (!current) return "only a Claude Code or Codex session can be sent, from inside it";
  if (state.session === current.id) return "already offered in this session";
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

// Which sessions went, so `--list` can say so: when a permission check stops
// the coding agent and the developer sends it from a terminal, this is how the
// agent learns it arrived.
const SENT_KEPT = 20;

function rememberSent(sessionId, transcriptId) {
  try {
    const state = readOfferState();
    const { [sessionId]: _previous, ...others } = sentSessions(state);
    const sent = Object.entries({ ...others, [sessionId]: { id: transcriptId, at: new Date().toISOString() } });
    writeOfferState({ ...state, sent: Object.fromEntries(sent.slice(-SENT_KEPT)) });
  } catch {
    // Not remembering only means `--list` does not mark it.
  }
}

function sentSessions(state = readOfferState()) {
  return state.sent && typeof state.sent === "object" && !Array.isArray(state.sent) ? state.sent : {};
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

// The coding agents whose sessions can be sent, by the source the upload is
// tagged with, and how each says which session a command runs in.
const AGENTS = {
  "claude-code": { label: "Claude Code", reader: claudeSessions, currentId: () => process.env.CLAUDE_CODE_SESSION_ID },
  codex: { label: "Codex", reader: codexSessions, currentId: () => process.env.CODEX_THREAD_ID }
};

// The session this command runs in, when a coding agent we read runs it.
function currentSession() {
  for (const { reader, currentId } of Object.values(AGENTS)) {
    const id = currentId();
    const session = id ? reader.sessionById(id) : null;
    if (session) return session;
  }
  return null;
}

function sessionById(id) {
  const matches = Object.values(AGENTS).map(({ reader }) => reader.sessionById(id)).filter(Boolean);
  return matches.sort((a, b) => b.modifiedAt - a.modifiedAt)[0] ?? null;
}

// Every agent's sessions for this directory or the nearest parent, newest
// first, with what each is about.
function sessionsHere(limit = Infinity) {
  return Object.values(AGENTS)
    .flatMap(({ reader }) => reader.sessionsFor(process.cwd()).slice(0, limit).map(reader.describe))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

// The one this coding agent is running in, when it is Claude Code or Codex;
// otherwise the newest one with a conversation in it, started here or above.
function findSession(id) {
  if (id) {
    const session = sessionById(id);
    if (session) return session;
    fail(`No Claude Code or Codex session ${id} on this machine. \`vatio share-session --list\` shows them.`);
  }
  const current = currentSession();
  if (current) return current;

  // Inside a coding agent whose session file is not where we read: the newest
  // one for this directory would be another conversation, sent as this one.
  const running = Object.values(AGENTS).find(({ currentId }) => currentId());
  if (running) {
    fail(
      `This runs inside ${running.label} session ${short(running.currentId())}, but its file is not on this machine ` +
        "where share-session looks,\nso nothing was sent rather than another session. " +
        "`vatio share-session --list` shows the sessions it found; send one with --id ID."
    );
  }

  const session = sessionsHere().find((candidate) => candidate.messages > 0);
  if (session) return session;
  fail(
    "No Claude Code or Codex session found for this directory. Run this from the project your coding agent was\n" +
      'working in. From another coding agent, tell us with `vatio feedback "…"`.'
  );
}

function listSessions() {
  const sessions = sessionsHere(20).filter((session) => session.messages > 0).slice(0, 10);
  if (sessions.length === 0) fail("No Claude Code or Codex sessions for this directory.");

  const current = currentSession()?.id;
  const sent = sentSessions();
  for (const session of sessions) {
    const mark = session.id === current ? "*" : " ";
    const title = session.title ? truncate(session.title, 60) : "";
    const modified = when(new Date(session.modifiedAt).toISOString());
    const shared = sent[session.id] ? `  (sent #${sent[session.id].id}, ${when(sent[session.id].at)})` : "";
    const agent = AGENTS[session.agent].label.padEnd(11);
    console.log(`${mark} ${short(session.id)}  ${modified}  ${agent}  ${String(session.messages).padStart(5)} msgs  ${title}${shared}`);
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
