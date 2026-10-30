// `vatio chat …` — a conversation with one of your own deployments.
//
// By default you are yourself: the chat belongs to the token you are holding,
// on the `cli` channel, and anonymous. There is no flag that pretends to be a
// WhatsApp or Instagram visitor; the shared WhatsApp preview number and the
// Instagram test accounts do that for real, and a simulated channel was only
// ever a second answer to keep in step with the true one.
//
// What you can be is someone who already proved who they are: `--as-phone`
// speaks as a phone verified on WhatsApp (yours, or a customer phone), and
// `--as-subject` signs the token your backend would, with your identity key,
// or `--visitor-token` brings one you have. Vatio only verifies them, as it
// does the widget's and WhatsApp's, so this gives you nothing you did not
// already hold (lib/visitor-identity.mjs, Vatio::Preview::Tester).

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { ApiClient } from "../api-client.mjs";
import { fail, sleep, takeAll, takeEnv, takeFlag, takeValue } from "../support.mjs";
import { IDENTITY_FLAGS_USAGE, takeIdentity, tokenFor } from "../visitor-identity.mjs";

export const STATE_FILE = ".vatio-chat.json";

const SUBCOMMANDS = new Set(["show", "help"]);
// Answered by name, so old muscle memory gets the new spelling.
const RETIRED = {
  transcript: "`vatio chat transcript` is `vatio chat show` now.",
  debug: "`vatio chat debug` is `vatio chat show` now (add --json for everything).",
  reset: "`vatio chat reset` is `vatio chat --new \"message\"` now.",
  destroy: "`vatio chat destroy` was removed.",
  delete: "`vatio chat delete` was removed."
};
// Words a coding agent reaches for as subcommands. Alone, they are never what
// someone meant to say to their agent, and sending them starts a chat.
const NOT_SUBCOMMANDS = new Set(["list", "ls", "search", "find", "get", "read", "view", "open", "history", "status", "new", "start"]);
const REMOVED_FLAGS = ["--channel", "--from", "--as", "--sandbox-url"];
// What a visitor may attach to one message (Vatio::PublicApi::VisitorUploads):
// checked here too, so a file that would be refused is never uploaded.
const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function chat(config, args) {
  // Not a conversation of your own, so none of what follows applies to it,
  // and its --from and --channel mean dates and a channel to read.
  if (args[0] === "export") return await exportChats(config, args.slice(1));

  for (const arg of args) {
    if (REMOVED_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      fail(
        `\`${arg}\` was removed. A CLI chat is you, the developer holding the token, unless you say who: ` +
          "--as-phone speaks as your verified WhatsApp (me) or a customer phone, --as-subject ID signs a visitor in " +
          "with your identity key, and --visitor-token brings a token you have; " +
          "to pick a deployment use --env."
      );
    }
  }

  const environment = takeEnv(args, { fallback: "preview" });
  const files = readFiles(takeAll(args, "--file"));
  // A PDF is read before the agent answers, which can take minutes.
  const timeout = Number(takeValue(args, "--timeout") ?? (files.length > 0 ? 300 : 120));
  const lastValue = takeValue(args, "--last");
  const last = Number(lastValue ?? 10);
  const json = takeFlag(args, "--json");
  const fresh = takeFlag(args, "--new");
  // One chat by id, whatever the state file says: parallel sessions each keep
  // their own this way, where the file holds one chat per environment.
  const chatId = takeValue(args, "--chat");
  const apiUrl = takeValue(args, "--api-url");
  const token = takeValue(args, "--token");
  const asPhone = takeValue(args, "--as-phone");

  const identity = takeIdentity(args, config);

  if (chatId != null) {
    if (!/^\d+$/.test(chatId)) fail(`--chat takes a chat id, the number \`vatio chat --new\` prints (got ${JSON.stringify(chatId)}).`);
    if (fresh || asPhone) fail("--chat continues a chat that is already open: drop --new and --as-phone, or drop --chat.");
  }

  const options = {
    environment, timeout, last, lastGiven: lastValue != null, json, apiUrl, token, asPhone, identity, chatId, files
  };
  if (args.length === 1 && RETIRED[args[0]]) fail(RETIRED[args[0]]);
  if (args.length === 1 && NOT_SUBCOMMANDS.has(args[0].toLowerCase())) {
    fail(
      `\`vatio chat ${args[0]}\` is not a command, and nothing was sent. ` +
        "`vatio chat show [CHAT_ID]` reads a conversation; `vatio chat export --from DATE` lists them with their ids. " +
        "To say it to the agent, write a whole sentence."
    );
  }
  const sub = SUBCOMMANDS.has(args[0]) ? args.shift() : null;

  if (sub === "help") return console.log(chatHelp());
  if (sub && files.length > 0) fail("--file goes with a message: vatio chat \"message\" --file PATH");
  if (sub === "show") return await showChat(config, options, args);

  // A phone is fixed when a chat opens, so naming one opens one. A signed-in
  // visitor opens one only when it is someone else (ensureChat).
  const opening = fresh || Boolean(asPhone);
  // The message goes to the chat this command opened, never to whatever the
  // state file says by the time it is sent: another `vatio chat --new` running
  // alongside may have written its own there in between.
  const opened = opening ? await startOver(config, options) : null;
  const message = args.join(" ").trim();
  if (message === "" && files.length === 0) return opening ? undefined : console.log(chatHelp());

  return await converse(config, options, message, opened);
}

