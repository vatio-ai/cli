// Review and deliberately resend failed outbound WhatsApp messages. The
// platform owns the retry relationship and idempotency key; the CLI only
// selects attempts and makes the operator see them before sending.

import { deployClient } from "./deploy.mjs";
import { ask, fail, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";

const MAX_BATCH = 200;
const USAGE = "vatio messages failed [--since DATE] [--until DATE] [--error-code CODE] [--error-contains TEXT] [--before ID] [--json]\n" +
  "       vatio messages resend ID [--env live]\n" +
  "       vatio messages resend --since DATE (--error-code CODE|--error-contains TEXT) [--until DATE] [--before ID] [--yes]";

export async function messages(config, args) {
  const environment = takeEnv(args, { fallback: "live" });
  const json = takeFlag(args, "--json");
  const yes = takeFlag(args, "--yes") || takeFlag(args, "-y");
  const since = takeValue(args, "--since");
  const until = takeValue(args, "--until");
  const errorCode = takeValue(args, "--error-code");
  const errorContains = takeValue(args, "--error-contains");
  const before = takeValue(args, "--before");
  const status = takeValue(args, "--status");
  const sub = args.shift() ?? "failed";
  if (status !== null && status !== "failed") fail("Only --status failed is supported");
  if (!(["failed", "resend"].includes(sub)) || (sub === "resend" && json)) fail(`Usage: ${USAGE}`);
  if (args.length > 1 || (sub === "failed" && args.length > 0)) fail(`Usage: ${USAGE}`);
  if (before !== null && !/^[1-9]\d*$/.test(before)) fail("--before needs a positive message ID");

  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);

  if (sub === "resend" && args.length === 1) {
    if (!/^\d+$/.test(args[0]) || since || until || errorCode || errorContains || before) fail(`Usage: ${USAGE}`);
    const { message, replayed } = await client.resendMessage(args[0], { environment });
    console.log(`Message #${args[0]} → retry #${message.id} (${message.status})${replayed ? " — already created" : ""}`);
    return;
  }

  if (sub === "resend" && (!since || (!errorCode && !errorContains))) {
    fail("A batch resend needs --since and --error-code or --error-contains, so it cannot catch unrelated failures.\n" + USAGE);
  }

  const selection = { environment, since, until, errorCode, errorContains, before };
  const { list, nextBefore } = await collect(client, selection);
  if (sub === "failed" && json) return console.log(JSON.stringify({ messages: list, next_before: nextBefore }, null, 2));

  console.log(`${list.length} failed message${list.length === 1 ? "" : "s"} on ${workspace} (${environment}):`);
  for (const row of list) {
    console.log(`  #${row.id}  ${row.created_at}  ${row.mode}  ${row.error_code || "?"}  ${row.error_message || ""}`);
  }
  if (nextBefore) console.log(`More may match. Continue with --before ${nextBefore} after this batch.`);
  if (sub === "failed" || list.length === 0) return;

  if (!yes) {
    if (!process.stdin.isTTY) fail("Nothing resent. Review the selection above, then pass --yes.");
    const answer = (await ask(`Resend these ${list.length} messages? [y/N] `)).trim().toLowerCase();
    if (!["y", "yes", "s", "si", "sí"].includes(answer)) return console.log("Nothing resent.");
  }

  let resent = 0;
  let replayed = 0;
  let failed = 0;
  for (const [index, row] of list.entries()) {
    try {
      const result = await client.resendMessage(row.id, { environment });
      console.log(`  #${row.id} → #${result.message.id} (${result.message.status})${result.replayed ? " — already created" : ""}`);
      if (result.replayed) replayed += 1;
      else resent += 1;
    } catch (error) {
      console.error(`  #${row.id} → could not resend: ${error.message}`);
      failed += 1;
      if ([401, 403, 429].includes(error.status)) break;
    }
    if (index < list.length - 1) await sleep(1_100);
  }
  const skipped = list.length - resent - replayed - failed;
  console.log(`Queued ${resent} new retry attempt${resent === 1 ? "" : "s"}; ${replayed} already existed; ${failed} refused; ${skipped} not attempted.`);
  if (failed > 0 || skipped > 0) process.exitCode = 1;
  console.log("Follow their status in the inbox or server API.");
}

async function collect(client, selection) {
  const list = [];
  let before = selection.before;
  do {
    const page = await client.failedMessages({ ...selection, before });
    list.push(...(page.messages ?? []));
    before = page.next_before ?? null;
  } while (before !== null && list.length < MAX_BATCH);
  return { list, nextBefore: before };
}
