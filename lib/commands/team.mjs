// team — who is in the workspace, and as what: what the inbox's Team page does,
// for a coding agent that is asked to "add Ana as a supervisor". The owner's
// alone, like the page. A person is named by their email, or by their number
// when they are on the team by their WhatsApp alone; the platform keys them by
// membership, which the list gives.

import { deployClient } from "./deploy.mjs";
import { errorCode } from "../http.mjs";
import { askSecret, fail, paint, takeFlag, takeValue } from "../support.mjs";

// The answers that say something the generic 401 and 403 lines would hide.
const SAYS_WHY = new Set(["owner_only", "reauthentication_required", "invalid_confirmation"]);

function explain(error) {
  const code = errorCode(error);
  if (SAYS_WHY.has(code)) fail(error.message);
  throw error;
}

// supervisor: the business's team; business: the business itself; developer: the
// agency. viewer is no longer offered (WorkspaceMembership::INVITABLE_ROLES).
const ROLES = ["supervisor", "business", "developer"];
const USAGE = `Usage: vatio team [list] [--json]\n` +
  `       vatio team invite EMAIL --role ${ROLES.join("|")} [--code CODE | --recovery-code CODE] [--json]\n` +
  "       vatio team invite --whatsapp +56912345678 --name NAME [--code CODE | --recovery-code CODE] [--json]\n" +
  "         a supervisor by their WhatsApp alone: the agent knows them by that number; no email, no inbox\n" +
  `       vatio team role EMAIL|PHONE ${ROLES.join("|")} [--code CODE | --recovery-code CODE] [--json]\n` +
  "       vatio team rm EMAIL|PHONE [--json]\n" +
  "       vatio team resend EMAIL [--json]\n" +
  "  With a second factor on your account, --code is the 6-digit code from your authenticator app.\n" +
  "       vatio team questions [--to EMAIL...|--none] [--template NAME [--language CODE]|--no-template] [--json]\n" +
  "       vatio team questions history [--status pending|answered|all] [--before ID] [--json]";

export async function team(config, args) {
  const json = takeFlag(args, "--json");
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    if (args.length > 0) fail(USAGE);
    return print(await client.members().catch(explain), workspace, json);
  }

  if (sub === "questions") return await questions(client, workspace, args, json);

  if (sub === "invite") {
    const role = takeValue(args, "--role");
    const code = takeValue(args, "--code");
    const recoveryCode = takeValue(args, "--recovery-code");
    const whatsapp = takeValue(args, "--whatsapp");
    const name = takeValue(args, "--name");
    if (whatsapp) {
      if (!name || role || args.length > 0) fail(`--whatsapp takes --name, and no email or --role: always a supervisor.\n\n${USAGE}`);
      const answer = await invite(client, { whatsapp, name, code, recovery_code: recoveryCode }).catch(explain);
      if (!json) {
        console.log(`${paint("green", "✓")} ${name} is on the team by WhatsApp (${whatsapp}). Nothing was sent to them: ` +
          "the agent knows them from their first message from that number.");
        console.log("");
      }
      return print(answer, workspace, json);
    }
    const email = args.shift();
    if (!email || args.length > 0) fail(USAGE);
    // The platform would make an unknown role a supervisor; here it is asked for.
    if (!ROLES.includes(role)) fail(`--role is required: ${ROLES.join(", ")}\n\n${USAGE}`);
    const answer = await invite(client, { email, role, code, recovery_code: recoveryCode }).catch(explain);
    if (!json) {
      console.log(`${paint("green", "✓")} Invited ${email.trim().toLowerCase()} as ${role}. They get an email, and sign in with that address.`);
      console.log("");
    }
    return print(answer, workspace, json);
  }

  if (sub === "role" || sub === "rm" || sub === "remove" || sub === "resend") {
    const code = takeValue(args, "--code");
    const recoveryCode = takeValue(args, "--recovery-code");
    const email = args.shift();
    const role = sub === "role" ? args.shift() : null;
    if (!email || args.length > 0 || (sub === "role" && !ROLES.includes(role))) fail(USAGE);
    const member = await memberByEmail(client, email);
    let answer;
    if (sub === "role") {
      answer = await withSecondFactor((confirmed) => client.updateMember(member.id, confirmed),
        { role, code, recovery_code: recoveryCode }).catch(explain);
    } else if (sub === "resend") {
      answer = await client.resendMember(member.id).catch(explain);
    } else {
      answer = await client.removeMember(member.id).catch(explain);
    }
    if (!json) {
      const who = label(member);
      const done = { role: `${who} is now ${role}`, resend: `Sent ${who} the invitation again`,
        rm: `Removed ${who}: they no longer reach this workspace`, remove: `Removed ${who}` }[sub];
      console.log(`${paint("green", "✓")} ${done}.`);
      console.log("");
    }
    return print(answer, workspace, json);
  }

  fail(USAGE);
}

// By email, or by number for someone on WhatsApp alone (they have no email).
async function memberByEmail(client, email) {
  const wanted = email.trim().toLowerCase();
  const digits = wanted.replace(/\D/g, "");
  const list = await client.members().catch(explain);
  const member = (list.data ?? []).find((row) =>
    (row.email && String(row.email).toLowerCase() === wanted) ||
    (row.phone_number && digits.length >= 8 && String(row.phone_number).replace(/\D/g, "") === digits));
  if (!member) fail(`${wanted} is not on this workspace's team (vatio team list).`);
  return member;
}

