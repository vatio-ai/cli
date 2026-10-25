// contacts — privacy requests on one person: what Vatio keeps about a contact,
// and forgetting them. The ID is the contact's number in the inbox.

import { writeFileSync } from "node:fs";
import { deployClient } from "./deploy.mjs";
import { ask, fail, paint, takeFlag, takeValue } from "../support.mjs";

const USAGE = "Usage: vatio contacts export ID [--out FILE]\n" +
  "       vatio contacts delete ID [--yes] [--json]";

export async function contacts(config, args) {
  const sub = args.shift();
  if (sub === "export") return await exportContact(config, args);
  if (sub === "delete") return await deleteContact(config, args);
  fail(USAGE);
}

async function exportContact(config, args) {
  const out = takeValue(args, "--out");
  const id = args.shift();
  if (!id || args.length > 0) fail(USAGE);

  const workspace = config.resolveWorkspaceRequired();
  const data = await deployClient(config, workspace).exportContact({ id });
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (!out) return process.stdout.write(text);
  writeFileSync(out, text);
  console.log(`${paint("green", "✓")} Wrote everything Vatio keeps about contact #${id} to ${out}`);
}

async function deleteContact(config, args) {
  const yes = takeFlag(args, "--yes");
  const json = takeFlag(args, "--json");
  const id = args.shift();
  if (!id || args.length > 0) fail(USAGE);

  const workspace = config.resolveWorkspaceRequired();
  if (!yes) {
    if (!process.stdin.isTTY) fail(`Deleting a contact cannot be undone, so without a terminal it needs --yes.\n\n${USAGE}`);
    console.log(`This deletes contact #${id} on workspace ${workspace} for good: the contact, its channels,`);
    console.log("memories and every conversation and message with them. Export first if you need a copy:");
    console.log(`  vatio contacts export ${id} --out contact-${id}.json`);
    const typed = await ask(`${paint("green", "?")} Type ${id} to delete them: `);
    if (typed !== String(id)) fail("Not deleted: what you typed is not the contact's ID.");
  }

  const answer = await deployClient(config, workspace).deleteContact({ id });
  if (json) return console.log(JSON.stringify(answer, null, 2));
  console.log(`${paint("green", "✓")} Deleted contact #${answer.contact_id ?? id}: ` +
    `${answer.chats ?? 0} conversation${answer.chats === 1 ? "" : "s"}, ${answer.messages ?? 0} message${answer.messages === 1 ? "" : "s"}.`);
}
