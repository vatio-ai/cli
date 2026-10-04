// Bearer JSON client for the Vatio API. The Ruby CLI's VatioHttpClient, in
// Node: same paths, same bearer header, same typed errors, so both clients
// report a 401 or a 422 the same way.
//
// fetch() rather than a library: it has been in Node since 18, and this package
// stays at one dependency (yaml, for the one file a workspace still parses).

import { clientHeaders } from "./telemetry.mjs";

export class HttpError extends Error {
  constructor(message, { status = null, requestId = null, body = {} } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.requestId = requestId;
    this.body = body && typeof body === "object" ? body : {};
  }
}

export class UnauthorizedError extends HttpError {}
export class ForbiddenError extends HttpError {}
export class NotFoundError extends HttpError {}

export class UnprocessableError extends HttpError {
  constructor(body) {
    const hash = body && typeof body === "object" ? body : {};
    super(unprocessableMessage(hash), { status: 422, requestId: hash.request_id, body: hash });
    this.errorKey = hash.error_key ?? null;
    this.errorMessage = hash.error_message ?? null;
  }
}

// `errors` is a list of strings on the deploy endpoints and a list of
// { message, path } on /deploy/check, which carries the file a message is
// about. Read both rather than printing an object at someone.
function unprocessableMessage(body) {
  const errors = (Array.isArray(body.errors) ? body.errors : [])
    .filter((entry) => entry != null)
    .map((entry) => (typeof entry === "object" ? String(entry.message ?? "") : String(entry)));
  if (errors.length > 0) return errors.join("; ");

  // `{ error: { code, message } }` is how the knowledge and token endpoints
  // say it.
  const error = body.error && typeof body.error === "object" && !Array.isArray(body.error) ? body.error.message : body.error;
  const message = body.error_message ?? error;
  if (message != null) return Array.isArray(message) ? message.join("; ") : String(message);

  return "Unprocessable";
}

const CONNECT_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 120_000;

export class HttpClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = String(baseUrl ?? "").replace(/\/$/, "");
    this.token = String(token ?? "");
    if (!this.baseUrl) throw new Error("baseUrl is required");
    if (!this.token) throw new Error("token is required");
  }

  get(path, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query}` : "";
    return this.#perform("GET", `${path}${suffix}`);
  }

  post(path, body = {}) {
    return this.#perform("POST", path, body);
  }

  put(path, body = {}) {
    return this.#perform("PUT", path, body);
  }

  patch(path, body = {}) {
    return this.#perform("PATCH", path, body);
  }

  delete(path) {
    return this.#perform("DELETE", path);
  }

  async #perform(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      ...clientHeaders(),
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json"
    };
    const init = { method, headers, signal: AbortSignal.timeout(READ_TIMEOUT_MS) };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // A refused connection, an unknown host or a timeout are all "the
      // platform did not answer", and the developer only needs to know which
      // host did not answer.
      const reason = error?.cause?.code ?? error?.name ?? "request failed";
      throw new HttpError(`${reason}: ${url}`);
    }

    return this.#parse(response);
  }

  async #parse(response) {
    const status = response.status;
    const raw = await response.text();
    const body = parseJson(raw);
    const requestId = body?.request_id ?? response.headers.get("x-request-id") ?? null;
    const message = responseMessage(body, raw, response);

    if (status >= 200 && status < 300) {
      if (raw.trim() === "") return {};
      if (body === null) throw new HttpError(`HTTP ${status}: invalid JSON`, { status, requestId });
      return body;
    }

    const options = { status, requestId, body: body ?? {} };
    if (status === 401) throw new UnauthorizedError(message, options);
    if (status === 403) throw new ForbiddenError(message, options);
    if (status === 404) throw new NotFoundError(message, options);
    if (status === 422) throw new UnprocessableError(body);
    throw new HttpError(`HTTP ${status}: ${message}`, options);
  }
}

function parseJson(raw) {
  if (String(raw ?? "").trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { data: parsed };
  } catch {
    return null;
  }
}

function responseMessage(body, raw, response) {
  if (body) {
    let value = body.error_description ?? body.error_message ?? body.error;
    if (value && typeof value === "object" && !Array.isArray(value)) value = value.message;
    if (value != null) return Array.isArray(value) ? value.join("; ") : String(value);
  }

  const text = String(raw ?? "").trim();
  // An HTML error page says nothing a developer can act on; the status text does.
  if (text === "" || text.startsWith("<")) return response.statusText || `HTTP ${response.status}`;
  return text.slice(0, 200);
}
