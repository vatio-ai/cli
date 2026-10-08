#!/usr/bin/env node
// Reconciles the CLI's command surface against `vatio help` and against
// the docs sources under docs/src, in both directions, and exits non-zero on drift.
//
// This replaces a skill that asked an agent to check by hand. A rule nobody
// can forget is worth more than a rule written down: the failure arrives from
// CI, names the command and says which of the three places is missing it, and
// an agent reading a red build fixes it without having been told to look.
//
// It deliberately checks only *existence*. A changed flag, a changed response
// shape or a changed error still needs a human -- a guard that claimed to
// cover those would be worse than one that says what it does.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repoRoot = join(packageRoot, "..");

const BIN = join(packageRoot, "bin", "vatio.mjs");
const HELP = join(packageRoot, "lib", "help.mjs");

// The docs are vatio.ai/docs, built by site/ from one Markdown file per page
// under docs/src. They are read here straight off disk,
// not from the built site, so this still runs on a bare checkout with no Ruby,
// no Node build and no network -- which is what lets cli-publish.yml run it.
//
// Every page, not just the CLI ones: a command may legitimately be documented
// wherever it is used, and a guard that only read cli/commands.md would start
// failing the first time one was explained somewhere better.
const DOCS_SRC = join(repoRoot, "docs", "src");
const DOCS_LABEL = "docs/src";

// The changelog is release notes, not the command surface, and it is the one
// page that must keep naming commands the CLI no longer has: "`vatio update`
// is gone, here is what to do instead" is the entry that tells someone on an
// old version what happened. Reading it here would fail the build for saying
// so.
const NOT_THE_SURFACE = new Set(["changelog.md"]);

function markdownUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownUnder(path);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return NOT_THE_SURFACE.has(entry.name) ? [] : [path];
  });
}

// One string, because every check below asks "is this mentioned anywhere in
// the docs" and none of them cares which page said it.
const docsText = markdownUnder(DOCS_SRC)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

// Aliases and flags that ride the dispatch but are not commands anyone
// documents as their own row.
const NOT_COMMANDS = new Set(["--version", "-v", "-h", "--help", "help", "undefined"]);

// Commands the product removed. They must appear in none of the three places
// except the dispatch arm that explains the removal.
const RETIRED = new Set(["pull", "update", "issue", "tools", "widget", "mcp"]);

const problems = [];

const dispatched = commandsFromDispatch(readFileSync(BIN, "utf8"));
const helped = commandsFrom(readFileSync(HELP, "utf8"), dispatched);
const documented = commandsFrom(docsText, dispatched);

for (const command of dispatched) {
  if (!helped.has(command)) {
    problems.push(`\`vatio ${command}\` is dispatched but never appears in lib/help.mjs`);
  }
  if (!documented.has(command)) {
    problems.push(`\`vatio ${command}\` is dispatched but never appears in ${DOCS_LABEL}`);
  }
}

for (const command of RETIRED) {
  if (helped.has(command)) problems.push(`\`vatio ${command}\` was removed but lib/help.mjs still offers it`);
  if (documented.has(command)) problems.push(`\`vatio ${command}\` was removed but ${DOCS_LABEL} still documents it`);
}

// The other direction: a command the docs promise and the CLI does not have is
// the worse half of the same drift, because a developer reads it and tries it.
for (const command of documented) {
  if (!dispatched.has(command) && !RETIRED.has(command) && !NOT_COMMANDS.has(command)) {
    problems.push(`${DOCS_LABEL} documents \`vatio ${command}\`, which the CLI does not dispatch`);
  }
}

// The Admin API is the owner's and their agents', never a customer's: it takes
// an admin key nobody else has. Documenting it on the public page would be
// describing a door the reader cannot open.
const adminMentions = [...docsText.matchAll(/^.*\/api\/admin\/v1.*$/gm)];
for (const [line] of adminMentions) {
  problems.push(`${DOCS_LABEL} documents the Admin API, which is not a customer's to call: ${line.trim()}`);
}

if (problems.length > 0) {
  console.error("Command surface drift:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nEvery command lives in three places: the dispatch in cli/bin/vatio.mjs, the\n" +
      "help in cli/lib/help.mjs, and the command tables under docs/src/cli/. Add or\n" +
      "remove it in all three in the same commit."
  );
  process.exit(1);
}

console.log(`Command surface is consistent (${dispatched.size} commands, help and docs agree).`);

// `case "push":` in the dispatch switch. Read out of the source rather than by
// running the CLI, so this needs no network, no token and no workspace.
function commandsFromDispatch(source) {
  const block = source.slice(source.indexOf("switch (command)"), source.indexOf("main(process.argv)"));
  const names = [...block.matchAll(/case "([a-z-]+)":/g)].map((match) => match[1]);
  return new Set(names.filter((name) => !NOT_COMMANDS.has(name) && !RETIRED.has(name)));
}

// A command counts as mentioned when its name appears at the start of a line
// (the help's own layout) or after `vatio ` anywhere. Both are how a reader
// finds it, and neither can be satisfied by the word turning up in prose.
function commandsFrom(text, candidates) {
  const found = new Set();
  for (const command of candidates) {
    const mentioned =
      new RegExp(`vatio ${command}\\b`).test(text) ||
      new RegExp(`^\\s{2,}${command}\\b`, "m").test(text);
    if (mentioned) found.add(command);
  }
  // Retired commands are looked for separately, since they are not candidates.
  for (const command of RETIRED) {
    if (new RegExp(`vatio ${command}\\b`).test(text)) found.add(command);
  }
  return found;
}
