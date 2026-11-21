// schedules — what the agent does on its own at set times: "every Monday at
// 08:30, send each person on the team their week". The same rows the inbox
// edits under Channels and the MCP's list_schedules, set_schedule and
// remove_schedule. Not part of vatio.yml: live on save. Each run publishes
// one event per person, and the agent reads it in their WhatsApp chat, looks
// things up with its tools and writes, or not.

import { deployClient } from "./deploy.mjs";
import { fail, takeFlag, takeValue } from "../support.mjs";

const USAGE =
  "Usage: vatio schedules [list] [--preview] [--json]\n" +
  "       vatio schedules set KEY [--days DAYS] [--at HH:MM] [--timezone ZONE] [--to WHO] [--event TEXT]\n" +
  "                           [--template NAME:LANGUAGE] [--pause | --resume] [--preview]\n" +
  "       vatio schedules remove KEY [--preview]\n" +
  "  DAYS is mon, mon-fri, sat,sun or all. WHO is team, business, developer, owner, or phone numbers\n" +
  "  separated by commas. EVENT is what the agent is told each time.";

export async function schedules(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";
  const environment = takeFlag(args, "--preview") ? "preview" : "live";

  if (sub === "list") {
    const json = takeFlag(args, "--json");
    rejectLeftovers(args);
    const payload = await client.schedules({ environment });
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    print(payload.schedules ?? [], workspace, environment);
    return;
  }

  if (sub === "set") {
    const key = args.shift();
    if (!key || key.startsWith("--")) fail(`Name the schedule: vatio schedules set weekly-overview ...\n\n${USAGE}`);
    const body = { environment };
    const days = takeValue(args, "--days");
    const at = takeValue(args, "--at");
    const timezone = takeValue(args, "--timezone");
    const to = takeValue(args, "--to");
    const event = takeValue(args, "--event");
    const template = takeValue(args, "--template");
    const pause = takeFlag(args, "--pause");
    const resume = takeFlag(args, "--resume");
    rejectLeftovers(args);
    if (pause && resume) fail(`--pause or --resume, not both\n\n${USAGE}`);
    if (days !== null) body.days = days;
    if (at !== null) body.at = at;
    if (timezone !== null) body.timezone = timezone;
    if (to !== null) body.to = to;
    if (event !== null) body.event = event;
    if (template !== null) body.template = parseTemplate(template);
    if (pause) body.enabled = false;
    if (resume) body.enabled = true;

    const schedule = await client.setSchedule(key, body);
    console.log(`Saved schedule ${schedule.key}  (workspace ${workspace}, ${schedule.environment})`);
    console.log("");
    printOne(schedule);
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const key = args.shift();
    if (!key || key.startsWith("--")) fail(`Name the schedule to remove\n\n${USAGE}`);
    rejectLeftovers(args);
    await client.removeSchedule(key, { environment });
    console.log(`Removed schedule ${key}. Events it already published still go out.`);
    return;
  }

  fail(USAGE);
}

// "week_summary:es" -> { name, language }
function parseTemplate(value) {
  const [name, language] = value.split(":");
  if (!name || !language) fail(`--template is NAME:LANGUAGE, for example week_summary:es\n\n${USAGE}`);
  return { name, language };
}

function rejectLeftovers(args) {
  if (args.length > 0) fail(`Unexpected: ${args.join(" ")}\n\n${USAGE}`);
}

function print(list, workspace, environment) {
  console.log(`Schedules  (workspace ${workspace}, ${environment})`);
  console.log("");
  if (list.length === 0) {
    console.log("  None. Create one with `vatio schedules set KEY --days mon --at 08:30 --timezone ZONE --to team --event TEXT`.");
    return;
  }
  list.forEach((schedule, index) => {
    if (index > 0) console.log("");
    printOne(schedule);
  });
}

function printOne(schedule) {
  const to = Array.isArray(schedule.to) ? schedule.to.join(", ") : schedule.to;
  console.log(`  ${schedule.key}${schedule.enabled ? "" : "  (paused)"}`);
  console.log(`    when   ${schedule.days.join(",")} at ${schedule.at} (${schedule.timezone})`);
  console.log(`    to     ${to}`);
  console.log(`    event  ${schedule.event}`);
  if (schedule.template) console.log(`    template  ${schedule.template.name} (${schedule.template.language})`);
  if (schedule.next_run_at) console.log(`    next   ${schedule.next_run_at}`);
}
