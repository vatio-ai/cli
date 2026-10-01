// whatsapp / instagram — the two channels a workspace can answer on for real.
//
// Each has the same two halves, deliberately mirrored: the workspace's *own*
// account, which serves live, and a shared preview you can use immediately with
// no Meta account of your own. `numbers` and `accounts` are the preview halves,
// and they hang off the channel they belong to because "accounts" on its own
// would say nothing about which one.

import { deployClient } from "./deploy.mjs";
import { fail, openBrowser, takeEnv } from "../support.mjs";

export async function whatsapp(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "status";

  switch (sub) {
    case "status": return printWhatsapp(await client.whatsappAccount(), workspace);
    case "connect": return await connectWhatsapp(client, workspace);
    case "check": return printWhatsapp(await client.checkWhatsappAccount(), workspace);
    case "activate": {
      await client.activateWhatsappAccount();
      console.log(`Activated WhatsApp on workspace ${workspace} — it answers customers now.`);
      return;
    }
    case "deactivate": {
      await client.deactivateWhatsappAccount();
      console.log(`Paused WhatsApp on workspace ${workspace}. The credentials are kept.`);
      return;
    }
    case "disconnect": case "remove": case "rm": {
      await client.disconnectWhatsappAccount();
      console.log(`Disconnected WhatsApp from workspace ${workspace}. Vatio stops receiving its messages.`);
      return;
    }
    case "numbers": return await numbers(client, workspace, args, config.workspaceRoot);
    default: fail(whatsappUsage());
  }
}

function whatsappUsage() {
  return `Usage: vatio whatsapp status|connect|check|activate|deactivate|disconnect
       vatio whatsapp numbers list|add PHONE|point PHONE|verify PHONE CODE|resend PHONE|remove PHONE  [--env NAME]

  The bare commands drive your own WhatsApp number, which serves live.
  \`numbers\` registers test phones on the shared WhatsApp preview. Each reaches
  the environment it points at: preview, or a branch's (\`add\` and \`point\`
  take --env, and default to the branch you are on) — the counterpart of
  \`vatio instagram accounts\`.

  connect
    Prints a link to finish in a browser. Connecting a number is Meta's
    Embedded Signup, a consent screen a person has to read, so there is
    nothing for a command to do but hand the link over.`;
}

function printWhatsapp(account, workspace) {
  if (!account.connected) {
    console.log(`No WhatsApp number connected to workspace ${workspace}.`);
    console.log("  Connect yours: vatio whatsapp connect");
    console.log("  Or test on the shared preview number with no Meta account: vatio whatsapp numbers add +56912345678");
    return;
  }

  const label = account.phone_number ?? "your WhatsApp number";
  console.log(`${label} on workspace ${workspace}:`);
  console.log(`  status:     ${account.status}`);
  console.log(`  receiving:  ${account.receiving_messages ? "yes" : "no"}`);
  console.log(`  active:     ${account.active ? "yes" : "no (paused)"}`);
  if (account.last_health_error) console.log(`  error:      ${account.last_health_error}`);
  console.log("");

  // Three things that fail separately, so the advice names which one did.
  if (account.live_ready) {
    console.log(`Messages to ${label} reach your live deployment.`);
    console.log("Change what it answers with: vatio push && vatio publish");
  } else if (!account.receiving_messages) {
    console.log("Meta is not delivering this number's messages to Vatio, so the agent");
    console.log("never sees them. Repair the subscription: vatio whatsapp check");
  } else if (!account.active) {
    console.log("Connected and receiving, but paused — nobody gets an answer yet.");
    console.log("Start answering: vatio whatsapp activate");
  } else {
    console.log("Not ready to answer yet. Re-check with: vatio whatsapp check");
  }
}

// Prints the link and stops. Meta's Embedded Signup needs a logged-in browser
// and a person reading a consent screen; there is no headless form of it, and
// the ids a credentials flag would take do not exist until it has run. Keeping
// a number in the WhatsApp Business phone app is only possible through it too.
async function connectWhatsapp(client, workspace) {
  const payload = await client.whatsappConnectLink();
  const url = payload.connect_url;
  if (!url) fail("The platform did not return a connect URL");

  if (payload.connected_number) {
    console.log(`Workspace ${workspace} is already connected to ${payload.connected_number}.`);
    console.log("Connecting the same number again renews its access token. To connect a");
    console.log("different one, run `vatio whatsapp disconnect` first.");
    console.log("");
  }

  console.log("Open this to connect your WhatsApp number:");
  console.log("");
  console.log(`  ${url}`);
  console.log("");
  console.log("Choose your number in Meta's popup. A number already in the WhatsApp");
  console.log("Business app on your phone stays there — you keep answering from the");
  console.log("phone and the agent answers on the same number.");
  console.log("");
  console.log("Then run `vatio whatsapp`.");
  // The link is printed first and stays printed: openBrowser is a convenience
  // that silently does nothing over SSH, in a container, or wherever there is
  // no browser to open, and the developer still has the URL to paste.
  openBrowser(url);
}

