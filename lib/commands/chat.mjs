// `vatio chat …` — a conversation with one of your own deployments.
//
// You are always yourself here: the chat belongs to the token you are holding,
// on the `cli` channel. There is no flag that pretends to be a WhatsApp or
// Instagram visitor; the shared WhatsApp preview number and the Instagram test
// accounts do that for real, and a simulated channel was only ever a second
// answer to keep in step with the true one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  for (const arg of args) {
    if (REMOVED_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      fail(
        `\`${arg}\` was removed. A CLI chat is you, the developer holding the token. ` +
          "To test a real channel add a test phone or Instagram account in the console; " +
          "to pick a deployment use --env."
      );
    }
  }

  const environment = takeEnv(args, { fallback: "preview", cwd: config.workspaceRoot });
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

function chatHelp() {
  return `Usage:
  vatio chat "message" [--env NAME] [--new] [--timeout N]
  vatio chat show [CHAT_ID] [--env NAME] [--last N] [--json]

--env picks the deployment that answers: preview (default), live, or a preview
name like pr-42. A chat against live is a real conversation and shows up in
your inbox.

\`show\` prints the chat you are in, with every tool call the agent made. Give
it an id to read any chat in the workspace -- one a visitor had on the web,
WhatsApp or Instagram -- with the environment and deployment that answered it.

The open chat per deployment is remembered in ${STATE_FILE}, so a second
\`vatio chat\` continues the first. \`--new\` starts over as a visitor the
workspace has never met.`;
}

function client(config, options) {
  const apiUrl = config.resolveApiUrl({ explicit: options.apiUrl });
  const token = options.token ?? config.resolveToken();
  if (!apiUrl) fail("A workspace API url is required (--api-url, or base_url + a vatio.yml with `workspace:`)");
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
    const flags = message.discarded ? " (discarded)" : "";
    if (content !== "" || flags) console.log(`[${message.role}]${flags} ${content}`);
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      console.log(`  -> ${call.name}(${truncate(JSON.stringify(call.arguments ?? {}), 400)})`);
    }
  }
  if (messages.length === 0) console.log("(no messages)");
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
