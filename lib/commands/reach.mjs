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

const ANALYTICS_USAGE = "Usage: vatio analytics [QUERY] [--days 7|30|90] [--campaign NAME] [--json]\n" +
  "  Without QUERY, the queries there are.";

// The inbox's Analytics, one query at a time (Vatio::Analytics): without one,
// the list of them, which the server keeps.
export async function analytics(config, args) {
  const json = takeFlag(args, "--json");
  const days = takeValue(args, "--days");
  const campaign = takeValue(args, "--campaign");
  const query = args.shift();
  if (args.length) fail(ANALYTICS_USAGE);
  const client = deployClient(config, config.resolveWorkspaceRequired());
  if (!query) {
    const menu = await client.get("/analytics");
    if (json) return print(menu);
    console.log("vatio analytics QUERY [--days 7|30|90] [--campaign NAME] [--json], where QUERY is one of:\n");
    for (const { name, description } of menu.queries ?? []) console.log(`  ${name.padEnd(14)} ${description}`);
    return;
  }
  const answer = await client.get(`/analytics/${encodeURIComponent(query)}`, { days, utm_campaign: campaign });
  if (json) return print(answer);
  console.log(`Last ${answer.days} days, your customers${campaign ? ` from the campaign ${campaign}` : ""}:`);
  const show = ANALYTICS_PRINTERS[query];
  if (show) show(answer);
  else print(answer);
}

const before = (block, days) => (block?.previous_total ? ` (${block.previous_total} the ${days} days before)` : "");
const tally = (counts) => Object.entries(counts ?? {}).filter(([, n]) => n).map(([key, n]) => `${key} ${n}`).join(", ");
const share = (part, whole) => (whole ? ` (${Math.round((part / whole) * 100)}%)` : "");
const RATING_EMOJI = { good: "👍", neutral: "😐", bad: "👎" };

function printSeries(label, series, days) {
  console.log(`  ${label.padEnd(14)} ${series?.total ?? 0}${before(series, days)}`);
  if (tally(series?.by_source)) console.log(`  by channel     ${tally(series.by_source)}`);
  console.log("  Each day's count is in --json.");
}

function printFlagCounts(flags) {
  console.log(`  reports        ${flags.open ?? 0} open; ${flags.opened ?? 0} opened, ${flags.resolved ?? 0} resolved in the period`);
}

function printRatingCounts(counts = {}) {
  console.log(`  ratings        👍 ${counts.good ?? 0} 😐 ${counts.neutral ?? 0} 👎 ${counts.bad ?? 0}`);
}

// What each query prints; --json has all of it.
const ANALYTICS_PRINTERS = {
  summary(answer) {
    const { conversations, messages, flags, ratings } = answer;
    console.log(`  conversations  ${conversations?.total ?? 0}${before(conversations, answer.days)}`);
    console.log(`  messages       ${messages?.total ?? 0}${before(messages, answer.days)}`);
    if (flags) printFlagCounts(flags);
    if (ratings) printRatingCounts(ratings.counts);
    const campaigns = (answer.campaigns ?? []).slice(0, 5).map((row) => `${row.value} ${row.conversations}`);
    if (campaigns.length) console.log(`  campaigns      ${campaigns.join(", ")}`);
  },
  conversations: (answer) => printSeries("conversations", answer.conversations, answer.days),
  messages: (answer) => printSeries("messages", answer.messages, answer.days),
  impact(answer) {
    const saved = answer.saved_replies ?? {};
    const hours = answer.after_hours ?? {};
    const looked = answer.looked_up ?? {};
    const asked = answer.asked_team ?? {};
    const fixed = answer.reports_fixed ?? {};
    console.log(`  replies Vatio saved          ${saved.total ?? 0} (${saved.corrected?.total ?? 0} corrected, ` +
      `${saved.recovered?.total ?? 0} recovered, ${saved.stopped?.total ?? 0} stopped before your backend)`);
    console.log(`  started after hours          ${hours.after_hours ?? 0} of ${hours.conversations ?? 0}${share(hours.after_hours, hours.conversations)}`);
    console.log(`  replies with looked-up data  ${looked.looked_up ?? 0} of ${looked.turns ?? 0}${share(looked.looked_up, looked.turns)}`);
    console.log(`  questions to the team        ${asked.questions ?? 0} (${asked.answered ?? 0} answered)`);
    console.log(`  test conversations replayed  ${answer.test_replays ?? 0}`);
    console.log(`  regressions held             ${answer.regressions_held?.count ?? 0}`);
    console.log(`  reports fixed                ${fixed.count ?? 0}${fixed.median_hours != null ? ` (median ${fixed.median_hours} h)` : ""}`);
  },
  flags(answer) {
    const flags = answer.flags ?? {};
    printFlagCounts(flags);
    for (const flag of flags.recent ?? []) console.log(`    ${flag.id}  chat ${flag.chat_id}  ${flag.note || "(no note)"}`);
  },
  ratings(answer) {
    const ratings = answer.ratings ?? {};
    printRatingCounts(ratings.counts);
    for (const row of ratings.recent ?? []) console.log(`    ${RATING_EMOJI[row.rating] ?? " "} chat ${row.chat_id}  ${row.comment}`);
  },
  origins(answer) {
    if (!answer.origins?.attributed) return console.log("  None came with a page, a referrer or a campaign.");
    printOrigins(answer.origins, answer.days);
  },
  whatsapp_cost(answer) {
    const cost = answer.whatsapp_cost;
    if (!cost) return console.log("  Your own WhatsApp number delivered nothing.");
    console.log(`  US$${cost.total.toFixed(2)} for ${cost.messages} billable messages, at Meta's rates of ${cost.rate_card}`);
    for (const [category, row] of Object.entries(cost.by_category ?? {})) {
      console.log(`    ${category.padEnd(14)} ${row.messages} messages, US$${row.usd.toFixed(2)}`);
    }
    if (cost.free_service) console.log(`  free service messages this month: ${cost.free_service.used} of ${cost.free_service.limit}`);
  }
};

const ORIGIN_LABELS = { utm_campaign: "campaign", utm_source: "source", utm_medium: "medium", landing_page: "landing page", referrer: "referrer" };

// Where the period's conversations came from: the biggest of each, against
// the period before, with how they went. `--json` has every row.
function printOrigins(origins, days) {
  if (!origins?.attributed) return;
  console.log(`Where they came from (${origins.attributed} of ${origins.conversations} with a page, a referrer or a campaign):`);
  for (const [key, label] of Object.entries(ORIGIN_LABELS)) {
    const rows = (origins.dimensions?.[key]?.rows ?? []).filter((row) => row.value !== null).slice(0, 5);
    if (!rows.length) continue;
    console.log(`  ${label}`);
    for (const row of rows) {
      const ratings = row.ratings ?? {};
      const outcome = [
        `${row.previous_conversations} the ${days} days before`,
        ratings.good || ratings.neutral || ratings.bad ? `rated 👍 ${ratings.good} 😐 ${ratings.neutral} 👎 ${ratings.bad}` : null,
        row.reported ? `${row.reported} reported` : null,
        row.handed_off ? `${row.handed_off} answered by a person` : null
      ].filter(Boolean).join(", ");
      console.log(`    ${String(row.conversations).padStart(5)}  ${row.value}  (${outcome})`);
    }
  }
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