const label = (member) => member.email ?? `${member.name ?? "someone"} (WhatsApp ${member.phone_number})`;

function print(answer, workspace, json) {
  if (json) return console.log(JSON.stringify(answer, null, 2));
  const members = answer.data ?? [];
  console.log(`Team on workspace ${workspace}:`);
  if (answer.owner) console.log(`  owner       ${answer.owner.email}`);
  for (const member of members) {
    const note = member.whatsapp_only ? "  (WhatsApp only, no inbox)" : member.pending ? "  (has not signed in yet)" : "";
    console.log(`  ${member.role.padEnd(11)} ${label(member)}${note}`);
  }
  if (members.length === 0) console.log("  No one else. Invite someone: vatio team invite EMAIL --role supervisor");
}

// An owner with a second factor confirms it is them, as the inbox asks. From a
// terminal the code is asked for; a coding agent has none, so it fails with what
// to ask the person for.
// `vatio whatsapp invite` asks the same way.
const invite = (client, body) => withSecondFactor((confirmed) => client.inviteMember(confirmed), body);

export async function withSecondFactor(send, body) {
  const confirmed = Object.fromEntries(Object.entries(body).filter(([, value]) => value));
  try {
    return await send(confirmed);
  } catch (error) {
    const needsCode = error?.status === 403 && errorCode(error) === "reauthentication_required";
    if (!needsCode || confirmed.code || confirmed.recovery_code) throw error;
    if (!process.stdin.isTTY || !/--code/.test(error.message)) throw error;
    const code = await askSecret(`${paint("green", "?")} Code from your authenticator app: `);
    return await send({ ...confirmed, code });
  }
}

// Who the agent asks when it cannot answer a customer, and the template that
// opens the conversation with them (the Team page's "Questions from the agent").
async function questions(client, workspace, args, json) {
  if (args[0] === "history") return await history(client, workspace, args.slice(1), json);
  const template = takeValue(args, "--template");
  const language = takeValue(args, "--language");
  const noTemplate = takeFlag(args, "--no-template");
  const none = takeFlag(args, "--none");
  const to = [];
  for (let index = args.indexOf("--to"); index !== -1; index = args.indexOf("--to")) {
    args.splice(index, 1);
    while (args.length > index && !args[index].startsWith("--")) to.push(args.splice(index, 1)[0]);
  }
  if (args.length > 0 || (to.length > 0 && none) || (template && noTemplate)) fail(USAGE);

  const change = {};
  if (none) change.emails = [];
  if (to.length > 0) change.emails = to;
  if (template) change.template = { name: template, language: language ?? "es" };
  if (noTemplate) change.template = null;

  const answer = Object.keys(change).length === 0
    ? await client.questionSettings().catch(explain)
    : await client.setQuestionSettings(change).catch(explain);
  if (json) return console.log(JSON.stringify(answer, null, 2));
  if (Object.keys(change).length > 0) console.log(`${paint("green", "✓")} Saved.\n`);

  console.log(`Who the agent asks on workspace ${workspace}${answer.recipients.some((row) => row.selected) ? "" : " (nobody: it says it does not know)"}:`);
  for (const row of answer.recipients) {
    const flags = [row.selected ? "asked" : "", row.whatsapp_verified ? "" : "no WhatsApp verified"].filter(Boolean).join(", ");
    console.log(`  ${(row.role ?? "").padEnd(11)} ${row.email}${flags ? `  (${flags})` : ""}`);
  }
  console.log(answer.template
    ? `Template to start the conversation: ${answer.template.name} (${answer.template.language}), body: {{1}} customer, {{2}} question.`
    : "Template to start the conversation: none, so it only reaches who wrote to the agent in the last 24 hours.");
}

// What the agent asked the team when it could not answer a customer, and how
// each was answered (the inbox's Team questions page). Anyone who reads the
// conversations reads it.
async function history(client, workspace, args, json) {
  const status = takeValue(args, "--status") ?? "all";
  const before = takeValue(args, "--before");
  if (args.length > 0) fail(USAGE);

  const page = await client.questions({ status, before }).catch(explain);
  if (json) return console.log(JSON.stringify(page, null, 2));
  if (page.data.length === 0) return console.log(`No questions to the team on workspace ${workspace}.`);

  for (const row of page.data) {
    const state = row.status === "pending"
      ? (row.sent_to_team ? "waiting" : "not sent yet")
      : row.answered_directly ? "answered directly" : row.status;
    console.log(`#${row.id}  ${row.asked_at.slice(0, 16).replace("T", " ")}  ${state}${row.customer ? `  ${row.customer}` : ""}`);
    console.log(`  Q: ${row.question}`);
    if (row.answer) console.log(`  A: ${row.answer}${row.answered_by ? `  (${row.answered_by})` : ""}`);
    if (row.knowledge) console.log(`  Saved as: ${row.knowledge.base}/${row.knowledge.entry} v${row.knowledge.version}`);
  }
  if (page.next_before) console.log(`\nMore: vatio team questions history --status ${status} --before ${page.next_before}`);
}
