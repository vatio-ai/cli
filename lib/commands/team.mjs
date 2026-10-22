// team — who is in the workspace, and inviting someone: what the inbox's Team
// page does, for a coding agent that is asked to "add Ana as a supervisor". The
// owner's alone, like the page. Removing a member and changing a role stay in
// the inbox, where the owner confirms it is them.

import { deployClient } from "./deploy.mjs";
import { askSecret, fail, paint, takeFlag, takeValue } from "../support.mjs";

// The answers that say something the generic 401 and 403 lines would hide.
const SAYS_WHY = new Set(["owner_only", "reauthentication_required", "invalid_confirmation"]);

function explain(error) {
  const code = error?.body?.error?.code;
  if (SAYS_WHY.has(code)) fail(error.message);
  throw error;
}

const ROLES = ["viewer", "supervisor", "developer"];
const USAGE = `Usage: vatio team [list] [--json]\n` +
  `       vatio team invite EMAIL --role ${ROLES.join("|")} [--code CODE | --recovery-code CODE] [--json]\n` +
  "  With a second factor on your account, --code is the 6-digit code from your authenticator app.";

export async function team(config, args) {
  const json = takeFlag(args, "--json");
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    if (args.length > 0) fail(USAGE);
    return print(await client.members().catch(explain), workspace, json);
  }

  if (sub === "invite") {
    const role = takeValue(args, "--role");
    const code = takeValue(args, "--code");
    const recoveryCode = takeValue(args, "--recovery-code");
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

  fail(USAGE);
}

function print(answer, workspace, json) {
  if (json) return console.log(JSON.stringify(answer, null, 2));
  const members = answer.data ?? [];
  console.log(`Team on workspace ${workspace}:`);
  if (answer.owner) console.log(`  owner       ${answer.owner.email}`);
  for (const member of members) {
    console.log(`  ${member.role.padEnd(11)} ${member.email}${member.pending ? "  (has not signed in yet)" : ""}`);
  }
  if (members.length === 0) console.log("  No one else. Invite someone: vatio team invite EMAIL --role supervisor");
}

// An owner with a second factor confirms it is them, as the inbox asks. From a
// terminal the code is asked for; a coding agent has none, so it fails with what
// to ask the person for.
async function invite(client, body) {
  const confirmed = Object.fromEntries(Object.entries(body).filter(([, value]) => value));
  try {
    return await client.inviteMember(confirmed);
  } catch (error) {
    const needsCode = error?.status === 403 && error?.body?.error?.code === "reauthentication_required";
    if (!needsCode || confirmed.code || confirmed.recovery_code) throw error;
    if (!process.stdin.isTTY || !/--code/.test(error.message)) throw error;
    const code = await askSecret(`${paint("green", "?")} Code from your authenticator app: `);
    return await client.inviteMember({ ...confirmed, code });
  }
}
