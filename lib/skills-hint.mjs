// "The Vatio skills are not installed here" -- or are older than the published
// ones -- after the commands of the improve loop. Without them Claude Code has
// no /vatio:vatio-improve, and with old ones it works the reports the way the
// skill said months ago.
//
// Installed means either copy: the Claude Code plugin (installed_plugins.json
// names vatio@<marketplace>, with its version), or the files
// `npx @vatio-ai/skills` puts in a project's .claude/skills or .agents/skills
// -- in this directory or one above it, or in ~/.claude/skills -- with the
// .vatio-skills-version it leaves beside each. A copy without that file
// predates it, so it is older than any version that writes one.
//
// Unlike the update notice it prints when stderr is not a terminal too: the
// reader is as often the coding agent running the command as a person. At
// most once a day per directory, and never in CI. The registry is asked for
// the latest skills at most once a day.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { configHome } from "./config.mjs";
import { paint } from "./support.mjs";

const SKILL = "vatio-improve";
const VERSION_FILE = ".vatio-skills-version";
const LATEST_URL = "https://registry.npmjs.org/@vatio-ai/skills/latest";
const SHOW_EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_500;

export async function printSkillsHint(startDir = process.cwd()) {
  if (process.env.CI || process.env.VATIO_NO_SKILLS_HINT) return;

  const path = join(configHome(), "skills-hint.json");
  const key = resolve(startDir);
  const state = readJson(path);
  const last = Date.parse(state[key] ?? "");
  if (!Number.isNaN(last) && Date.now() - last < SHOW_EVERY_MS) return;

  const lines = hintLines(findSkills(startDir), await latestSkillsVersion());
  if (lines.length === 0) return;

  process.stderr.write(`\n${lines.map((line, i) => (i === 0 ? paint("yellow", line) : line)).join("\n")}\n`);
  writeJson(path, { ...state, [key]: new Date().toISOString() });
}

export function hintLines(found, latest) {
  if (found.length === 0) {
    return [
      "The Vatio skills are not installed here, so Claude Code has no /vatio:vatio-improve.",
      "To install them, run in this project: npx @vatio-ai/skills"
    ];
  }
  if (!latest) return [];

  const lines = [];
  const plugin = found.find((install) => install.kind === "plugin");
  if (plugin?.version && isOlder(plugin.version, latest)) {
    lines.push(
      `The Vatio plugin for Claude Code is ${plugin.version}; ${latest} is out.`,
      "To update it, run: claude plugin update vatio@vatio (or turn on auto-update in /plugin → Marketplaces → vatio)"
    );
  }
  const copy = found.find((install) => install.kind === "copy");
  if (copy && (!copy.version || isOlder(copy.version, latest))) {
    lines.push(
      `The Vatio skills copied into this project are ${copy.version ?? "older than 1.7.0"}; ${latest} is out.`,
      "To update them, run in this project: npx @vatio-ai/skills"
    );
  }
  return lines;
}

// Every copy Claude Code or another coding agent may load, nearest first.
export function findSkills(startDir) {
  const claudeHome = String(process.env.CLAUDE_CONFIG_DIR ?? "").trim() || join(homedir(), ".claude");
  const found = [];
  const plugin = pluginVersion(join(claudeHome, "plugins", "installed_plugins.json"));
  if (plugin !== undefined) found.push({ kind: "plugin", version: plugin });

  let dir = resolve(startDir);
  for (;;) {
    for (const base of [join(dir, ".claude"), join(dir, ".agents")]) {
      if (hasSkill(base)) found.push({ kind: "copy", version: copyVersion(base) });
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (hasSkill(claudeHome)) found.push({ kind: "copy", version: copyVersion(claudeHome) });
  return found;
}

export function skillsInstalled(startDir) {
  return findSkills(startDir).length > 0;
}

function hasSkill(base) {
  return existsSync(join(base, "skills", SKILL, "SKILL.md"));
}

function copyVersion(base) {
  try {
    return readFileSync(join(base, "skills", SKILL, VERSION_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

// undefined when no vatio plugin is installed, null when one is but its
// version is not where it was: the file's format is Claude Code's, not ours.
function pluginVersion(path) {
  try {
    const plugins = JSON.parse(readFileSync(path, "utf8"))?.plugins ?? {};
    const name = Object.keys(plugins).find((candidate) => candidate.startsWith("vatio@"));
    if (!name) return undefined;
    const installs = Array.isArray(plugins[name]) ? plugins[name] : [ plugins[name] ];
    const versions = installs.map((install) => install?.version).filter((v) => typeof v === "string");
    return versions.sort((a, b) => (isOlder(a, b) ? 1 : -1))[0] ?? null;
  } catch {
    return undefined;
  }
}

async function latestSkillsVersion() {
  const path = join(configHome(), "skills-check.json");
  const cached = readJson(path);
  if (typeof cached.latest === "string" && Date.now() - Date.parse(cached.checked_at ?? "") < CHECK_EVERY_MS) {
    return cached.latest;
  }
  try {
    const response = await fetch(LATEST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const latest = response.ok ? (await response.json())?.version : null;
    if (typeof latest !== "string") return cached.latest ?? null;
    writeJson(path, { checked_at: new Date().toISOString(), latest });
    return latest;
  } catch {
    return cached.latest ?? null;
  }
}

function isOlder(version, than) {
  const parse = (v) => String(v).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(version), parse(than)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  } catch {
    // A hint that cannot remember it was shown shows again tomorrow.
  }
}