export function chatHelp() {
  return `Usage:
  vatio chat "message" [--file PATH]... [--env NAME] [--new] [--timeout N] [--as-phone me|PHONE] ${IDENTITY_FLAGS_USAGE}
  vatio chat --chat CHAT_ID "message" [--file PATH]...
  vatio chat show [CHAT_ID] [--env NAME] [--last N] [--json]
  ${EXPORT_USAGE}

--env picks the deployment that answers: preview (default) or live. A chat
against live is a real conversation and shows up in your inbox.

--file PATH attaches a file to the message, as a visitor would from the web:
up to four, 8 MB each, images, PDFs, text files or audio. The message may be
empty with one. A PDF is read before the agent answers (the timeout defaults
to 300 seconds then), and a [file] line says how much of it the agent got.

\`show\` prints the chat you are in, with every tool call the agent made. Give
it an id to read any chat in the workspace -- one a visitor had on the web,
WhatsApp or Instagram -- with the environment and deployment that answered it.
Each message carries its id (#4821), the one \`vatio test add --message\` takes.
A [file] line is a file the visitor sent: for a PDF, how many characters the
agent was given, "truncated at N" when it got only that many, or
"unreadable" and why. A [your backend] line under a tool call is how your
backend answered it, or that the tool's request.cache answered without
calling it.
A [safeguard] line says which of Vatio's checks discarded or rewrote a draft,
and a [vatio] line marks a reply Vatio wrote because the agent's turn produced
none: why, and whether anything in your workspace caused it.

--as-subject ID talks as that person, signed in: it signs the JWT your backend
would, with the private key from \`vatio auth --new-key\` (VATIO_IDENTITY_PRIVATE_KEY,
identity.pem next to vatio.yml, or --identity-key FILE), so tools marked
\`access: private\` run with their \`$auth.token\`. Vatio only verifies it, the
way it does the widget's. --visitor-token JWT (or VATIO_VISITOR_TOKEN) brings a
token you signed elsewhere.
A chat as someone else starts over; the same person continues it.

The open chat per deployment is remembered in ${STATE_FILE}, so a second
\`vatio chat\` continues the first. \`--new\` starts over as a visitor the
workspace has never met, sends the message to that new chat and prints its id.
\`--chat CHAT_ID\` continues that chat, whatever ${STATE_FILE} says: for
conversations running side by side, each command names its own.

\`--as-phone\` opens a preview chat that speaks as a phone, for tools that
need $contact.phone_number or a team role (access: supervisor and up): \`me\`
is your own verified WhatsApp, with your role on the team; one of the
workspace's customer phones (added in the inbox, under Conversations → Try the
agent → WhatsApp) is a customer. It stays a CLI chat: nothing goes to WhatsApp.

\`export\` prints what people said and what they were answered between two
dates (live unless --env says otherwise), one conversation per line as JSON,
for reading them in bulk -- with a coding agent, say. Vatio redacts it before
it leaves: names, emails, phone numbers and RUTs it knows are [FILTERED], and
\`person\` stands for whoever it was without naming them. Anyone on the
workspace's team can run it, a viewer too, and every call is in the
workspace's activity. Dates are whole days; --to defaults to now.`;
}

const EXPORT_USAGE = "vatio chat export --from DATE [--to DATE] [--env NAME] [--channel NAME] [--out FILE]";

