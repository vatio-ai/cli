// `vatio mcp` — the same CLI, spoken as Model Context Protocol over stdio, so a
// coding agent drives the commands a developer would instead of writing its own
// client for the API.
//
// It wraps the CLI rather than the API on purpose: what the agent reads is
// exactly what the developer would have seen, including the advice at the end
// of a failure. Every command gets a decision recorded in one of two tables --
// COMMANDS (offered) or WITHHELD (deliberately not) -- and the default for a
// command nobody thought about is "not offered".

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";

import { VERSION } from "../version.mjs";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_OUTPUT = 20_000;
const TIMEOUT_MS = 180_000;

const COMMANDS = {
  docs: {
    usage: "[--save [PATH]]",
    summary:
      "The Vatio developer contract as markdown, live from the platform: vatio.yml, tools, auth, " +
      "visitor identity, knowledge, channels, the tool result shape, the whole CLI and API. Read " +
      "this before writing or changing anything in a workspace.",
    auth: false,
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  doctor: {
    usage: "",
    summary:
      "Node, config, workspace and token status. Run this when a command fails for a reason that " +
      "does not look like the workspace itself.",
    auth: false,
    annotations: { readOnlyHint: true }
  },
  tools: {
    usage: "check",
    summary:
      "`tools check` sends the workspace to Vatio and validates it against the contracts there — " +
      "manifest shape, tool specs, handler signatures — without deploying anything. The fastest " +
      "way to find out whether an edit is deployable; push runs the same check anyway.",
    annotations: { readOnlyHint: true }
  },
  status: {
    usage: "",
    summary: "Preview and live deployment state for this workspace.",
    annotations: { readOnlyHint: true }
  },
  diff: {
    usage: "[--env NAME] [--stat|--name-only|--format json|--full]",
    summary:
      "What this directory would change against a deployment — preview by default. `--env live` " +
      "answers \"what would publishing change?\" without publishing.",
    annotations: { readOnlyHint: true }
  },
  push: {
    usage: "[--env NAME]",
    summary:
      "Validate the workspace and update a preview deployment. Never touches live. On a git branch " +
      "other than the default one it lands on that branch's own environment (fix/pagos -> fix-pagos), " +
      "the same one the branch's pull request deploys to; elsewhere on `preview`.",
    annotations: { readOnlyHint: false }
  },
  publish: {
    usage: "[--env NAME]",
    summary:
      "Promote an environment to live, with the knowledge changes made in it — what customers see. " +
      "Ask the developer first: this is the one step that changes what real visitors get. Refused " +
      "when the workspace is connected to GitHub: there, live changes only by merging the branch's " +
      "pull request. Refused too when live changed an entry this environment also changed.",
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  env: {
    usage: "[NAME] | list | rm NAME",
    summary:
      "The environment this workspace is working in — the branch's own on a branch — with its " +
      "publishable token, widget snippet, share link, the knowledge entries it changed and any that " +
      "live changed underneath. Use its token to point an app being developed at this environment.",
    annotations: { readOnlyHint: true }
  },
  rollback: {
    usage: "",
    summary: "Put live back to the previous snapshot — its configuration and its knowledge together. Same weight as publish — ask first.",
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  chat: {
    usage: '"message" | transcript | debug | reset [--env NAME] | show CHAT_ID [--json]',
    summary:
      "Talk to the deployed agent as the developer holding the token, and read the transcript. " +
      "`debug` shows the developer view, including tool calls. `--env live` is a real conversation " +
      "that appears in the inbox. `show CHAT_ID` reads any chat in the workspace — a visitor's on " +
      "the web or WhatsApp too — with the environment and deployment that answered it.",
    annotations: { readOnlyHint: false }
  },
  secrets: {
    usage: "list | set KEY VALUE | rm KEY [--env NAME]",
    summary:
      "Credentials the workspace's tools read as $env.KEY. Values are write-only — listing shows " +
      "keys, never values. On a branch (or with --env) a value applies to that environment only, " +
      "replacing the one everywhere else: point a branch's tools at staging without touching live.",
    annotations: { readOnlyHint: false }
  },
  kb: {
    usage:
      "[list] | show NAME | create NAME | write BASE ENTRY [FILE] | cat BASE ENTRY [--version N] | " +
      "rm-entry BASE ENTRY | follow BASE URL | unfollow BASE URL | refresh BASE [URL] | status BASE | " +
      "publish BASE | history BASE   (entry commands take --env NAME)",
    summary:
      "Knowledge bases, which belong to the workspace rather than to a deployment: `knowledge:` in " +
      "vatio.yml is a list of names, and a push neither fills nor empties one. The entries are live; " +
      "writes on a branch are changes only that branch's preview answers from, and they go live with " +
      "vatio_publish or the merge of its pull request. `status` names entries live changed underneath: " +
      "read those from live (`cat --env live`), write your change on top, and the conflict clears.",
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  tokens: {
    usage: "list | create [--env NAME] [--label NAME] [--origin URL]... | origins PREFIX URL... | revoke PREFIX",
    summary:
      "Publishable tokens for the widget and anything built on the SDK. A created token is shown in " +
      "full exactly once. Each token works only from its own allowed origins (--origin, repeatable, or " +
      "`origins PREFIX URL...` to replace the list); the install snippet's token is edited in the console.",
    annotations: { readOnlyHint: false }
  },
  widget: {
    usage: "[--env NAME]",
    summary:
      "What the platform will actually enforce for the widget, the origins its tokens accept, and the " +
      "tokens that exist. Read-only: the look is edited on the console's Brand page, whose URL it prints.",
    annotations: { readOnlyHint: true }
  },
  whatsapp: {
    usage: "[status] | check | activate | deactivate | numbers [list | add PHONE | verify PHONE CODE]",
    summary:
      "The workspace's own WhatsApp number, which serves live: whether it is connected, whether Meta " +
      "delivers to it, and whether it is answering — three things that fail separately. `numbers` is " +
      "the other thing: the shared WhatsApp preview, test phones that reach the environment they point at (`point PHONE --env NAME`) and need no Meta " +
      "account. A code goes to the handset, so a human has to read it back to you.",
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  instagram: {
    usage: "[status] | check | accounts [list | add @HANDLE | verify CODE]",
    summary:
      "The workspace's own Instagram account, which serves live, and the shared Instagram preview " +
      "under `accounts`. Registering a test account goes handle first, then the developer DMs the " +
      "preview account from it and Vatio replies with a code. `instagram connect` is not here — it " +
      "needs Meta's consent screen in a browser.",
    annotations: { readOnlyHint: false, openWorldHint: true }
  }
};

// Named rather than merely absent, so the reason travels with the refusal.
const WITHHELD = {
  login: "needs a browser and a person approving a code",
  logout: "would take the developer's credential away from them",
  init: "creates a remote workspace; the developer decides that one",
  issue: "writes to a human's inbox in the developer's name",
  config: "edits the developer's own credentials file",
  version: "nothing an agent needs; `doctor` says more",
  help: "the tool list is this",
  mcp: "this"
};

const BLOCKED_SUBCOMMANDS = {
  chat: { destroy: "destroys a conversation; ask the developer" },
  kb: { rm: "deletes an indexed base; ask the developer" },
  env: { rm: "removes an environment with its unpublished knowledge changes; ask the developer" },
  whatsapp: { connect: "takes Meta credentials the developer holds", disconnect: "ask the developer" },
  instagram: { connect: "needs Meta's consent screen in a browser", disconnect: "ask the developer" }
};

const toolName = (command) => `vatio_${command}`;

export async function mcp(config) {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "vatio.mjs");
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of reader) {
    if (line.trim() === "") continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    const response = await handle(message, { config, cliPath });
    // A notification has no id and gets no reply, which is the whole of the
    // difference between the two in JSON-RPC.
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

async function handle(message, context) {
  const id = message.id;
  if (id === undefined || id === null) return null;

  const reply = (result) => ({ jsonrpc: "2.0", id, result });

  switch (message.method) {
    case "initialize":
      return reply(initializeResult(message.params));
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolDefinitions() });
    case "tools/call":
      return reply(await callTool(message.params ?? {}, context));
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${message.method}` } };
  }
}

function initializeResult(params) {
  const requested = params?.protocolVersion;
  const version = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];

  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "vatio", version: VERSION },
    instructions: [
      "These tools run the Vatio CLI. A workspace is any directory holding a vatio.yml, and that",
      "directory decides which remote it deploys to — there is no workspace flag. Pass workspace_dir",
      "when the workspace is not the directory this server started in.",
      "",
      "Start with vatio_docs: it is the contract for vatio.yml, tools, auth, visitor identity and",
      "knowledge, fetched live from the platform, so it is what the platform actually accepts.",
      "",
      "Work on a git branch (a worktree is ideal): every command then uses that branch's own",
      "environment — its agent, its knowledge changes, its secret values — and nothing you do there",
      "reaches live or another branch. vatio_env shows which one and the token to point an app at it.",
      "",
      "The loop is: edit files and knowledge (vatio_kb write), vatio_push, vatio_chat to read the",
      "agent's answer, then publish when the developer says so — by merging the branch's pull request",
      "when GitHub is connected, vatio_publish otherwise. The prompt and the knowledge go live together.",
      "",
      "Anything that needs a browser or a person — login, issue, instagram connect — is not here;",
      "ask the developer to run it in their terminal."
    ].join("\n")
  };
}

function toolDefinitions() {
  return Object.entries(COMMANDS).map(([command, spec]) => ({
    name: toolName(command),
    description: `${spec.summary}\n\nUsage: ${usageLine(command, spec)}`,
    inputSchema: {
      type: "object",
      properties: {
        args: { type: "array", items: { type: "string" }, description: `Arguments after \`vatio ${command}\`` },
        workspace_dir: { type: "string", description: "Directory holding vatio.yml; defaults to the cwd" }
      },
      required: []
    },
    annotations: spec.annotations ?? {}
  }));
}