async function numbers(client, workspace, args, cwd) {
  const sub = args.shift() ?? "list";
  const usage = "Usage: vatio whatsapp numbers list|add PHONE|point PHONE|verify PHONE CODE|resend PHONE|remove PHONE  [--env NAME]";
  const environment = ["add", "point"].includes(sub) ? takeEnv(args, { fallback: null, cwd }) : null;

  if (sub === "list") {
    const list = asArray((await client.listTestPhoneNumbers()).test_phone_numbers);
    if (list.length === 0) {
      console.log(`No test phone numbers on workspace ${workspace}`);
      console.log("  Register one: vatio whatsapp numbers add +56912345678");
      return;
    }
    console.log(`Test phone numbers on workspace ${workspace} (${list.length}):`);
    for (const number of list) {
      const suffix = number.status === "verified" ? `verified ${number.verified_at}` : "pending verification";
      console.log(`  ${number.phone_number}  → ${number.environment}  ${suffix}`);
    }
    console.log("");
    console.log("Each reaches its environment on the shared WhatsApp preview number, never live.");
    console.log("Point one elsewhere: vatio whatsapp numbers point PHONE --env NAME");
    return;
  }
  if (sub === "point") {
    const phoneNumber = requireArg(args, "vatio whatsapp numbers point +56912345678 [--env NAME]");
    const number = await client.pointTestPhoneNumber({ phoneNumber, environment: environment ?? "preview" });
    console.log(`${number.phone_number} now reaches ${number.environment} on workspace ${workspace}.`);
    return;
  }
  if (sub === "add") {
    const phoneNumber = requireArg(args, "vatio whatsapp numbers add +56912345678");
    const number = await client.addTestPhoneNumber({ phoneNumber, environment });
    if (number.already_verified) {
      console.log(`${number.phone_number} is already verified on workspace ${workspace} — nothing to do.`);
    } else if (number.moved_from) {
      console.log(`Moved ${number.phone_number} from workspace ${number.moved_from} to ${workspace}.`);
      console.log("It was already verified, so no new code was sent.");
    } else {
      console.log(`Sent a 6-digit code over WhatsApp to ${number.phone_number}.`);
      console.log("It is valid for 10 minutes. When it arrives:");
      console.log("");
      console.log(`  vatio whatsapp numbers verify ${number.phone_number} 123456`);
    }
    return;
  }
  if (sub === "verify") {
    const phoneNumber = requireArg(args, "vatio whatsapp numbers verify +56912345678 123456");
    const code = requireArg(args, "vatio whatsapp numbers verify +56912345678 123456");
    const number = await client.verifyTestPhoneNumber({ phoneNumber, code });
    console.log(
      number.already_verified
        ? `${number.phone_number} was already verified on workspace ${workspace}.`
        : `Verified ${number.phone_number} on workspace ${workspace}.`
    );
    console.log(`Anything you send from that phone now reaches ${number.environment}.`);
    return;
  }
  if (sub === "resend") {
    const phoneNumber = requireArg(args, "vatio whatsapp numbers resend +56912345678");
    const number = await client.resendTestPhoneNumberCode({ phoneNumber });
    console.log(
      number.already_verified
        ? `${number.phone_number} is already verified on workspace ${workspace} — no code needed.`
        : `Sent a new 6-digit code to ${number.phone_number}.`
    );
    return;
  }
  if (sub === "remove" || sub === "delete" || sub === "rm") {
    const phoneNumber = requireArg(args, "vatio whatsapp numbers remove +56912345678");
    await client.removeTestPhoneNumber({ phoneNumber });
    console.log(`Removed ${phoneNumber} from workspace ${workspace}.`);
    return;
  }

  fail(usage);
}

export async function instagram(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "status";

  switch (sub) {
    case "status": return printInstagram(await client.instagramAccount(), workspace);
    case "connect": return await connectInstagram(client);
    case "check": return printInstagram(await client.checkInstagramAccount(), workspace);
    case "disconnect": case "remove": case "rm": {
      await client.disconnectInstagramAccount();
      console.log(`Disconnected Instagram from workspace ${workspace}. Vatio stops receiving its DMs.`);
      return;
    }
    case "accounts": return await instagramAccounts(client, workspace, args, config.workspaceRoot);
    default: fail(instagramUsage());
  }
}

function instagramUsage() {
  return `Usage: vatio instagram status|connect|check|disconnect
       vatio instagram accounts list|add @HANDLE|point ID|verify CODE|resend ID|remove ID  [--env NAME]

  The bare commands drive your own Instagram account, which serves live.
  \`accounts\` registers test accounts on the shared Instagram preview. Each
  reaches the environment it points at: preview, or a branch's (\`add\` and
  \`point\` take --env, and default to the branch you are on) — the counterpart
  of \`vatio whatsapp numbers\`.`;
}

