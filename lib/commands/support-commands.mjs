// docs and feedback — the commands that are about Vatio rather than about a
// deployment.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { fail, takeFlag, takeValue } from "../support.mjs";
import { clientHeaders, sendFeedback } from "../telemetry.mjs";
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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
