// Who a developer's chat or test run talks as: a signed-in visitor, proved the
// way the widget proves one -- a JWT the workspace signed.
//
// Vatio holds only the public key, so it cannot mint this token and nothing
// here asks it to. The developer already holds the private half (`vatio auth
// --new-key` made it) and could sign a token for any `sub` by hand; signing it
// here only saves the openssl and base64 work, so the key never leaves the
// machine and Vatio's check on the other side is the one visitors face.
//
//   --as-subject ID        sign a token for this subject with your identity key
//   --visitor-token JWT    use a token you already have (VATIO_VISITOR_TOKEN too)
//   --identity-key FILE    the key to sign with (default: VATIO_IDENTITY_PRIVATE_KEY,
//                          then identity.pem next to vatio.yml)

import { constants, createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { fail, takeValue } from "./support.mjs";
import { MANIFEST_FILE } from "./workspace.mjs";

const KEY_ENV = "VATIO_IDENTITY_PRIVATE_KEY";
const KEY_FILE = "identity.pem";
const TOKEN_ENV = "VATIO_VISITOR_TOKEN";
// Long enough for a test run to finish on Vatio's servers, short enough that a
// token lost in a transcript is worthless by the afternoon.
const TTL_SECONDS = 60 * 60;

const ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"];
const ES_CURVES = { prime256v1: "ES256", secp384r1: "ES384", secp521r1: "ES512" };

export const IDENTITY_FLAGS_USAGE = "[--as-subject ID | --visitor-token JWT] [--identity-key FILE]";

// Takes the identity flags out of `args`. Null when none was asked for, so a
// command that does not need an identity behaves exactly as before.
export function takeIdentity(args, config) {
  const subject = takeValue(args, "--as-subject");
  const keyFile = takeValue(args, "--identity-key");
  const flagged = takeValue(args, "--visitor-token");

  if (subject !== null && flagged !== null) fail("Use --as-subject or --visitor-token, not both.");
  const token = flagged ?? (subject === null ? process.env[TOKEN_ENV] || null : null);

  if (subject === null && token === null) {
    if (keyFile !== null) fail("--identity-key signs a token for --as-subject; pass that too.");
    return null;
  }
  if (token !== null) return { token: token.trim(), subject: subjectOf(token), signed: false };
  if (subject.trim() === "") fail("--as-subject needs the id your backend knows the person by.");

  return { subject, signed: true, sign: () => signToken({ subject, config, keyFile }) };
}

// The token to send now. A signed one is made fresh each time, so a chat that
// outlives one token keeps going on the next.
export function tokenFor(identity) {
  return identity.signed ? identity.sign() : identity.token;
}

function signToken({ subject, config, keyFile }) {
  const key = loadKey(config, keyFile);
  const algorithm = declaredAlgorithm(config) ?? algorithmFor(key);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: algorithm, typ: "JWT" };
  const claims = { sub: subject, aud: config.resolveWorkspaceRequired(), iat: now, exp: now + TTL_SECONDS };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const options = { key };
  if (algorithm.startsWith("PS")) {
    options.padding = constants.RSA_PKCS1_PSS_PADDING;
    options.saltLength = constants.RSA_PSS_SALTLEN_DIGEST;
  }
  // JWT writes an ECDSA signature as r || s, not the ASN.1 form OpenSSL gives.
  if (algorithm.startsWith("ES")) options.dsaEncoding = "ieee-p1363";

  const signature = sign(`sha${algorithm.slice(2)}`, Buffer.from(signingInput), options);
  return `${signingInput}.${base64url(signature)}`;
}

function loadKey(config, keyFile) {
  let pem = null;
  if (keyFile !== null) {
    if (!existsSync(keyFile)) fail(`--identity-key ${keyFile} does not exist.`);
    pem = readFileSync(keyFile, "utf8");
  } else if (process.env[KEY_ENV]) {
    pem = process.env[KEY_ENV];
  } else {
    const path = join(config.workspaceRootRequired(), KEY_FILE);
    if (existsSync(path)) pem = readFileSync(path, "utf8");
  }
  if (pem === null) {
    fail(
      `There is no key to sign with. Put the private key you made with \`vatio auth --new-key\` in ${KEY_ENV}, ` +
        `or in ${KEY_FILE} next to vatio.yml, or pass --identity-key FILE. ` +
        "If you sign tokens somewhere else, make one there and pass it as --visitor-token."
    );
  }
  try {
    return createPrivateKey(pem);
  } catch {
    fail(`The identity key is not a PEM private key. Check ${keyFile ?? `${KEY_ENV} or ${KEY_FILE}`}.`);
  }
}

// Vatio verifies with the algorithm the manifest declares, never the token's
// own header, so a token signed with another one would simply not verify.
function declaredAlgorithm(config) {
  try {
    const manifest = parseYaml(readFileSync(join(config.workspaceRootRequired(), MANIFEST_FILE), "utf8"));
    const algorithm = String(manifest?.auth?.algorithm ?? "").trim().toUpperCase();
    return ALGORITHMS.includes(algorithm) ? algorithm : null;
  } catch {
    return null;
  }
}

// What the workspace's `auth.algorithm` is when the manifest leaves it out:
// the one the key's type implies.
function algorithmFor(key) {
  if (key.asymmetricKeyType === "rsa") return "RS256";
  if (key.asymmetricKeyType === "ec") {
    const algorithm = ES_CURVES[key.asymmetricKeyDetails?.namedCurve];
    if (algorithm) return algorithm;
  }
  return fail("The identity key has to be an RSA or EC (P-256, P-384, P-521) private key.");
}

function subjectOf(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (payload.sub !== undefined && payload.sub !== null && String(payload.sub) !== "") return String(payload.sub);
  } catch {
    // Falls through to the message below.
  }
  return fail("--visitor-token is not a JWT with a `sub`.");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}