// One page at a time, written as it arrives: a month of a busy WhatsApp number
// does not have to fit in memory to be read.
async function exportChats(config, args) {
  const environment = takeEnv(args, { fallback: "live" });
  const from = takeValue(args, "--from");
  const to = takeValue(args, "--to");
  const channel = takeValue(args, "--channel");
  const out = takeValue(args, "--out");
  const apiUrl = takeValue(args, "--api-url");
  const token = takeValue(args, "--token");
  if (args.length > 0) fail(`Unexpected ${args[0]}. Usage: ${EXPORT_USAGE}`);
  if (!from) fail(`--from is required, a date like 2026-09-01. Usage: ${EXPORT_USAGE}`);

  const api = client(config, { apiUrl, token });
  if (out) writeFileSync(out, "");

  let after = null;
  let chats = 0;
  let messages = 0;
  for (;;) {
    const page = await api.exportChats({ from, to, environment, channel, after });
    const rows = Array.isArray(page.data) ? page.data : [];
    if (rows.length > 0) {
      const lines = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      if (out) appendFileSync(out, lines);
      else await new Promise((resolve) => process.stdout.write(lines, resolve));
    }
    chats += rows.length;
    messages += rows.reduce((sum, row) => sum + (Array.isArray(row.messages) ? row.messages.length : 0), 0);
    if (!page.next_after) {
      const window = page.window ?? {};
      console.error(
        `vatio: ${chats} conversation${chats === 1 ? "" : "s"}, ${messages} message${messages === 1 ? "" : "s"}, ` +
          `${window.from} → ${window.to} on ${page.environment ?? environment}${out ? `, in ${out}` : ""}. ` +
          "Redacted by Vatio: what identifies someone reads [FILTERED]."
      );
      return;
    }
    after = page.next_after;
  }
}

function client(config, options) {
  const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
  const token = options.token ?? config.resolveToken();
  if (!apiUrl) {
    // Says which: no vatio.yml here (and where one is), or one without `workspace:`.
    config.resolveWorkspaceRequired();
    fail("A workspace API url is required (--api-url, or base_url + a vatio.yml with `workspace:`)");
  }
  if (!token) fail("VATIO_TOKEN is required (env or `vatio login`)");
  return new ApiClient({ baseUrl: apiUrl, token });
}

function statePath(config) {
  return join(config.workspaceRootRequired(), STATE_FILE);
}

