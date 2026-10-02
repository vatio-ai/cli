// Where the workspace is, and which remote it deploys to. Addressing, not
// contract -- the port of cli/lib/workspace_root.rb, and deliberately just as
// small.
//
// What a `tools/*.yml` declares, which blocks `vatio.yml` accepts and whether
// any of it is valid are answered by POST /api/developer/v1/:slug/check. The one
// thing a client cannot ask the platform for is the address of that call: the
// slug is in its URL. So this reads `workspace:` and stops.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
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

function readManifest(file) {
  if (!existsSync(file)) return null;
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${MANIFEST_FILE}: ${error.message}`);
  }
}
