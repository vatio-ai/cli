// Device-code auth (/api/developer/v1/device_authorizations): the CLI asks for a code, the
// developer approves it in a browser, the CLI polls until a token comes back.
// The port of cli/lib/device_auth_client.rb.
//
// Unauthenticated by definition -- this is what mints the token -- so it does
// not go through HttpClient, which requires one.

import { clientHeaders } from "./telemetry.mjs";

export class DeviceAuthError extends Error {}
export class PendingError extends DeviceAuthError {}
export class DeniedError extends DeviceAuthError {}
export class ExpiredError extends DeviceAuthError {}

export class DeviceAuthClient {
  constructor({ baseUrl }) {
    this.baseUrl = String(baseUrl ?? "").replace(/\/$/, "");
  }

  // A `workspace` lets the page the developer signs in on wait for that push
  // and land on its test screen.
  start({ workspace } = {}) {
    const body = {};
    if (workspace) body.workspace = workspace;
    return this.#post("/api/developer/v1/device_authorizations", body);
  }

  poll({ deviceCode }) {
    return this.#post("/api/developer/v1/device_authorizations/token", { device_code: deviceCode });
  }

  async #post(path, body) {
    const url = `${this.baseUrl}${path}`;
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { ...clientHeaders(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      const reason = error?.cause?.code ?? error?.name ?? "request failed";
      throw new DeviceAuthError(`${reason}: ${url}`);
    }

    const raw = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    const described = parsed?.error_description ?? parsed?.error ?? raw;

    if (response.status === 200 || response.status === 201) {
      // The pending case is a 200 with an error code in the body, which is how
      // the OAuth device flow reports "the human has not clicked yet".
      if (parsed?.error === "authorization_pending") {
        throw new PendingError(parsed.error_description ?? "authorization_pending");
      }
      return parsed;
    }
    if (response.status === 400) {
      if (parsed?.error === "expired_token") throw new ExpiredError(described ?? "expired");
      if (parsed?.error === "access_denied") throw new DeniedError(described ?? "denied");
      throw new DeviceAuthError(String(described));
    }
    if (response.status === 403 || response.status === 404) {
      throw new DeniedError(String(described));
    }
    throw new DeviceAuthError(`HTTP ${response.status}: ${String(described)}`);
  }
}
