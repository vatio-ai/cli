// login / logout, and the device-code dance they share with `push`.

import { DeniedError, DeviceAuthClient, ExpiredError, PendingError } from "../device-auth.mjs";
import { DEFAULT_BASE_URL } from "../config.mjs";
import { fail, openBrowser, sleep, takeValue } from "../support.mjs";
import { clientHeaders } from "../telemetry.mjs";

const LOGOUT_TIMEOUT_MS = 10_000;

// A token is minted by a human signing in on the page this opens -- email,
// Google or GitHub -- never by the CLI alone, which is why it asks nothing
// itself: a coding agent running it has no one to ask. The code in flight is
// kept in the config file, so an agent whose shell gave up waiting picks the
// same page back up on its next run instead of starting over.
export async function deviceLogin({ config, baseUrl, message, workspace = null }) {
  const resolved = String(baseUrl || process.env.VATIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const client = new DeviceAuthClient({ baseUrl: resolved });

  console.log(message);
  let pending = config.pendingLogin();
  const resumed = pending && pending.base_url === resolved && pending.expires_at > Date.now();
  if (!resumed) pending = await startLogin({ config, client, resolved, workspace });

  console.log("");
  console.log(resumed ? "Still waiting for you to sign in here:" : "Sign in to Vatio here:");
  console.log(`  ${pending.url}`);
  console.log(`This terminal is ${pending.user_code} — check the page shows the same code.`);
  console.log("(A coding agent running this: if no browser opened, show this link to the person you work for.)");
  if (!resumed) openBrowser(pending.url);
  console.log("");
  console.log("Waiting… (if this gets cut off, run the same command again once you have signed in)");

  for (;;) {
    if (Date.now() > pending.expires_at) {
      config.clearPendingLogin();
      fail("The link expired. Run the command again to get a new one.");
    }
    try {
      const result = await client.poll({ deviceCode: pending.device_code });
      config.clearPendingLogin();
      return {
        token: result.token,
        baseUrl: String(result.base_url ?? "").trim() || resolved
      };
    } catch (error) {
      if (error instanceof PendingError) {
        await sleep(pending.interval * 1000);
        continue;
      }
      if (error instanceof ExpiredError || error instanceof DeniedError) {
        config.clearPendingLogin();
        fail(error instanceof DeniedError
          ? "The sign-in was turned down in the browser. Run the command again to get a new link."
          : "The link expired. Run the command again to get a new one.");
      }
      throw error;
    }
  }
}

async function startLogin({ config, client, resolved, workspace }) {
  const auth = await client.start({ workspace });
  const url = auth.verification_uri_complete ?? auth.verification_uri;
  if (!auth.device_code || !url) fail("The platform did not return a device code");

  const pending = {
    base_url: resolved,
    url,
    device_code: auth.device_code,
    user_code: auth.user_code,
    interval: Number(auth.interval ?? 5),
    expires_at: Date.now() + Number(auth.expires_in ?? 900) * 1000
  };
  config.writePendingLogin(pending);
  return pending;
}

export async function login(config, args) {
  const baseUrl = takeValue(args, "--base-url");
  const { token, baseUrl: resolved } = await deviceLogin({
    config,
    baseUrl,
    message: "Signing this machine in to Vatio…"
  });

  config.writeAuth({ baseUrl: resolved, token });
  console.log(`Logged in to ${resolved}`);
  console.log(`Token saved to ${config.configPath}`);
}

// Revokes the saved token on the server before forgetting it, so a copy of
// the config file stops working too. Offline or already revoked, the local
// copy is still removed. A token in VATIO_TOKEN is left alone: it was never
// this file's to forget.
export async function logout(config) {
  const token = config.load().token;
  let revoked = false;
  if (token) {
    try {
      const response = await fetch(`${config.resolveBaseUrl()}/api/developer/v1/session`, {
        method: "DELETE",
        headers: { ...clientHeaders(), Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS)
      });
      revoked = response.ok;
    } catch {
      revoked = false;
    }
  }

  config.clearToken();
  console.log(`Removed the token from ${config.configPath}`);
  if (token && !revoked) console.log("Could not reach Vatio to revoke it; it expires 90 days after its last use.");
}