function loadState(config) {
  const path = statePath(config);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// One chat per deployment, keyed by environment: switching to `--env live` and
// back must not throw away the preview conversation you were in the middle of.
// Chats are dropped wholesale when the api url changes, since a chat id only
// means anything on the server that issued it.
function chatsFor(config, apiUrl) {
  const state = loadState(config);
  if (state.api_url !== apiUrl) return {};
  return state.chats && typeof state.chats === "object" ? state.chats : {};
}

// The chat `vatio chat` is in on this environment, for `vatio test add`.
export function rememberedChatId(config, environment) {
  return chatsFor(config, config.resolveApiUrl())[environment] ?? null;
}

// Who each remembered chat is with: the subject it was signed in as, or null
// for the anonymous one. A chat is continued only by the same answer.
function subjectsFor(config, apiUrl) {
  const state = loadState(config);
  if (state.api_url !== apiUrl) return {};
  return state.subjects && typeof state.subjects === "object" ? state.subjects : {};
}

function rememberChat(config, { apiUrl, environment, chatId, subject = null }) {
  const chats = { ...chatsFor(config, apiUrl), [environment]: chatId };
  const subjects = { ...subjectsFor(config, apiUrl), [environment]: subject };
  writeAtomically(statePath(config), `${JSON.stringify({ api_url: apiUrl, chats, subjects }, null, 2)}\n`);
}

// Written whole or not at all, so a command reading it while another writes
// never gets half a file. The temporary name starts with a dot, which keeps
// it out of a push.
function writeAtomically(path, content) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(temporary, content);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

// --chat's, as is: it is not remembered, so it moves no other command off
// the chat it is in.
async function chatToContinue(config, options) {
  if (options.chatId == null) return await ensureChat(config, options);

  const chatId = Number(options.chatId);
  if (options.identity) await refreshIdentity(config, options, chatId);
  return chatId;
}

async function ensureChat(config, options) {
  const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
  const existing = chatsFor(config, apiUrl)[options.environment];
  const subject = options.identity?.subject ?? null;
  const same = (subjectsFor(config, apiUrl)[options.environment] ?? null) === subject;
  if (existing && same) {
    if (options.identity) await refreshIdentity(config, options, Number(existing));
    return Number(existing);
  }

  // A chat as someone else is another conversation, with another visitor.
  const payload = await openChat(config, options, { apiUrl, chatId: existing ? Number(existing) : null });
  return Number(payload.chat_id);
}

// The chat keeps the token it was opened with, and a signed one is short-lived:
// each command hands it a fresh one, so a conversation outlives the first.
async function refreshIdentity(config, options, chatId) {
  const outcome = await client(config, options).identifyChat({
    chatId,
    visitorToken: tokenFor(options.identity)
  });
  if (outcome.identified === false) fail(identityRefusal(outcome.reason));
}

async function openChat(config, options, { apiUrl, chatId = null }) {
  const api = client(config, options);
  const visitorToken = options.identity ? tokenFor(options.identity) : null;
  const payload = chatId
    ? await api.resetChat({ chatId, environment: options.environment, asPhone: options.asPhone, visitorToken })
    : await api.createChat({ environment: options.environment, asPhone: options.asPhone, visitorToken });

  rememberChat(config, {
    apiUrl,
    environment: options.environment,
    chatId: payload.chat_id,
    subject: options.identity?.subject ?? null
  });
  announce(options.environment, payload, options.identity);
  return payload;
}

function identityRefusal(reason) {
  return reason === "identity_changed"
    ? "That chat belongs to someone else. Start over with `vatio chat --new`."
    : "Vatio could not verify that token. It has to be signed with the key matching `auth.public_key` in vatio.yml " +
        "(pushed to this environment), with `aud` set to the workspace slug and an `exp` that has not passed.";
}

// Live is not refused -- you asked for it -- but it is said out loud, once,
// when the chat opens. A conversation against live is a real one: it lands in
// the inbox next to the ones visitors started, and nothing downstream knows it
// came from a terminal.
function announce(environment, payload = {}, identity = null) {
  const as = `${speaker(payload)}${identity ? `, signed in as ${identity.subject}` : ""}`;
  if (environment === "live") {
    console.log(`Talking to live${as} — this is a real conversation and appears in your inbox.`);
  } else {
    console.log(`Talking to ${environment}${as}`);
  }
}

function speaker(payload) {
  const phone = payload.contact?.phone_number;
  if (!phone) return "";
  return ` as ${phone}${payload.team_role ? ` (${payload.team_role})` : ""}`;
}

// `opened` is the chat this command just opened, if it opened one.
async function converse(config, options, message, opened = null) {
  const api = client(config, options);
  const chatId = opened ?? (await chatToContinue(config, options));
  const sent = await api.sendChatMessage({ chatId, content: message, files: options.files ?? [] });
  const assistant = await waitForAssistant(api, {
    chatId,
    after: sent.user_message_id,
    timeout: options.timeout
  });
  if (options.files?.length > 0) await printSentFiles(api, chatId, sent.user_message_id);
  console.log(formatVisitor(assistant));
}

function readFiles(paths) {
  if (paths.length > MAX_FILES) fail(`At most ${MAX_FILES} files per message, as for a visitor (got ${paths.length}).`);
  return paths.map((path) => {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      fail(`--file ${path}: no such file.`);
    }
    if (!stats.isFile()) fail(`--file ${path}: not a file.`);
    if (stats.size > MAX_FILE_BYTES) {
      fail(`${basename(path)} is ${humanBytes(stats.size)}; the limit is 8 MB per file, as for a visitor.`);
    }
    return { name: basename(path), bytes: readFileSync(path) };
  });
}

// The message as stored, by the id the send returned: what was read of each
// file by the time the agent answered.
async function printSentFiles(api, chatId, messageId) {
  const payload = await api.chatMessages({ chatId, after: messageId - 1 });
  const stored = (Array.isArray(payload.data) ? payload.data : []).find((entry) => entry.id === messageId);
  for (const attachment of stored?.attachments ?? []) console.log(attachmentLine(attachment));
}

