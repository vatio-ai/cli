// Review terminal failures after Vatio has finished its automatic attempts.

import { deployClient } from "./deploy.mjs";
import { fail, takeEnv, takeFlag, takeValue } from "../support.mjs";

const USAGE = "vatio whatsapp failed [--since DATE] [--until DATE] [--error-code CODE] " +
  "[--error-contains TEXT] [--before ID] [--json]";

export async function messages(config, args) {
  const environment = takeEnv(args, { fallback: "live" });
  const json = takeFlag(args, "--json");
  const since = takeValue(args, "--since");
  const until = takeValue(args, "--until");
  const errorCode = takeValue(args, "--error-code");
  const errorContains = takeValue(args, "--error-contains");
  const before = takeValue(args, "--before");
  const sub = args.shift() ?? "failed";
  if (sub !== "failed" || args.length > 0) fail(`Usage: ${USAGE}`);
  if (before !== null && !/^[1-9]\d*$/.test(before)) fail("--before needs a positive message ID");

  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const page = await client.failedMessages({ environment, since, until, errorCode, errorContains, before });
  if (json) return console.log(JSON.stringify(page, null, 2));

  console.log(`${page.messages.length} failed messages on ${workspace} (${environment}):`);
  for (const row of page.messages) {
    console.log(`  #${row.id}  ${row.created_at}  ${row.mode}  ${row.error_code || "?"}  ${row.error_message || ""}`);
  }
  if (page.next_before) console.log(`More may match. Continue with --before ${page.next_before}.`);
}
