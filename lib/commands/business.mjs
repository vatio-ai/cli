// business — the business the agent works for: name, description and brand
// (logo, color, about). Not part of vatio.yml: it belongs to
// whoever runs the business and is usually edited on the inbox's Business
// page. This is the same row, for a developer setting a workspace up from a
// terminal. One value for every environment, live on save.

import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { deployClient } from "./deploy.mjs";
import { fail, takeFlag, takeValue } from "../support.mjs";

const HEX = /^#[0-9a-fA-F]{6}$/;
// The platform checks the type and the size again; these only fail early.
const LOGO_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const USAGE =
  "Usage: vatio business [show]\n" +
  "       vatio business set [--name NAME] [--description TEXT | --description-file FILE]\n" +
  "                          [--about TEXT] [--color #RRGGBB | --color default]\n" +
  "                          [--logo FILE | --remove-logo]";

export async function business(config, args) {
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "show";

  if (sub === "show") {
    print(await client.business(), workspace);
    return;
  }
  if (sub === "set") {
    const fields = {};
    const name = takeValue(args, "--name");
    const description = takeValue(args, "--description");
    const file = takeValue(args, "--description-file");
    if (description !== null && file !== null) fail("Give --description or --description-file, not both");
    if (name !== null) fields.name = name;
    if (description !== null) fields.summary = description;
    if (file !== null) fields.summary = readFileSync(file === "-" ? 0 : file, "utf8");

    const about = takeValue(args, "--about");
    if (about !== null) fields.about = about;

    const color = takeValue(args, "--color");
    if (color !== null) {
      if (color !== "default" && !HEX.test(color)) fail(`--color: "${color}" is not #RRGGBB (or "default")`);
      fields.accent_color = color === "default" ? null : color.toUpperCase();
    }

    const logo = takeValue(args, "--logo");
    const removeLogo = takeFlag(args, "--remove-logo");
    if (logo !== null && removeLogo) fail("Give --logo or --remove-logo, not both");
    if (logo !== null) fields.logo = readLogo(logo);
    if (removeLogo) fields.logo = null;
    rejectLeftovers(args);
    if (Object.keys(fields).length === 0) fail(USAGE);

    print(await client.updateBusiness(fields), workspace);
    return;
  }
  if (sub === "hours") {
    fail(
      "Business hours were removed. To have a person take a conversation over, give the agent a tool " +
        "that alerts your team: https://vatio.ai/docs/handoff",
    );
  }

  fail(USAGE);
}

// Sent inside the JSON body, base64, the same way the inbox sends it.
function readLogo(path) {
  const contentType = LOGO_TYPES[extname(path).toLowerCase()];
  if (!contentType) fail(`--logo: ${path} must be a PNG, JPG, WebP or GIF`);
  let size;
  try {
    size = statSync(path).size;
  } catch {
    fail(`--logo: cannot read ${path}`);
  }
  if (size > LOGO_MAX_BYTES) fail(`--logo: ${path} is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB`);
  return { data: readFileSync(path).toString("base64"), content_type: contentType, filename: basename(path) };
}

function rejectLeftovers(args) {
  if (args.length > 0) fail(`Unexpected: ${args.join(" ")}\n\n${USAGE}`);
}

function print(payload, workspace) {
  console.log(`${payload.name}  (workspace ${workspace})`);
  console.log("");
  console.log(payload.summary ? indent(payload.summary) : "  No description yet. Set one: vatio business set --description \"…\"");
  console.log("");

  console.log("Brand:");
  console.log(`  logo   ${payload.logo_url ?? "none (vatio business set --logo FILE)"}`);
  console.log(`  color  ${payload.accent_color ?? `${payload.default_accent_color} (Vatio's default)`}`);
  console.log(`  about  ${payload.about ? payload.about.replace(/\s*\n\s*/g, " ") : "none"}`);
}

function indent(text) {
  return String(text)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
