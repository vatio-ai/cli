// The workspace directory as the bytes that go on the wire, for
// POST /api/developer/v1/:slug/check. The port of cli/lib/workspace_bundle.rb.
//
// There is deliberately no list here of "the files a manifest reads". That list
// *is* the contract -- `widget.logo` and `identity.public_key` name files from
// inside vatio.yml -- and a client that knew it would be a client that needs a
// release every time the answer changes. So this walks what is on disk, skips
// what is plainly not workspace source, and lets the platform decide what
// matters.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Mirrors what /deploy/check enforces. Checked here as well so an oversized
// workspace fails in the terminal rather than after the upload.
export const MAX_FILES = 500;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
// Hidden entries are skipped wholesale, which is what keeps `.env` and `.git/`
// out of an upload without having to name either.
export const SKIP_DIRECTORIES = new Set(["node_modules", "tmp", "log"]);

export class BundleError extends Error {
  constructor(message) {
    super(message);
    this.name = "BundleError";
  }
}

export function buildBundle(root) {
  if (!isDirectory(root)) throw new BundleError(`not a directory: ${root}`);

  const files = [];
  let total = 0;

  for (const path of walk(root)) {
    // Posix separators on the wire: the platform materializes these into a
    // directory and a Windows client must not send backslashes for it to
    // refuse.
    const relativePath = relative(root, path).split(sep).join("/");
    const bytes = readFileSync(path);

    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new BundleError(`${relativePath} is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}`);
    }

    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new BundleError(`the workspace is over ${MAX_TOTAL_BYTES} bytes`);
    if (files.length >= MAX_FILES) throw new BundleError(`the workspace has more than ${MAX_FILES} files`);

    files.push(entryFor(relativePath, bytes));
  }

  if (files.length === 0) throw new BundleError("the workspace is empty");
  return files;
}

function* walk(dir) {
  const children = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const child of children) {
    if (child.name.startsWith(".")) continue;

    const path = join(dir, child.name);
    if (child.isDirectory()) {
      if (SKIP_DIRECTORIES.has(child.name)) continue;
      yield* walk(path);
    } else if (child.isFile()) {
      yield path;
    }
  }
}

// Text travels as text so a diff of the request is readable and a logo does not
// corrupt on the way. Anything that is not valid UTF-8 -- a png, a compiled
// asset someone left in the directory -- goes as base64.
function entryFor(path, bytes) {
  const text = bytes.toString("utf8");
  if (!text.includes("�") && !text.includes("\0") && Buffer.compare(Buffer.from(text, "utf8"), bytes) === 0) {
    return { path, content: text, encoding: "utf-8" };
  }
  return { path, content: bytes.toString("base64"), encoding: "base64" };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