// One file a message carried, and what the agent was given of it: a PDF's
// reading (Vatio::Runtime::MediaPolicy.document_reading), or a video's
// description.
function attachmentLine(attachment) {
  const about = [attachment.content_type, humanBytes(attachment.byte_size)].filter(Boolean).join(", ");
  const head = `[file] ${attachment.filename} (${about})`;
  const reading = attachment.reading;
  if (!reading) return attachment.description ? `${head}: described in ${attachment.description.length} characters` : head;

  const pages = reading.pages ? `${reading.pages} pages, ` : "";
  if (reading.status === "read") return `${head}: ${pages}${reading.chars} characters read`;
  if (reading.status === "unreadable") return `${head}: ${pages}unreadable: ${reading.error_message ?? reading.error}`;
  if (reading.status !== "truncated") return `${head}: ${pages}not read yet`;

  const why =
    reading.truncated === "characters"
      ? `of ${reading.total_chars} read; the rest was left out`
      : "the reading stopped before the end of the document";
  return `${head}: ${pages}${reading.chars} characters read, truncated at ${reading.truncated_at} (${why})`;
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// What a visitor would have seen in a row the developer API always sends in
// full -- the same three questions the server used to answer behind
// `view=visitor`: not deleted, said by a person or the agent, and actually
// carrying words. A tool call with no text answers the last one and is skipped,
// which is what makes this safe to run over the developer payload.
const visitorVisible = (entry) =>
  !entry.discarded &&
  ["user", "assistant"].includes(entry.role) &&
  String(entry.content ?? "").trim() !== "";

// Conversations are asynchronous: post a message, then poll for the reply.
async function waitForAssistant(api, { chatId, after, timeout, interval = 2 }) {
  const deadline = Date.now() + timeout * 1000;
  for (;;) {
    const payload = await api.chatMessages({ chatId, after });
    const messages = Array.isArray(payload.data) ? payload.data : [];
    const assistant = [...messages]
      .reverse()
      .find((entry) => entry.role === "assistant" && visitorVisible(entry));
    if (assistant) return assistant;
    if (Date.now() >= deadline) fail(`Timed out waiting for assistant reply after ${timeout}s`);
    await sleep(interval * 1000);
  }
}

// Every message, not the first page: a chat worth reading by id is usually one
// that went wrong somewhere in the middle.
async function allMessages(api, chatId) {
  const messages = [];
  let after = null;
  for (;;) {
    const payload = await api.chatMessages({ chatId, after, limit: 200 });
    const page = Array.isArray(payload.data) ? payload.data : [];
    messages.push(...page);
    if (page.length < 200) return messages;
    after = page[page.length - 1].id;
  }
}

async function showChat(config, options, args) {
  let chatId = args.shift() ?? options.chatId ?? undefined;
  if (chatId !== undefined && !/^\d+$/.test(chatId)) fail("Usage: vatio chat show [CHAT_ID] [--last N] [--json]");
  if (chatId === undefined) {
    const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
    chatId = chatsFor(config, apiUrl)[options.environment];
    if (!chatId) fail(`No ${options.environment} chat yet: run \`vatio chat "hello"\` first, or pass a CHAT_ID.`);
    chatId = String(chatId);
  }

  const api = client(config, options);
  const chat = await api.showChat({ chatId });
  let messages = await allMessages(api, chatId);
  if (options.lastGiven) messages = messages.slice(-options.last);

  if (options.json) return console.log(JSON.stringify({ chat, messages }, null, 2));

  const header = [
    `Chat ${chat.chat_id}`,
    chat.channel,
    chat.environment,
    chat.deployment_id && `deployment #${chat.deployment_id}`,
    `agent ${chat.agent_slug}`
  ];
  console.log(header.filter(Boolean).join(" · "));
  console.log(`Started ${chat.created_at}, last activity ${chat.updated_at}`);
  if (chat.identity) console.log(`Identity: ${JSON.stringify(chat.identity)}`);
  console.log("");

  for (const message of messages) {
    const content = String(message.content ?? "").trim();
    if (message.role === "system") {
      console.log(`[system] ${content.length} characters of prompt (--json prints it)`);
      continue;
    }
    if (message.role === "tool") {
      console.log(`  [tool result] ${truncate(content, 400)}`);
      const limit = toolLimit(content);
      if (limit) console.log(`  [tool limit] ${limit}`);
      continue;
    }
    const safeguard = message.safeguard ?? null;
    const flags = message.discarded
      ? safeguard?.policy
        ? ` (discarded by the ${safeguard.policy} safeguard)`
        : " (discarded)"
      : "";
    if (content !== "" || flags) console.log(`[${message.role} #${message.id}]${flags} ${content}`);
    for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
      console.log(`  ${attachmentLine(attachment)}`);
    }
    for (const line of buttonLines(message)) console.log(`  ${line}`);
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      console.log(`  -> ${call.name}(${truncate(JSON.stringify(call.arguments ?? {}), 400)})`);
      if (call.backend) console.log(`  [your backend] ${backendLine(call.backend)}`);
    }
    if (safeguard) console.log(`  [safeguard] ${safeguardLine(safeguard)}`);
    if (message.fallback) console.log(`  [vatio] ${fallbackLine(message.fallback)}`);
  }
  if (messages.length === 0) console.log("(no messages)");
}

