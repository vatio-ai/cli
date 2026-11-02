// Local-only CLI settings, in the same file the Ruby CLI uses:
// ~/.vatio/config.json, or $VATIO_HOME/config.json.
//
// Deliberately the same file and the same keys. Someone who already ran
// `vatio login` through the curl installer can run `npx @vatio-ai/cli push` without
// logging in again, and can go back, because neither client owns the
// credential -- the developer's home does.
//
// Two scopes, as before: credentials are per developer and live here; workspace
// identity is per directory and lives in that workspace's own vatio.yml.
//
// A workspace built through the Vatio MCP has no vatio.yml, and the commands
// that only talk to the platform (`vatio status`, `vatio business`, `vatio
// keys`...) are as useful to it as to one kept as files. So `--workspace SLUG`
// and VATIO_WORKSPACE name a workspace too, ahead of the vatio.yml. The
// commands that read or write the workspace's files (init, push, pull, diff,
// auth --new-key) still go by the directory alone and refuse both: for them
// the slug is a property of the files, and reading it anywhere else is how a
// push lands in the wrong workspace.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MANIFEST_FILE, SLUG_FORMAT, findWorkspaceRoot, manifestPath, workspaceSlug, workspacesBelow } from "./workspace.mjs";

export const KEYS = ["base_url", "token"];
export const WORKSPACE_ENV = "VATIO_WORKSPACE";
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

// `--workspace SLUG` or `--workspace=SLUG`, wherever it is on the command line,
// taken out of `args` before anything reads the command: it means the same for
// every command, and none of them should take it for a message or a value.
export function takeWorkspaceFlag(args) {
  let found = null;
  for (let i = 0; i < args.length; ) {
    let value;
    if (args[i] === "--workspace") {
      value = args[i + 1];
      if (value === undefined || value.startsWith("-")) value = "";
      args.splice(i, value === "" ? 1 : 2);
    } else if (args[i].startsWith("--workspace=")) {
      value = args[i].slice("--workspace=".length);
      args.splice(i, 1);
    } else {
      i += 1;
      continue;
    }
    if (value.trim() === "") throw new ConfigError("--workspace needs the workspace's slug: --workspace SLUG");
    if (found !== null && found !== value) throw new ConfigError(`--workspace is given twice (${found}, ${value}): name one workspace.`);
    found = value;
  }
  return found;
}

export class Config {
  #differenceSaid = false;

