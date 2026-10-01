// Local-only CLI settings, in the same file the Ruby CLI uses:
// ~/.vatio/config.json, or $VATIO_HOME/config.json.
//
// Deliberately the same file and the same keys. Someone who already ran
// `vatio login` through the curl installer can run `npx @vatio-ai/cli push` without
// logging in again, and can go back, because neither client owns the
// credential -- the developer's home does.
//
// Two scopes, as before: credentials are per developer and live here; workspace
// identity is per directory and lives in that workspace's own vatio.yml. There
// is no --workspace flag, because the slug is a property of the directory, and
// reading it anywhere else is how a push lands in the wrong workspace.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MANIFEST_FILE, SLUG_FORMAT, findWorkspaceRoot, manifestPath, workspaceSlug } from "./workspace.mjs";

export const KEYS = ["base_url", "token"];
export const DEFAULT_BASE_URL = "https://vatio.ai";
// `as`, `channel` and `from` configured a simulated visitor for `vatio chat`.
// That simulation is gone from the platform, so they are refused as keys and
// dropped from a config file that still carries them.
export const REMOVED_KEYS = ["as", "channel", "from"];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

export function configHome() {
  const override = String(process.env.VATIO_HOME ?? "").trim();
  return override === "" ? join(homedir(), ".vatio") : resolve(override);
}

export class Config {
  constructor({ startDir = process.cwd() } = {}) {
    this.startDir = resolve(startDir);
    this.configPath = join(configHome(), "config.json");
    this.workspaceRoot = findWorkspaceRoot(this.startDir);
    this.legacyKeysRemoved = [];
  }

  load() {
    if (!existsSync(this.configPath)) return {};
    let data;
    try {
      data = JSON.parse(readFileSync(this.configPath, "utf8"));
    } catch {
      return {};
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return this.#dropRemovedKeys(data);
  }

  save(data) {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, `${JSON.stringify(data, null, 2)}\n`);
    // A token lives here. 0600 matches what the Ruby CLI writes, so switching
    // between the two clients never loosens the file.
    chmodSync(this.configPath, 0o600);
    return data;
  }

  get(key) {
    return presence(this.load()[this.#normalizeKey(key)]);
  }

  set(key, value) {
    const normalized = this.#normalizeKey(key);
    const cleaned = String(value ?? "").trim();
    if (cleaned === "") throw new ConfigError(`${normalized} cannot be empty`);

    const data = this.load();
    data[normalized] = cleaned;
    this.save(data);
    return cleaned;
  }

  unset(key) {
    const normalized = this.#normalizeKey(key);
    const data = this.load();
    delete data[normalized];
    this.save(data);
    return null;
  }

  resolveBaseUrl() {
    return (
      stripSlash(presence(process.env.VATIO_BASE_URL)) ??
      stripSlash(presence(this.load().base_url)) ??
      DEFAULT_BASE_URL
    );
  }

  resolveToken() {
    return presence(process.env.VATIO_TOKEN) ?? presence(this.load().token);
  }

  // One source, always: the manifest of the workspace the cwd is in.
  resolveWorkspace() {
    if (!this.workspaceRoot) return null;
    return presence(workspaceSlug(this.workspaceRoot))?.toLowerCase() ?? null;
  }

  resolveWorkspaceRequired() {
    const slug = this.resolveWorkspace();
    if (slug) return slug;

    const manifest = this.manifestPath();
    if (manifest) {
      throw new ConfigError(
        `${MANIFEST_FILE} does not say which workspace it is.\n` +
          `Add this as its first line:\n\n  workspace: ${this.suggestedSlug()}`
      );
    }
    return this.workspaceRootRequired();
  }

  workspaceRootRequired() {
    if (this.workspaceRoot) return this.workspaceRoot;
    throw new ConfigError(
      `Not inside a Vatio workspace (no ${MANIFEST_FILE} found walking up from ${this.startDir}).\n` +
        "Run `vatio init SLUG` here to create one."
    );
  }

  manifestPath() {
    return this.workspaceRoot ? manifestPath(this.workspaceRoot) : null;
  }

  // The workspace's slice of the API, which is what chat talks to.
  resolveApiUrl({ explicit = null } = {}) {
    const url = presence(explicit);
    if (url) return stripSlash(url);

    const base = this.resolveBaseUrl();
    const workspace = this.resolveWorkspace();
    if (!base || !workspace) return null;
    return `${base}/api/v1/${workspace}`;
  }

  writeAuth({ baseUrl, token }) {
    const data = this.load();
    data.base_url = stripSlash(String(baseUrl ?? "")) ?? "";
    data.token = String(token ?? "");
    return this.save(data);
  }

  clearToken() {
    const data = this.load();
    delete data.token;
    return this.save(data);
  }

  displayHash() {
    const out = {};
    const base = this.resolveBaseUrl();
    if (base) out.base_url = base;
    const token = this.resolveToken();
    if (token) out.token = maskSecret(token);
    return out;
  }

  // What `vatio init` would name a workspace created right here.
  suggestedSlug() {
    const base = (this.workspaceRoot ?? this.startDir).split(/[\\/]/).filter(Boolean).pop() ?? "";
    const name = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return name === "" ? "my-agent" : name;
  }

  #dropRemovedKeys(data) {
    const removed = REMOVED_KEYS.filter((key) => Object.hasOwn(data, key));
    if (removed.length === 0) return data;

    for (const key of removed) delete data[key];
    this.legacyKeysRemoved = removed;
    this.save(data);
    return data;
  }

  #normalizeKey(key) {
    const normalized = String(key ?? "").trim();
    if (normalized === "assistants") {
      throw new ConfigError(
        'config key "assistants" was removed — Vatio no longer installs local skills; see https://docs.vatio.ai'
      );
    }
    if (normalized === "workspace") {
      throw new ConfigError(`the workspace is named by \`workspace:\` in ${MANIFEST_FILE}, never by config`);
    }
    if (REMOVED_KEYS.includes(normalized)) {
      throw new ConfigError(
        `config key "${normalized}" was removed — a \`vatio chat\` is you, the developer holding the ` +
          "token. Test a real channel with `vatio whatsapp numbers` or an Instagram test account, and " +
          "pick a deployment with `vatio chat --env NAME`."
      );
    }
    if (!KEYS.includes(normalized)) {
      throw new ConfigError(`unknown key "${key}" (allowed: ${KEYS.join(", ")})`);
    }
    return normalized;
  }
}

export { SLUG_FORMAT };

function presence(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function stripSlash(value) {
  return value == null ? null : value.replace(/\/$/, "");
}

function maskSecret(value) {
  if (!value) return null;
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}
