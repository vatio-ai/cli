// The environment a git branch gets, so that working on a branch is working in
// its own environment without saying so: `vatio push` from `fix/pagos` lands on
// `fix-pagos`, and so do `vatio kb write`, `vatio secrets set` and `vatio chat`.
// The pull request opened from that branch deploys to the same one.
//
// The default branch is not a branch environment: there, and outside a
// repository, every command keeps the default it always had.
//
// The name is derived exactly as the platform derives it for a pull request
// (Vatio::Environment.for_branch, backend/app/vatio/environment.rb). Kept in
// step by hand; both are short.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const RESERVED = new Set(["live", "preview", "staging", "sandbox", "main"]);
const MAX_LENGTH = 40;

export function environmentForBranch(ref) {
  const raw = String(ref ?? "").replace(/^refs\/heads\//, "");
  let slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug === "") return null;

  if (RESERVED.has(slug)) slug = `branch-${slug}`;
  if (slug.length <= MAX_LENGTH) return slug;

  const hash = createHash("sha1").update(String(ref)).digest("hex").slice(0, 6);
  return `${slug.slice(0, 33).replace(/-+$/, "")}-${hash}`;
}

// { branch, environment } on a branch other than the default one; null on the
// default branch, outside a repository, or with HEAD detached.
export function branchEnvironment(cwd) {
  const branch = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!branch) return null;

  const remoteHead = git(cwd, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
  const defaultBranch = remoteHead ? remoteHead.replace(/^[^/]+\//, "") : null;
  if (branch === defaultBranch || (!defaultBranch && (branch === "main" || branch === "master"))) return null;

  const environment = environmentForBranch(branch);
  return environment ? { branch, environment } : null;
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}
