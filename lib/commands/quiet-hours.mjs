// quiet-hours — the weekly schedule in which the agent does not answer, the
// same one the inbox edits under Channels. Not part of vatio.yml: one value
// for every environment, live on save. A message that arrives inside it is
// not answered afterwards; it waits for the team in the inbox.

import { deployClient } from "./deploy.mjs";
import { fail, takeFlag, takeValue } from "../support.mjs";

const USAGE =
  "Usage: vatio quiet-hours [show]\n" +
  '       vatio quiet-hours set --timezone ZONE --range "DAYS HH:MM-HH:MM" [--range ...]\n' +
  "       vatio quiet-hours off\n" +
  '  DAYS is mon, mon-fri, sat,sun or all. A range may cross midnight ("fri 22:00-08:00").';

// Weekday keys are the platform's: 0 is Sunday.
const DAY_KEYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export async function quietHours(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "show";

  if (sub === "show") {
    rejectLeftovers(args);
    print(await client.quietHours(), workspace);
    return;
  }
  if (sub === "off") {
    rejectLeftovers(args);
    print(await client.setQuietHours(null), workspace);
    return;
  }
  if (sub === "set") {
    const timezone = takeValue(args, "--timezone");
    if (!timezone) fail(`--timezone is required (for example America/Santiago)\n\n${USAGE}`);
    const ranges = [];
    for (let value = takeValue(args, "--range"); value !== null; value = takeValue(args, "--range")) ranges.push(value);
    if (takeFlag(args, "--off")) fail(USAGE);
    rejectLeftovers(args);
    if (ranges.length === 0) fail(`Give at least one --range, or use \`vatio quiet-hours off\`\n\n${USAGE}`);

    print(await client.setQuietHours({ timezone, days: buildDays(ranges) }), workspace);
    return;
  }

  fail(USAGE);
}

// "mon-fri 00:00-08:00" -> ranges on each of those days. One that crosses
// midnight ("fri 22:00-08:00") becomes the evening of that day and the
// morning of the next, which is how the platform keeps them.
export function buildDays(ranges) {
  const days = {};
  const add = (day, from, to) => {
    (days[day] ??= []).push({ from, to });
  };

  for (const spec of ranges) {
    const match = /^\s*(\S+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})\s*$/.exec(spec);
    if (!match) fail(`--range "${spec}": expected "DAYS HH:MM-HH:MM", for example "mon-fri 22:00-08:00"`);
    const [, dayList, from, to] = match;
    if (!TIME.test(from) || !(TIME.test(to) || to === "24:00")) fail(`--range "${spec}": times are HH:MM, 00:00 to 24:00`);
    if (from === to) fail(`--range "${spec}": it starts and ends at the same time`);

    for (const day of parseDays(dayList, spec)) {
      if (from < to) {
        add(day, from, to);
      } else {
        add(day, from, "24:00");
        add((day + 1) % 7, "00:00", to);
      }
    }
  }
  return Object.fromEntries(Object.entries(days).map(([day, list]) => [day, mergeRanges(list)]));
}

function parseDays(list, spec) {
  const days = new Set();
  for (const part of list.toLowerCase().split(",")) {
    if (part === "all") {
      WEEK.forEach((name) => days.add(DAY_KEYS[name]));
      continue;
    }
    const [first, last = first] = part.split("-");
    const start = WEEK.indexOf(first);
    const end = WEEK.indexOf(last);
    if (start === -1 || end === -1) fail(`--range "${spec}": "${part}" is not a day (mon, tue, wed, thu, fri, sat, sun, all)`);
    // Monday-first, wrapping: sat-mon is sat, sun, mon.
    for (let i = start; ; i = (i + 1) % 7) {
      days.add(DAY_KEYS[WEEK[i]]);
      if (i === end) break;
    }
  }
  return [...days];
}

// Touching or overlapping ranges on one day become one, so "all 00:00-08:00"
// and "fri 22:00-08:00" do not trip the platform's overlap check.
function mergeRanges(list) {
  const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = range.to > last.to ? range.to : last.to;
    else merged.push({ ...range });
  }
  return merged;
}

function rejectLeftovers(args) {
  if (args.length > 0) fail(`Unexpected: ${args.join(" ")}\n\n${USAGE}`);
}

function print(payload, workspace) {
  const schedule = payload.quiet_hours;
  console.log(`Quiet hours  (workspace ${workspace})`);
  console.log("");
  if (!schedule) {
    console.log("  Off: the agent answers around the clock. Set one with `vatio quiet-hours set`.");
    return;
  }
  console.log(`  time zone  ${schedule.timezone}`);
  for (const name of WEEK) {
    const ranges = schedule.days[DAY_KEYS[name]] ?? [];
    const text = ranges.length ? ranges.map((range) => `${range.from}-${range.to}`).join(", ") : "answers all day";
    console.log(`  ${name}        ${text}`);
  }
  if (payload.active_now) console.log("\n  Silent right now.");
}