function usageLine(command, spec) {
  return spec.usage ? `vatio ${command} ${spec.usage}` : `vatio ${command}`;
}

async function callTool(params, { config, cliPath }) {
  const name = params.name;
  const command = Object.keys(COMMANDS).find((key) => toolName(key) === name);
  if (!command) {
    const withheld = Object.keys(WITHHELD).find((key) => toolName(key) === name);
    if (withheld) return errorResult(`\`vatio ${withheld}\` is not offered here: ${WITHHELD[withheld]}.`);
    return errorResult(`Unknown tool ${name}. Offered: ${Object.keys(COMMANDS).map(toolName).join(", ")}`);
  }

  const args = Array.isArray(params.arguments?.args) ? params.arguments.args.map(String) : [];
  const blocked = BLOCKED_SUBCOMMANDS[command]?.[args[0]];
  if (blocked) return errorResult(`\`vatio ${command} ${args[0]}\` is not offered here: ${blocked}.`);

  if (COMMANDS[command].auth !== false && !config.resolveToken()) {
    return errorResult(
      "Not logged in: no token in VATIO_TOKEN or ~/.vatio/config.json. Ask the developer to run " +
        "`vatio login` in their terminal — the device authorization needs a browser — and this " +
        "server picks the token up from there."
    );
  }

  const dir = params.arguments?.workspace_dir ?? process.cwd();
  const { stdout, stderr, code, timedOut } = await run(cliPath, [command, ...args], dir);

  if (timedOut) return errorResult(`\`vatio ${command}\` did not finish within ${TIMEOUT_MS / 1000}s.`);

  const body = [stdout, stderr].map((part) => part.trim()).filter(Boolean).join("\n");
  if (code !== 0) return errorResult(`${body}\n\n\`vatio ${command}\` exited ${code}.`.trim());
  return { content: [{ type: "text", text: truncate(body) }], isError: false };
}

function run(cliPath, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr: String(error.message), code: 1, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? 1, timedOut });
    });
  });
}

// A failure is a tool result, not a protocol error: exiting or raising would
// take the whole session down over one bad push.
function errorResult(message) {
  return { content: [{ type: "text", text: truncate(message) }], isError: true };
}

function truncate(text) {
  const value = String(text ?? "");
  return value.length <= MAX_OUTPUT ? value : `${value.slice(0, MAX_OUTPUT - 3)}...`;
}
