// "The Vatio skills are not installed here", after the commands of the
// improve loop. Without them Claude Code has no /vatio:vatio-improve, and the
// developer pastes the daily mail's prompt into a session that cannot run it.
//
// Installed means either copy: the Claude Code plugin (installed_plugins.json
// names vatio@<marketplace>), or the files `npx @vatio-ai/skills` puts in a
// project's .claude/skills or .agents/skills -- in this directory or one above
// it, or in ~/.claude/skills.
//
// Unlike the update notice it prints when stderr is not a terminal too: the
// reader is as often the coding agent running the command as a person. At
// most once a day per directory, and never in CI.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { configHome } from "./config.mjs";
import { paint } from "./support.mjs";

const SKILL = "vatio-improve";
const SHOW_EVERY_MS = 24 * 60 * 60 * 1000;

export function printSkillsHint(startDir = process.cwd()) {
  if (process.env.CI || process.env.VATIO_NO_SKILLS_HINT) return;
  if (skillsInstalled(startDir)) return;

  const path = join(configHome(), "skills-hint.json");
  const key = resolve(startDir);
  const state = readState(path);
  const last = Date.parse(state[key] ?? "");
  if (!Number.isNaN(last) && Date.now() - last < SHOW_EVERY_MS) return;

  process.stderr.write(
    `\n${paint("yellow", "The Vatio skills are not installed here, so Claude Code has no /vatio:vatio-improve.")}\n` +
    "To install them, run in this project: npx @vatio-ai/skills\n"
  );
  writeState(path, { ...state, [key]: new Date().toISOString() });
}

export function skillsInstalled(startDir) {
  const claudeHome = String(process.env.CLAUDE_CONFIG_DIR ?? "").trim() || join(homedir(), ".claude");
  if (pluginInstalled(join(claudeHome, "plugins", "installed_plugins.json"))) return true;
  if (hasSkill(claudeHome)) return true;

  let dir = resolve(startDir);
  for (;;) {
    if (hasSkill(join(dir, ".claude")) || hasSkill(join(dir, ".agents"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function hasSkill(base) {
  return existsSync(join(base, "skills", SKILL, "SKILL.md"));
}

function pluginInstalled(path) {
  try {
    const plugins = JSON.parse(readFileSync(path, "utf8"))?.plugins ?? {};
    return Object.keys(plugins).some((name) => name.startsWith("vatio@"));
  } catch {
    return false;
  }
}

function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
}

function writeState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
  } catch {
    // A hint that cannot remember it was shown shows again tomorrow.
  }
}
