// Terminal plumbing shared by every command: how the CLI stops, and how it
// reads the flags that mean the same thing everywhere.

import { execFileSync } from "node:child_process";

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

// The Ruby CLI's `abort`: a sentence on stderr and exit 1. Thrown rather than
// exiting on the spot so one place at the top decides how a failure prints.
export function fail(message) {
  throw new UserError(message);
}

// `--env NAME` is the one way to say which environment a command is about:
// preview or live. The platform validates the name.
//
// Without it, the default is the command's own and is passed in, because the
// sensible answer differs: push writes preview, tokens are for live. `--as`
// was the spelling on push and publish and stays as an alias -- it is sitting
// in CI jobs, and there is nothing wrong with what it does.
export function takeEnv(args, { fallback = null } = {}) {
  let environment;
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const match = /^--(env|as)(?:=(.*))?$/.exec(arg);
    if (!match) {
      rest.push(arg);
      continue;
    }
    if (match[2] !== undefined) {
      environment = match[2];
      continue;
    }
    i += 1;
    if (i >= args.length) fail(`${match[0]} needs an environment name (preview or live)`);
    environment = args[i];
  }

  args.length = 0;
  args.push(...rest);
  return environment !== undefined ? environment : fallback;
}

export function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

export function takeValue(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const value = args[i + 1];
      if (value === undefined) fail(`${name} needs a value`);
      args.splice(i, 2);
      return value;
    }
    const prefix = `${name}=`;
    if (args[i].startsWith(prefix)) {
      const value = args[i].slice(prefix.length);
      args.splice(i, 1);
      return value;
    }
  }
  return null;
}

// Stamped on a deployment so a revision can be traced back to a commit. Absent
// outside a repository, which is fine -- a workspace does not have to be in one.
export function detectGitSha(cwd) {
  return git(cwd, ["rev-parse", "HEAD"]);
}

// Sent with a push so the platform can refuse one that would replace an
// unpublished push from another branch. Null outside a repository or with
// HEAD detached.
export function detectGitBranch(cwd) {
  return git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Works without a terminal too: a coding agent running on the developer's own
// machine still opens their browser.
export function openBrowser(url) {
  if (!url) return;
  const command =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    execFileSync(command[0], command[1], { stdio: "ignore" });
  } catch {
    // A headless machine has no browser to open, and the URL is already
    // printed above this call. Nothing to report.
  }
}

// Returns "" with nothing attached to stdin, so an agent running `vatio push`
// in a pipeline never hangs on a prompt.
export async function ask(question) {
  if (!process.stdin.isTTY) return "";

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const COLORS = { green: 32, yellow: 33, cyan: 36 };

export function paint(color, text) {
  if (process.env.NO_COLOR || !process.stderr.isTTY) return text;
  return `\x1b[${COLORS[color]}m${text}\x1b[0m`;
}

// A value typed or pasted with a star echoed per character, gh-style, so a
// secret never lands in shell history or terminal scrollback. Off a terminal
// the value is whatever arrives on stdin: `op read … | vatio secrets set KEY`.
export async function askSecret(question) {
  if (!process.stdin.isTTY) return (await readStdin()).replace(/\r?\n$/, "");

  const input = process.stdin;
  const output = process.stderr;
  output.write(question);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return await new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new UserError("Cancelled"));
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = [...value].slice(0, -1).join("");
            output.write("\b \b");
          }
          continue;
        }
        if (char < " ") continue;
        value += char;
        output.write("*");
      }
    };
    input.on("data", onData);
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
