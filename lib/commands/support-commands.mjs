// docs — the command that is about Vatio rather than about a deployment.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { fail, takeFlag, takeValue } from "../support.mjs";
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
      headers: { Accept: "text/markdown, text/plain" },
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
