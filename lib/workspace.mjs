// Where the workspace is, and which remote it deploys to. Addressing, not
// contract -- the port of cli/lib/workspace_root.rb, and deliberately just as
// small.
//
// What a `tools/*.yml` declares, which blocks `vatio.yml` accepts and whether
// any of it is valid are answered by POST /api/developer/v1/:slug/check. The one
// thing a client cannot ask the platform for is the address of that call: the
// slug is in its URL. So this reads `workspace:` and stops.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, parse as parsePath, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const MANIFEST_FILE = "vatio.yml";
// Keep in sync with Workspace::SLUG_FORMAT in urcalab/vatio. A slug that gets
// past this is still the platform's to reject; matching here only turns a typo
// into a sentence instead of a 404.
export const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The manifest in a directory, or null when the directory is not a workspace
// root. This file is the only thing that makes one.
export function manifestPath(dir) {
  const candidate = join(dir, MANIFEST_FILE);
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

// Any directory holding a manifest is a workspace root, so a vatio.yml can sit
// anywhere -- beside a backend, in a monorepo's agents/ folder, at the top of
// its own repo. The nearest one wins.
export function findWorkspaceRoot(startDir) {
  let current = resolve(startDir);
  for (;;) {
    if (manifestPath(current)) return current;
    const parent = dirname(current);
    if (parent === current || parent === parsePath(current).root) {
      return manifestPath(parent) ? parent : null;
    }
    current = parent;
  }
}

// The workspaces just below a directory that is not in one, for the error that
// says so: a coding agent started at the top of a repository is usually one
// `cd` away from its vatio.yml.
const SKIPPED_DIRS = new Set(["node_modules", "vendor", "dist", "build"]);

export function workspacesBelow(startDir, { depth = 2, limit = 3 } = {}) {
  const root = resolve(startDir);
  const found = [];
  const visit = (dir, level) => {
    if (level > depth || found.length >= limit) return;
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
      const child = join(dir, entry.name);
      if (manifestPath(child)) found.push(relative(root, child));
      else visit(child, level + 1);
      if (found.length >= limit) return;
    }
  };
  visit(root, 1);
  return found;
}

// Which workspace this directory deploys to. Addressing, not content: it names
// the remote, so it never rides along in the deployed manifest. Null when the
// file does not declare one.
export function workspaceSlug(dir) {
  const file = manifestPath(dir);
  if (!file) return null;

  const main = readManifest(file);
  if (!main || typeof main !== "object" || Array.isArray(main)) return null;

  const slug = String(main.workspace ?? "").trim().toLowerCase();
  if (slug === "") return null;
  if (!SLUG_FORMAT.test(slug)) {
    throw new Error(
      `${MANIFEST_FILE}: workspace "${slug}" is not a slug (lowercase letters, numbers, hyphens)`
    );
  }
  return slug;
}

// Points the directory at another workspace: the one a trial became when it
// was kept under a slug other than the one vatio.yml asked for. Only the
// top-level `workspace:` line changes, comment and all kept, so the rest of
// the file is exactly what the developer wrote. False when there is no such
// line to change.
export function rewriteWorkspaceSlug(dir, slug) {
  const file = manifestPath(dir);
  if (!file || !SLUG_FORMAT.test(slug)) return false;

  const text = readFileSync(file, "utf8");
  const line = /^workspace:[ \t]*(["']?)[a-z0-9-]*\1([ \t]*#.*)?$/m;
  if (!line.test(text)) return false;
  writeFileSync(file, text.replace(line, (_match, _quote, comment = "") => `workspace: ${slug}${comment}`));
  return true;
}

function readManifest(file) {
  if (!existsSync(file)) return null;
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${MANIFEST_FILE}: ${error.message}`);
  }
}
