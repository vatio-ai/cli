// What the inbox shows about how the agent reaches people and how it is
// doing: the web widget's look, the Analytics page, the testers on Vatio's
// shared number and account, and a person stepping into a conversation. The
// same API the MCP's tools for them call.

import { deployClient } from "./deploy.mjs";
import { fail, paint, takeFlag, takeValue } from "../support.mjs";

const print = (answer) => console.log(JSON.stringify(answer, null, 2));

const WIDGET_USAGE = "Usage: vatio widget [show] [--json]\n" +
  "       vatio widget set [--title T] [--greeting G] [--suggestion S]... [--position left|right]\n" +
  "                        [--scheme auto|light|dark] [--reply-style stream|paced] [--locale en|es|pt]\n" +
  "  A field given replaces that one; the rest stays. Name, about, color and logo are `vatio business set`.";

const WIDGET_FLAGS = { "--title": "title", "--greeting": "greeting", "--position": "position", "--scheme": "scheme",
  "--reply-style": "reply_style" };

export async function widget(config, args) {
  const json = takeFlag(args, "--json");
  const client = deployClient(config, config.resolveWorkspaceRequired());
  const sub = args.shift() ?? "show";
  if (sub === "show") {
    if (args.length) fail(WIDGET_USAGE);
    return showWidget(await client.get("/widget"), json);
  }
  if (sub !== "set") fail(WIDGET_USAGE);

  const current = await client.get("/widget");
  const settings = { ...(current.settings && !Array.isArray(current.settings) ? current.settings : {}) };
  for (const [flag, key] of Object.entries(WIDGET_FLAGS)) {
    const value = takeValue(args, flag);
    if (value !== null) settings[key] = value;
  }
  const suggestions = [];
  for (let value = takeValue(args, "--suggestion"); value !== null; value = takeValue(args, "--suggestion")) suggestions.push(value);
  if (suggestions.length) settings.suggestions = suggestions;
  const locale = takeValue(args, "--locale");
  if (args.length) fail(WIDGET_USAGE);
  showWidget(await client.patch("/widget", { settings, locale: locale ?? current.locale }), json);
}

function showWidget(answer, json) {
  if (json) return print(answer);
  const settings = answer.settings && !Array.isArray(answer.settings) ? answer.settings : {};
  const keys = Object.keys(settings);
  console.log(keys.length ? keys.map((key) => `${key.padEnd(12)} ${JSON.stringify(settings[key])}`).join("\n") : "Vatio's defaults.");
  if (answer.locale) console.log(`${"locale".padEnd(12)} ${answer.locale}`);
  console.log("");
  console.log(answer.snippet);
}

export async function analytics(config, args) {
  const json = takeFlag(args, "--json");
  const days = takeValue(args, "--days");
  if (args.length) fail("Usage: vatio analytics [--days N] [--json]");
  const answer = await deployClient(config, config.resolveWorkspaceRequired()).get("/analytics", { days });
  if (json) return print(answer);
  const change = (block) => (block?.previous_total ? ` (${block.previous_total} the ${answer.days} days before)` : "");
  console.log(`Last ${answer.days} days, your customers:`);
  console.log(`  conversations  ${answer.conversations?.total ?? 0}${change(answer.conversations)}`);
  console.log(`  messages       ${answer.messages?.total ?? 0}${change(answer.messages)}`);
  if (answer.saved_replies) console.log(`  replies Vatio saved      ${answer.saved_replies.total ?? 0}`);
  if (answer.after_hours) console.log(`  conversations after hours ${answer.after_hours.after_hours ?? 0}`);
  if (answer.asked_team) console.log(`  questions to the team    ${answer.asked_team.questions ?? 0} (${answer.asked_team.answered ?? 0} answered)`);
  if (answer.flags) console.log(`  reports                  ${answer.flags.opened ?? 0} opened, ${answer.flags.resolved ?? 0} resolved`);
}

const TESTERS_USAGE = "Usage: vatio testers [web|whatsapp|instagram] [--json]\n" +
  "       vatio testers rm whatsapp|instagram ID";

export async function testers(config, args) {
  const json = takeFlag(args, "--json");
  const client = deployClient(config, config.resolveWorkspaceRequired());
  const sub = args.shift() ?? "whatsapp";
  if (sub === "rm" || sub === "remove") {
    const channel = args.shift();
    const id = args.shift();
    if (!["whatsapp", "instagram"].includes(channel) || !id || args.length) fail(TESTERS_USAGE);
    await client.delete(`/test/${channel === "instagram" ? "instagram_accounts" : "whatsapp_numbers"}/${encodeURIComponent(id)}`);
    return console.log(`${paint("green", "✓")} Removed ${channel} tester ${id}.`);
  }
  if (!["web", "whatsapp", "instagram"].includes(sub) || args.length) fail(TESTERS_USAGE);
  print(await client.get("/test", { channel: sub }));
  if (!json) console.log("\nThe inbox's Try the agent shows the same, with the code that adds a tester.");
}

// `vatio chat reply ID "text"` and `vatio chat release ID`: a person on the
// team stepping into a customer's conversation, and handing it back.
export async function conversation(config, sub, args) {
  const json = takeFlag(args, "--json");
  const id = args.shift();
  if (!id) fail(`Usage: vatio chat ${sub} CHAT_ID${sub === "reply" ? ' "TEXT"' : ""}`);
  const client = deployClient(config, config.resolveWorkspaceRequired());
  if (sub === "release") {
    const answer = await client.post(`/conversations/${encodeURIComponent(id)}/release`, {});
    return json ? print(answer) : console.log(`${paint("green", "✓")} The agent answers conversation ${id} again.`);
  }
  const content = args.join(" ").trim();
  if (!content) fail('Usage: vatio chat reply CHAT_ID "TEXT"');
  const answer = await client.post(`/conversations/${encodeURIComponent(id)}/messages`, { content });
  if (json) return print(answer);
  console.log(`${paint("green", "✓")} Sent in conversation ${id}. The agent stays out of it until \`vatio chat release ${id}\`.`);
}