function printInstagram(account, workspace) {
  if (!account.connected) {
    console.log(`No Instagram account connected to workspace ${workspace}.`);
    console.log("  Connect yours: vatio instagram connect");
    console.log("  Or test on the shared preview account: vatio instagram accounts add @yourhandle");
    return;
  }

  const handle = account.username ? `@${account.username}` : "your Instagram account";
  console.log(`${handle} on workspace ${workspace}:`);
  console.log(`  status:     ${account.status}`);
  console.log(`  receiving:  ${account.receiving_messages ? "yes" : "no"}`);
  if (account.last_health_error) console.log(`  error:      ${account.last_health_error}`);
  console.log("");

  if (account.live_ready) {
    console.log(`DMs to ${handle} reach your live deployment.`);
    console.log("Change what it answers with: vatio push && vatio publish");
  } else if (account.token_expired) {
    console.log("The access token expired. Re-grant it: vatio instagram connect");
  } else if (!account.receiving_messages) {
    console.log("Instagram is not delivering this account's messages to Vatio, so the");
    console.log("agent never sees them. Repair the subscription: vatio instagram check");
  } else {
    console.log("Not ready to answer DMs yet. Re-check with: vatio instagram check");
  }
}

// Connecting mints a URL for Meta's consent screen rather than taking
// credentials: granting an app access to an Instagram account is a decision
// Meta insists a human makes in a browser.
async function connectInstagram(client) {
  const payload = await client.instagramConnectLink();
  const url = payload.url ?? payload.consent_url;
  if (!url) fail("The platform did not return a consent URL");

  console.log("Open this to grant Vatio access to an Instagram professional account:");
  console.log("");
  console.log(`  ${url}`);
  console.log("");
  console.log("Then run `vatio instagram check`.");
  openBrowser(url);
}

async function instagramAccounts(client, workspace, args, cwd) {
  const sub = args.shift() ?? "list";
  const usage = "Usage: vatio instagram accounts list|add @HANDLE|point ID|verify CODE|resend ID|remove ID  [--env NAME]";
  const environment = ["add", "point"].includes(sub) ? takeEnv(args, { fallback: null, cwd }) : null;

  if (sub === "list") {
    const list = asArray((await client.listTestInstagramAccounts()).test_instagram_accounts);
    if (list.length === 0) {
      console.log(`No test Instagram accounts on workspace ${workspace}`);
      console.log("  Register one: vatio instagram accounts add @yourhandle");
      return;
    }
    console.log(`Test Instagram accounts on workspace ${workspace} (${list.length}):`);
    for (const account of list) {
      const suffix =
        account.status === "verified" ? `verified ${account.verified_at}`
        : account.status === "awaiting_code" ? "code sent — confirm it: vatio instagram accounts verify CODE"
        : `declared — DM @${account.dm_to} from that account to get a code`;
      console.log(`  [${account.id}] @${account.username}  → ${account.environment}  ${suffix}`);
    }
    return;
  }
  if (sub === "point") {
    const id = requireArg(args, "vatio instagram accounts point ID [--env NAME]");
    const account = await client.pointTestInstagramAccount({ id, environment: environment ?? "preview" });
    console.log(`@${account.username} now reaches ${account.environment} on workspace ${workspace}.`);
    return;
  }
  if (sub === "add") {
    const username = requireArg(args, "vatio instagram accounts add @yourhandle").replace(/^@/, "");
    const account = await client.addTestInstagramAccount({ username, environment });
    console.log(`Declared @${account.username} on workspace ${workspace}.`);
    console.log("");
    // Meta will not let an app DM an account that has not written first, which
    // is why the code travels in that direction and nothing happens until the
    // developer sends that first message.
    console.log(`Now DM @${account.dm_to} from that account. Vatio replies with a 6-digit code:`);
    console.log("");
    console.log("  vatio instagram accounts verify 123456");
    return;
  }
  if (sub === "verify") {
    const code = requireArg(args, "vatio instagram accounts verify 123456");
    const account = await client.verifyTestInstagramAccount({ code });
    console.log(`Verified @${account.username} on workspace ${workspace}.`);
    console.log(`DMs from that account now reach ${account.environment}.`);
    return;
  }
  if (sub === "resend") {
    const id = requireArg(args, "vatio instagram accounts resend ID");
    const account = await client.resendTestInstagramAccountCode(id);
    console.log(`Sent a new code to @${account.username}.`);
    return;
  }
  if (sub === "remove" || sub === "delete" || sub === "rm") {
    const id = requireArg(args, "vatio instagram accounts remove ID");
    await client.removeTestInstagramAccount(id);
    console.log(`Removed test Instagram account ${id} from workspace ${workspace}.`);
    return;
  }

  fail(usage);
}

function requireArg(args, usage) {
  const value = String(args.shift() ?? "").trim();
  if (value === "") fail(`Usage: ${usage}`);
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
