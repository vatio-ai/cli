// What changed between the installed CLI and the current release, read off
// the changelog Vatio publishes.
//
// `vatio update` was removed when npm became the thing that updates the CLI,
// and what was left was a one-line refusal. That answers how to upgrade and
// not what upgrading would bring, and the second half had no answer anywhere
// a coding agent could reach: the update notice exists
// (lib/update-notice.mjs) but prints only when stderr is a terminal, which an
// agent never has.
//
// So `vatio changelog` answers it, and `vatio update` keeps being the refusal
// -- pointed here now. This updates nothing either: it says what npm would
// bring, and what to run.

import { VERSION } from "./version.mjs";
import { clientHeaders } from "./telemetry.mjs";

export const PACKAGE = "@vatio-ai/cli";
export const CHANGELOG_URL = "https://vatio.ai/docs/changelog";
const CHANGELOG_MARKDOWN = "/docs/changelog.md";
const FETCH_TIMEOUT_MS = 10_000;
const LATEST_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;

// `## 0.98.0 — 2026-10-22` opens an entry; the next one of these ends it.
const ENTRY = /^## +(\d+\.\d+\.\d+)\b.*$/gm;
// Each change in an entry opens with its own sentence in bold.
const HEADLINE = /^\*\*(.+?)\*\*/gms;

export function compareVersions(a, b) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value))?.slice(1).map(Number);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

// The entries of the changelog, newest first: { version, body }.
export function entriesIn(markdown) {
  const text = String(markdown);
  const starts = [...text.matchAll(ENTRY)];

  return starts.map((match, index) => ({
    version: match[1],
    body: text.slice(match.index + match[0].length, starts[index + 1]?.index ?? text.length).trim()
  }));
}

// The headline of each change in one entry: the bold sentence it opens with,
// without its trailing period, and the whole first line when an entry has no
// bold lead at all.
export function headlinesIn(body) {
  const found = [...String(body).matchAll(HEADLINE)]
    .map((match) => match[1].replace(/\s+/g, " ").trim().replace(/\.$/, ""))
    .filter((line) => line !== "");
  if (found.length > 0) return found;

  const first = String(body).split("\n").find((line) => line.trim() !== "");
  return first ? [first.replace(/\s+/g, " ").trim().replace(/\.$/, "")] : [];
}

// Entries newer than `current` and no newer than `latest`, newest first. An
// unparseable version on either side means "say nothing" rather than "say
// everything": a wrong list is worse than a link.
export function changesBetween(markdown, { current, latest }) {
  return entriesIn(markdown).filter(({ version }) => {
    const aboveCurrent = compareVersions(version, current);
    if (aboveCurrent === null || aboveCurrent <= 0) return false;
    if (!latest) return true;

    const withinLatest = compareVersions(version, latest);
    return withinLatest !== null && withinLatest <= 0;
  });
}

async function fetchText(url, accept) {
  try {
    const response = await fetch(url, {
      headers: { ...clientHeaders(), Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    // No network, a slow render, an offline developer: the command still says
    // which version is installed and what to run.
    return null;
  }
}

async function latestRelease() {
  const body = await fetchText(LATEST_URL, "application/json");
  if (body === null) return null;
  try {
    const version = JSON.parse(body)?.version;
    return typeof version === "string" && compareVersions(version, "0.0.0") !== null ? version : null;
  } catch {
    return null;
  }
}

// How to get the current release, in the form that fits how this one is being
// run: npx sets npm_command=exec, a global install has no npm around it.
export function upgradeCommand() {
  return process.env.npm_command === "exec" ? `npx ${PACKAGE}@latest` : `npm install -g ${PACKAGE}@latest`;
}

// `vatio changelog`. Updates nothing, and says so first: npm owns that, and a
// command that printed "updated" without having updated would be worse than
// the refusal this replaces.
export async function changelog(config, args = []) {
  const full = args.includes("--full");
  const lines = [];

  const [latest, markdown] = await Promise.all([
    latestRelease(),
    fetchText(`${config.resolveBaseUrl()}${CHANGELOG_MARKDOWN}`, "text/markdown, text/plain")
  ]);

  const behind = latest !== null && compareVersions(latest, VERSION) === 1;
  if (latest === null) {
    lines.push(`vatio ${VERSION} is installed. The registry could not be reached, so whether it is current is unknown.`);
  } else if (behind) {
    lines.push(`vatio ${VERSION} is installed; ${latest} is the current release.`);
  } else {
    lines.push(`vatio ${VERSION} is installed, and it is the current release.`);
  }

  lines.push("");
  if (behind || latest === null) {
    lines.push("Nothing was updated here — npm does that:");
    lines.push(`  ${upgradeCommand()}`);
    lines.push("");
  }

  const changes = markdown === null ? [] : changesBetween(markdown, { current: VERSION, latest });
  if (changes.length > 0) {
    lines.push(`What ${changes.length === 1 ? "the release" : "those releases"} changed:`);
    lines.push("");
    for (const entry of changes) {
      lines.push(`  ${entry.version}`);
      if (full) {
        for (const line of entry.body.split("\n")) lines.push(line === "" ? "" : `    ${line}`);
        lines.push("");
      } else {
        for (const headline of headlinesIn(entry.body)) lines.push(`    ${headline}`);
      }
    }
    lines.push("");
    lines.push(full ? `In a browser: ${CHANGELOG_URL}` : `Each one in full: \`vatio changelog --full\`, or ${CHANGELOG_URL}`);
  } else if (markdown === null) {
    lines.push(`What changed is in the changelog: ${CHANGELOG_URL}`);
  } else if (!behind) {
    lines.push(`Earlier releases are in the changelog: ${CHANGELOG_URL}`);
  }

  console.log(lines.join("\n"));
}
