// `vatio auth --new-key` — the keypair that signs the JWT saying who a visitor is.
//
// This exists because asking a developer to authenticate users and then leaving
// them to work out `openssl genpkey` flags, which half of the pair goes in the
// workspace, and what the token has to contain is most of the reason the old
// design grew a JavaScript escape hatch. Everything the platform can settle for
// them is settled here: the algorithm, the file names, the audience, and the
// exact claims, printed as code they can paste.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../support.mjs";
import { supabaseAuth } from "./supabase-auth.mjs";

const PUBLIC_FILE = "identity.pub";
const PRIVATE_FILE = "identity.pem";

export async function auth(config, args) {
  if (args.includes("--supabase")) return supabaseAuth(config, args);
  if (!args.includes("--new-key")) {
    fail(
      "Usage: vatio auth --new-key   (generates the keypair that signs your JWT)\n" +
        "       vatio auth --supabase  (your users sign in with Supabase: no keys, no code)"
    );
  }

  const root = config.workspaceRootRequired();
  const publicPath = join(root, PUBLIC_FILE);
  const privatePath = join(root, PRIVATE_FILE);
  const slug = config.resolveWorkspaceRequired();

  if (existsSync(publicPath) && !args.includes("--force")) {
    fail(
      `${PUBLIC_FILE} already exists. Rotating a key signs out every visitor holding a token ` +
        `from the old one — re-run with --force if that is what you want.`
    );
  }

  try {
    execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", privatePath], {
      stdio: "ignore"
    });
    execFileSync("openssl", ["rsa", "-in", privatePath, "-pubout", "-out", publicPath], { stdio: "ignore" });
  } catch (error) {
    if (existsSync(privatePath)) unlinkSync(privatePath);
    fail(`Could not run openssl: ${error.message}`);
  }

  // The private half must never be pushed, and the surest way to keep it out is
  // to keep it out of git — the deploy refuses it too, but by then it has
  // already been read off disk.
  ignorePrivateKey(root);

  console.log(`Wrote ${PUBLIC_FILE} and ${PRIVATE_FILE}. They go to different places.`);
  console.log("");
  console.log(`1. ${PUBLIC_FILE} stays here. Commit it, and name it in vatio.yml:`);
  console.log("");
  console.log("     auth:");
  console.log(`       public_key: ${PUBLIC_FILE}`);
  console.log("");
  console.log(`2. ${PRIVATE_FILE} goes into your backend as a secret — an env var, or`);
  console.log("   whatever credential store you use. Your backend is what signs, so it");
  console.log("   is the only thing that needs it. Then delete it from this directory:");
  console.log("");
  console.log(`     VATIO_IDENTITY_PRIVATE_KEY="$(cat ${PRIVATE_FILE})"`);
  console.log("");
  console.log("   Not `vatio secrets set` — that store is read by Vatio, and the whole");
  console.log("   point is that Vatio can check your tokens but never mint one.");
  console.log(`   (${PRIVATE_FILE} was added to .gitignore in the meantime.)`);
  console.log("");
  console.log("Sign a JWT with it for the person who is signed in:");
  console.log("");
  const claims = [
    [ '"sub": "<your user id>",', "who this is" ],
    [ `"aud": ${JSON.stringify(slug)},`, "this workspace, always" ],
    [ '"exp": <unix seconds>,', "required; keep it short" ],
    [ '"name": "Ada Lovelace",', "optional, fills the CRM" ],
    [ '"email": "ada@example.com",', "optional, fills the CRM" ],
    [ '"metadata": { ... }', "optional, profile link + badges in the inbox" ]
  ];
  const width = Math.max(...claims.map(([ claim ]) => claim.length));
  console.log("  {");
  for (const [ claim, note ] of claims) {
    console.log(`    ${claim.padEnd(width)}  // ${note}`);
  }
  console.log("  }");
  console.log("");
  console.log("Put it on the widget as data-visitor-token, and push.");
  console.log("Full examples: https://docs.vatio.ai/authentication/");
  console.log("Inbox metadata: https://docs.vatio.ai/authentication/#enrich-the-inbox");
}

function ignorePrivateKey(root) {
  const path = join(root, ".gitignore");
  const line = PRIVATE_FILE;
  let body = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (body.split(/\r?\n/).some((entry) => entry.trim() === line)) return;

  if (body.length > 0 && !body.endsWith("\n")) body += "\n";
  writeFileSync(path, `${body}${line}\n`);
}