  constructor({ startDir = process.cwd() } = {}) {
    this.startDir = resolve(startDir);
    this.configPath = join(configHome(), "config.json");
    this.workspaceRoot = findWorkspaceRoot(this.startDir);
    this.legacyKeysRemoved = [];
    // `--workspace`'s value, which bin/vatio.mjs takes out of the arguments.
    this.workspaceFlag = null;
    // Set for a command that works on the files (bindToDirectory).
    this.directoryCommand = null;
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
    mkdirSync(dirname(this.configPath), { recursive: true, mode: 0o700 });
    // A token lives here. 0600 matches what the Ruby CLI writes, so switching
    // between the two clients never loosens the file. Created 0600 rather
    // than chmod-ed after, which left a moment where the umask's 0644 let
    // other users on the machine read it; the chmod still tightens a file an
    // older release wrote.
    writeFileSync(this.configPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
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

  // --workspace, then VATIO_WORKSPACE, then the manifest of the workspace the
  // cwd is in. `quiet` keeps a vatio.yml that names another workspace from
  // being mentioned, for a caller that is not running the command.
  resolveWorkspace({ quiet = false } = {}) {
    const named = this.namedWorkspace();
    if (!named) return this.directoryWorkspace();
    if (!quiet) this.#sayWhenDirectoryDiffers(named);
    return named.slug;
  }

  // The `workspace:` of the vatio.yml at or above the cwd.
  directoryWorkspace() {
    if (!this.workspaceRoot) return null;
    return presence(workspaceSlug(this.workspaceRoot))?.toLowerCase() ?? null;
  }

  // The workspace named without a vatio.yml, and by what; null when neither
  // the flag nor the variable is given. A slug that is not one is refused
  // here, where it can still be a sentence rather than a 404.
  namedWorkspace() {
    const flagged = this.workspaceFlag !== null;
    const value = flagged ? this.workspaceFlag : presence(process.env[WORKSPACE_ENV]);
    if (value === null) return null;

    const source = flagged ? "--workspace" : WORKSPACE_ENV;
    const slug = value.trim().toLowerCase();
    if (!SLUG_FORMAT.test(slug)) {
      throw new ConfigError(
        `${source} ${JSON.stringify(value)} is not a workspace slug (lowercase letters, numbers, hyphens). ` +
          "`vatio whoami` lists the workspaces this machine reaches."
      );
    }
    return { slug, source };
  }

  // What named the workspace, for a message that has to say so.
  workspaceSource() {
    if (this.workspaceFlag !== null) return "--workspace";
    if (presence(process.env[WORKSPACE_ENV])) return WORKSPACE_ENV;
    return this.workspaceRoot ? MANIFEST_FILE : null;
  }

  // For a command that reads or writes the workspace's files, called before it
  // does anything. The flag is refused outright; VATIO_WORKSPACE only when it
  // names a workspace other than the directory's, since an app's own config
  // reads the same variable and having it exported should not stop a push.
  bindToDirectory(command) {
    this.directoryCommand = command;
    const [takes, there] =
      command === "init"
        ? [`writes ${MANIFEST_FILE} here and takes the workspace from its SLUG argument`, ""]
        : [`works from the directory that holds ${MANIFEST_FILE} and takes the workspace from it`, " there"];
    const refusal = `\`vatio ${command}\` ${takes}`;
    if (this.workspaceFlag !== null) throw new ConfigError(`${refusal}: run it${there} without --workspace.`);

    const named = presence(process.env[WORKSPACE_ENV]);
    if (named !== null && named.toLowerCase() !== this.#directorySlugOrNull()) {
      throw new ConfigError(`${refusal}, not from ${WORKSPACE_ENV} (${named}): run it${there} with ${WORKSPACE_ENV} unset.`);
    }
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
    const named = this.namedWorkspace();
    if (named && named.slug !== this.#directorySlugOrNull()) {
      throw new ConfigError(
        `This works on the workspace's files, and ${named.source} names ${named.slug}, which has none here: ` +
          `run it from the directory whose ${MANIFEST_FILE} says \`workspace: ${named.slug}\`, without ${named.source}.`
      );
    }
    if (this.workspaceRoot) return this.workspaceRoot;

    const below = workspacesBelow(this.startDir);
    const lines = [`Not inside a Vatio workspace (no ${MANIFEST_FILE} found walking up from ${this.startDir}).`];
    if (below.length > 0) {
      lines.push(`There is one in ${below.map((dir) => `./${dir}`).join(", ")}: run it from there (\`cd ${below[0]}\`).`);
    }
    // Only a command that takes --workspace is told about it.
    if (this.directoryCommand) {
      if (below.length === 0) lines.push("Run `vatio init SLUG` here to create one.");
    } else {
      lines.push(
        `A workspace with no ${MANIFEST_FILE}, built through the Vatio MCP, is named with --workspace SLUG ` +
          `(\`vatio whoami\` lists yours)${below.length === 0 ? "; `vatio init SLUG` starts one kept as files here" : ""}.`
      );
    }
    throw new ConfigError(lines.join("\n"));
  }

  // The directory that holds the addressed workspace's files, or null: a
  // workspace named by --workspace or VATIO_WORKSPACE has one here only when
  // the vatio.yml here names it too. For what may sit beside vatio.yml without
  // being required (identity.pem, .env, the chat state), so it never throws.
  workspaceDirectory() {
    if (!this.workspaceRoot) return null;
    let named;
    try {
      named = this.namedWorkspace();
    } catch {
      return null;
    }
    if (!named) return this.workspaceRoot;
    return named.slug === this.#directorySlugOrNull() ? this.workspaceRoot : null;
  }

  #directorySlugOrNull() {
    try {
      return this.directoryWorkspace();
    } catch {
      return null;
    }
  }

  // Said once, on stderr, so that a vatio.yml naming another workspace is
  // never a surprise: the named one wins.
  #sayWhenDirectoryDiffers(named) {
    if (this.#differenceSaid) return;
    const here = this.#directorySlugOrNull();
    if (here === null || here === named.slug) return;
    this.#differenceSaid = true;
    console.error(`vatio: using workspace ${named.slug} from ${named.source}, not ${here} from ${this.manifestPath()}`);
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

  pendingLogin() {
    const pending = this.load().pending_login;
    return pending && typeof pending === "object" && pending.device_code ? pending : null;
  }

  writePendingLogin(pending) {
    const data = this.load();
    data.pending_login = pending;
    return this.save(data);
  }

  clearPendingLogin() {
    const data = this.load();
    if (!Object.hasOwn(data, "pending_login")) return data;
    delete data.pending_login;
    return this.save(data);
  }

  // The deployment a workspace's files were last made to match, by a push or
  // a pull, which the next push says it is built on: the platform refuses one
  // that would overwrite edits made since outside the files. Per server and
  // workspace, since a deployment id only means anything on the server that
  // issued it; null when this machine never pushed or pulled it.
  baseDeploymentFor({ baseUrl, workspace }) {
    const all = this.load().base_deployments;
    const id = plainObject(all) && plainObject(all[stripSlash(baseUrl)]) ? all[stripSlash(baseUrl)][workspace] : null;
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  // Quietly does nothing when the file cannot be written: the push or pull it
  // follows already happened, and the cost of forgetting is one refused push
  // that says to pull.
  rememberBaseDeployment({ baseUrl, workspace, deploymentId }) {
    const id = Number(deploymentId);
    const server = stripSlash(baseUrl);
    if (!Number.isInteger(id) || id <= 0 || !server || !workspace) return;
    try {
      const data = this.load();
      const all = plainObject(data.base_deployments) ? data.base_deployments : {};
      const forServer = plainObject(all[server]) ? all[server] : {};
      data.base_deployments = { ...all, [server]: { ...forServer, [workspace]: id } };
      this.save(data);
    } catch {
      // See above.
    }
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
        'config key "assistants" was removed — Vatio no longer installs local skills; see https://vatio.ai/docs'
      );
    }
    if (normalized === "workspace") {
      throw new ConfigError(
        `the workspace is named by \`workspace:\` in ${MANIFEST_FILE}, or by --workspace or ${WORKSPACE_ENV}, never by config`
      );
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

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function maskSecret(value) {
  if (!value) return null;
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}