// How the developer's backend answered a tool call, as Vatio measured it.
// Anything but `ok` is the backend's to fix, not the agent's.
function backendLine(backend) {
  const request = [backend.method, backend.url].filter(Boolean).join(" ");
  const status = [backend.http_status && `HTTP ${backend.http_status}`, backend.outcome].filter(Boolean).join(" · ");
  if (backend.cached) return `${request} → ${status} from the tool's request.cache; your backend was not called`;
  const failed = backend.outcome && backend.outcome !== "ok" ? " — failed in your backend, not in the agent" : "";
  return `${request} → ${status} in ${backend.duration_ms ?? "?"} ms${failed}`;
}

// What a safeguard did to a draft, in words: Vatio::Safeguards' policies,
// which run on every reply and cannot be turned off.
function safeguardLine(safeguard) {
  const detail = safeguard.detail ?? {};
  const what =
    safeguard.policy === "no_links"
      ? `a link that is not in links:, instructions or a tool result (${asList(detail.forbidden_urls)})`
      : safeguard.policy === "no_invented_amounts"
        ? `an amount no tool returned and no instruction gives (${asList(detail.invented_amounts)})`
      : safeguard.policy === "no_generated_media"
        ? `embedded media (${asList(detail.markers)})`
        : safeguard.policy === "no_empty_content"
          ? "an empty draft"
          : "a draft that broke a rule";
  const action =
    safeguard.action === "discarded"
      ? "discarded it and asked the model again"
      : "rewrote it before it went out";
  return `${safeguard.policy}: ${what}; Vatio ${action}`;
}

// Why Vatio wrote this reply instead of the agent, and whose it is to fix.
function fallbackLine(fallback) {
  const why = `Vatio wrote this reply because ${fallback.reason}.`;
  if (fallback.owner === "vatio") return `${why} Not your agent: nothing in your workspace caused it.`;
  if (fallback.cause === "tool_loop") return `${why} See which tool the agent repeated above, and what it answered.`;
  return `${why} The fix is in your agent.`;
}

function asList(value) {
  const items = Array.isArray(value) ? value : [];
  return items.length > 0 ? truncate(items.join(", "), 200) : "not recorded";
}

// Vatio::Runtime::ToolBudget's marks on a tool result, said on a line of their
// own: the note rides at the end of the result and truncate() can cut it off,
// which left a turn that ran out of calls looking like one that just stopped.
function toolLimit(content) {
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    return null;
  }
  if (result?.error_key === "tool_budget_spent") return "call refused: this reply had spent its tool calls";
  if (result?.tool_budget) return "this reply spent its tool calls; the agent was told to answer now";
  return null;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// One question in a new chat, for `vatio test add "QUESTION" "WHAT IT SHOULD
// DO"`: the chat becomes the one `vatio chat` continues, and the reply is the
// one the test is made on.
export async function askInNewChat(config, { environment, asPhone = null, identity = null, timeout = 120 }, question) {
  const options = { environment, asPhone, identity, timeout, apiUrl: null, token: null };
  const apiUrl = config.resolveApiUrl({ explicit: null });
  const payload = await openChat(config, options, { apiUrl, chatId: chatsFor(config, apiUrl)[environment] ?? null });
  const chatId = Number(payload.chat_id);
  const api = client(config, options);
  const sent = await api.sendChatMessage({ chatId, content: question });
  const reply = await waitForAssistant(api, { chatId, after: sent.user_message_id, timeout });
  console.log(`[you] ${question}`);
  console.log(formatVisitor(reply));
  return reply;
}

async function startOver(config, options) {
  const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
  const payload = await openChat(config, options, {
    apiUrl,
    chatId: chatsFor(config, apiUrl)[options.environment] ?? null
  });
  console.log(`New ${options.environment} chat ${payload.chat_id} (\`vatio chat --chat ${payload.chat_id} "…"\` continues it)`);
  return Number(payload.chat_id);
}

function formatVisitor(message) {
  if (!message) return "";
  const role = message.role === "assistant" ? "agent" : "you";
  return [`[${role}] ${String(message.content ?? "").trim()}`, ...buttonLines(message).map((line) => `  ${line}`)].join("\n");
}

// A link the reply sends as a button: on WhatsApp and Instagram the visitor
// sees the text without it and this button under it.
function buttonLines(message) {
  const buttons = Array.isArray(message.buttons) ? message.buttons : [];
  return buttons.map((button) => `[button] ${button.title} → ${button.url}`);
}
