// login / logout, and the device-code dance they share with `init`.

import { DeviceAuthClient, ExpiredError, PendingError } from "../device-auth.mjs";
import { DEFAULT_BASE_URL } from "../config.mjs";
import { ask, fail, openBrowser, sleep, takeValue } from "../support.mjs";

// A token is minted by a human approving it in a browser, never by the CLI
// alone. The email turns that approval into a link we mail, which is what lets
// somebody with no account finish it; typing nothing falls back to the URL.
export async function deviceLogin({ baseUrl, message, email }) {
  const resolved = String(baseUrl || process.env.VATIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const client = new DeviceAuthClient({ baseUrl: resolved });

  console.log(message);
  const address = String(email ?? (await ask("Your email (we send you a link): "))).trim();

  const auth = await client.start({ email: address });
  const deviceCode = auth.device_code;
  const userCode = auth.user_code;
  const verificationUri = auth.verification_uri_complete ?? auth.verification_uri;
  const interval = Number(auth.interval ?? 5);
  const expiresIn = Number(auth.expires_in ?? 900);
  if (!deviceCode || !verificationUri) fail("The platform did not return a device code");

  console.log("");
  if (auth.email_sent) {
    console.log(`We emailed ${address} a link.`);
    console.log(`This terminal is ${userCode} — check it matches before you approve.`);
  } else {
    console.log(`Open: ${verificationUri}`);
    console.log(`Code: ${userCode}`);
    openBrowser(verificationUri);
  }
  console.log("");
  console.log("Waiting…");

  const deadline = Date.now() + expiresIn * 1000;
  for (;;) {
    if (Date.now() > deadline) fail("Timed out waiting for authorization");
    try {
      const result = await client.poll({ deviceCode });
      return {
        token: result.token,
        baseUrl: String(result.base_url ?? "").trim() || resolved
      };
    } catch (error) {
      if (error instanceof PendingError) {
        await sleep(interval * 1000);
        continue;
      }
      if (error instanceof ExpiredError) fail("The code expired. Run `vatio login` again.");
      throw error;
    }
  }
}

export async function login(config, args) {
  const baseUrl = takeValue(args, "--base-url");
  const { token, baseUrl: resolved } = await deviceLogin({
    baseUrl,
    message: "Starting device authorization for Vatio CLI…"
  });

  config.writeAuth({ baseUrl: resolved, token });
  console.log(`Logged in to ${resolved}`);
  console.log(`Token saved to ${config.configPath}`);
}

export function logout(config) {
  config.clearToken();
  console.log(`Removed the token from ${config.configPath}`);
}
