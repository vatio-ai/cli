// `vatio chat …` — a conversation with one of your own deployments.
//
// You are always yourself here: the chat belongs to the token you are holding,
// on the `cli` channel. There is no flag that pretends to be a WhatsApp or
// Instagram visitor; the shared WhatsApp preview number and the Instagram test
// accounts do that for real, and a simulated channel was only ever a second
// answer to keep in step with the true one.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ApiClient } from "../api-client.mjs";
import { fail, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";

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
const REMOVED_FLAGS = ["--channel", "--from", "--as", "--sandbox-url"];

export async function chat(config, args) {
  // Not a conversation of your own, so none of what follows applies to it,
  // and its --from and --channel mean dates and a channel to read.
  if (args[0] === "export") return await exportChats(config, args.slice(1));

  for (const arg of args) {
    if (REMOVED_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      fail(
        `\`${arg}\` was removed. A CLI chat is you, the developer holding the token. ` +
          "To test a real channel add a test phone or Instagram account with Try the agent in the inbox; " +
          "to pick a deployment use --env."
      );
    }
  }

  const environment = takeEnv(args, { fallback: "preview" });
  const timeout = Number(takeValue(args, "--timeout") ?? 120);
  const lastValue = takeValue(args, "--last");
  const last = Number(lastValue ?? 10);
  const json = takeFlag(args, "--json");
  const fresh = takeFlag(args, "--new");
  const apiUrl = takeValue(args, "--api-url");
  const token = takeValue(args, "--token");

  const options = { environment, timeout, last, lastGiven: lastValue != null, json, apiUrl, token };
  if (args.length === 1 && RETIRED[args[0]]) fail(RETIRED[args[0]]);
  const sub = SUBCOMMANDS.has(args[0]) ? args.shift() : null;

  if (sub === "help") return console.log(chatHelp());
  if (sub === "show") return await showChat(config, options, args);

  if (fresh) await startOver(config, options);
  const message = args.join(" ").trim();
  if (message === "") return fresh ? undefined : console.log(chatHelp());

  return await converse(config, options, message);
}

export function chatHelp() {
  return `Usage:
  vatio chat "message" [--env NAME] [--new] [--timeout N]
  vatio chat show [CHAT_ID] [--env NAME] [--last N] [--json]
  ${EXPORT_USAGE}

--env picks the deployment that answers: preview (default), live, or a preview
name like pr-42. A chat against live is a real conversation and shows up in
your inbox.

\`show\` prints the chat you are in, with every tool call the agent made. Give
it an id to read any chat in the workspace -- one a visitor had on the web,
WhatsApp or Instagram -- with the environment and deployment that answered it.
Each message carries its id (#4821), the one \`vatio flags add --message\` takes.
A [your backend] line under a tool call is how your backend answered it.
A [safeguard] line says which of Vatio's checks discarded or rewrote a draft,
and a [vatio] line marks a reply Vatio wrote because the agent's turn produced
none: why, and whether anything in your workspace caused it.

The open chat per deployment is remembered in ${STATE_FILE}, so a second
\`vatio chat\` continues the first. \`--new\` starts over as a visitor the
workspace has never met.

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

// The chat `vatio chat` is in on this environment, for `vatio flags add`.
export function rememberedChatId(config, environment) {
  return chatsFor(config, config.resolveApiUrl())[environment] ?? null;
}

function rememberChat(config, { apiUrl, environment, chatId }) {
  const chats = { ...chatsFor(config, apiUrl), [environment]: chatId };
  writeFileSync(statePath(config), `${JSON.stringify({ api_url: apiUrl, chats }, null, 2)}\n`);
}

async function ensureChat(config, options) {
  const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
  const existing = chatsFor(config, apiUrl)[options.environment];
  if (existing) return Number(existing);

  const payload = await openChat(config, options, { apiUrl });
  return Number(payload.chat_id);
}

async function openChat(config, options, { apiUrl, chatId = null }) {
  const api = client(config, options);
  const payload = chatId
    ? await api.resetChat({ chatId, environment: options.environment })
    : await api.createChat({ environment: options.environment });

  rememberChat(config, { apiUrl, environment: options.environment, chatId: payload.chat_id });
  announce(options.environment);
  return payload;
}

// Live is not refused -- you asked for it -- but it is said out loud, once,
// when the chat opens. A conversation against live is a real one: it lands in
// the inbox next to the ones visitors started, and nothing downstream knows it
// came from a terminal.
function announce(environment) {
  if (environment === "live") {
    console.log("Talking to live — this is a real conversation and appears in your inbox.");
  } else {
    console.log(`Talking to ${environment}`);
  }
}

async function converse(config, options, message) {
  const api = client(config, options);
  const chatId = await ensureChat(config, options);
  const sent = await api.sendChatMessage({ chatId, content: message });
  const assistant = await waitForAssistant(api, {
    chatId,
    after: sent.user_message_id,
    timeout: options.timeout
  });
  console.log(formatVisitor(assistant));
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
  let chatId = args.shift();
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

async function startOver(config, options) {
  const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
  const payload = await openChat(config, options, {
    apiUrl,
    chatId: chatsFor(config, apiUrl)[options.environment] ?? null
  });
  console.log(`New ${options.environment} chat ${payload.chat_id}`);
}

function formatVisitor(message) {
  if (!message) return "";
  const role = message.role === "assistant" ? "agent" : "you";
  return `[${role}] ${String(message.content ?? "").trim()}`;
}
