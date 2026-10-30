// Everything the CLI can ask of one workspace: /api/developer/v1/:slug/*.
//
// One class rather than a client per surface. They share a host, a token and an
// error contract, and splitting them only ever meant passing the same three
// things around four times.

import { HttpClient } from "./http.mjs";

const encode = (value) => encodeURIComponent(String(value));

function chatFields({ environment, asPhone, visitorToken }) {
  const body = { environment };
  if (asPhone) body.as_phone = asPhone;
  if (visitorToken) body.visitor_token = visitorToken;
  return body;
}

export class ApiClient extends HttpClient {
  // --- outbound WhatsApp messages ------------------------------------

  failedMessages({ environment = "live", since = null, until = null, errorCode = null, errorContains = null, before = null } = {}) {
    return this.get("/messages", {
      environment, since, until, error_code: errorCode, error_contains: errorContains, before
    });
  }

  // --- deploy ---------------------------------------------------------

  deployStatus() {
    return this.get("/status");
  }

  // --- whatsapp -------------------------------------------------------

  getWhatsapp() {
    return this.get("/whatsapp");
  }

  setWhatsappLive(active) {
    return this.patch("/whatsapp/live", { active });
  }

  // pin: the number's two-step verification PIN, to register it again.
  checkWhatsapp(pin = null) {
    return this.post("/whatsapp/health_check", pin ? { pin } : {});
  }

  disconnectWhatsapp() {
    return this.delete("/whatsapp");
  }

  inviteWhatsappConnector(body) {
    return this.post("/whatsapp/invite", body);
  }

  whatsappTeam() {
    return this.get("/whatsapp/team");
  }

  syncTemplates() {
    return this.post("/templates/sync", {});
  }

  deployedManifest({ environment = "live" } = {}) {
    return this.get("/manifest", { environment });
  }

  // Validation without deploying: send the directory, get back the manifest it
  // builds, its errors and warnings, and the diff against `environment`. A
  // workspace that fails to validate is a normal 200 with ok:false -- only a
  // bundle the platform cannot read at all raises.
  check({ files, environment = null }) {
    const body = { files };
    if (environment) body.environment = environment;
    return this.post("/check", body);
  }

  // `baseDeploymentId`: the deployment the files were last made to match. The
  // platform refuses the push (409 preview_edited_outside) while preview holds
  // edits made outside the files since then, or any at all without one,
  // unless `force`.
  pushPreview({
    manifest,
    gitSha = null,
    gitBranch = null,
    gitDirty = null,
    createdBy = null,
    environment = null,
    force = false,
    baseDeploymentId = null
  }) {
    const body = { manifest };
    if (gitSha) body.git_sha = gitSha;
    if (gitBranch) body.git_branch = gitBranch;
    if (typeof gitDirty === "boolean") body.git_dirty = gitDirty;
    if (createdBy) body.created_by = createdBy;
    if (environment) body.environment = environment;
    if (force) body.force = true;
    if (Number.isInteger(baseDeploymentId)) body.base_deployment_id = baseDeploymentId;
    return this.put("/push", body);
  }

  publish({ createdBy = null, environment = null, force = false } = {}) {
    const body = {};
    if (createdBy) body.created_by = createdBy;
    if (environment) body.environment = environment;
    if (force) body.force = true;
    return this.post("/publish", body);
  }

  rollback({ createdBy = null } = {}) {
    const body = {};
    if (createdBy) body.created_by = createdBy;
    return this.post("/rollback", body);
  }

  // --- environments ---------------------------------------------------

  environments() {
    return this.get("/env");
  }

  environment(name) {
    return this.get(`/env/${encode(name)}`);
  }

  // --- secrets --------------------------------------------------------

  // Without an environment, the value everywhere; with one, the value only
  // that environment uses instead.
  listSecrets({ environment = null } = {}) {
    return this.get("/secrets", { environment });
  }

  // `tests`: the value every environment but live, and every eval replay,
  // uses instead.
  upsertSecret({ key, value, environment = null, tests = false }) {
    const body = { value };
    if (environment) body.environment = environment;
    if (tests) body.tests = true;
    return this.put(`/secrets/${encode(key)}`, body);
  }

  deleteSecret({ key, environment = null, tests = false }) {
    return this.delete(`/secrets/${encode(key)}${query({ environment, tests: tests ? 1 : null })}`);
  }

  // --- knowledge bases ------------------------------------------------
  //
  // Every read and write below is as one environment sees the base: preview,
  // which keeps its changes on top of live, or `live` itself. Without one the
  // platform means `preview`.

  knowledgeBases({ environment = null } = {}) {
    return this.get("/knowledge_bases", { environment });
  }

  knowledgeBase(name, { environment = null } = {}) {
    return this.get(`/knowledge_bases/${encode(name)}`, { environment });
  }

  createKnowledgeBase(name) {
    return this.post("/knowledge_bases", { name });
  }

  deleteKnowledgeBase(name) {
    return this.delete(`/knowledge_bases/${encode(name)}`);
  }

  knowledgeEntry({ base, name, environment = null, version = null }) {
    return this.get(`/knowledge_bases/${encode(base)}/entries/${encode(name)}`, { environment, version });
  }

  // Put this markdown under this name, whether or not the entry exists yet --
  // one call for "write" and "rewrite", because from the terminal they are the
  // same sentence.
  writeKnowledgeEntry({ base, name, content, environment = null }) {
    const body = { content };
    if (environment) body.environment = environment;
    return this.patch(`/knowledge_bases/${encode(base)}/entries/${encode(name)}`, body);
  }

  deleteKnowledgeEntry({ base, name, environment = null }) {
    return this.delete(`/knowledge_bases/${encode(base)}/entries/${encode(name)}${query({ environment })}`);
  }

  // What the environment changed that live does not have yet.
  knowledgeChanges(base, { environment = null } = {}) {
    return this.get(`/knowledge_bases/${encode(base)}/changes`, { environment });
  }

  publishKnowledgeBase({ base, environment = null }) {
    const body = {};
    if (environment) body.environment = environment;
    return this.post(`/knowledge_bases/${encode(base)}/publish`, body);
  }

  knowledgeHistory(base) {
    return this.get(`/knowledge_bases/${encode(base)}/history`);
  }

  // --- API keys (publishable and secret) -----------------------------

  listApiKeys() {
    return this.get("/api_keys");
  }

  // `scopes` (a secret key's) left null takes the platform's default: every
  // scope but `team`. `confirmation` is { code } or { recovery_code }, which a
  // `team` key needs.
  createApiKey({ kind, environment, label = null, allowedOrigins = [], scopes = null, confirmation = {} }) {
    const body = { kind, environment, ...confirmation };
    if (String(label ?? "").trim() !== "") body.label = String(label).trim();
    if (allowedOrigins.length > 0) body.allowed_origins = allowedOrigins;
    if (Array.isArray(scopes) && scopes.length > 0) body.scopes = scopes;
    return this.post("/api_keys", body);
  }

  setApiKeyOrigins({ prefix, allowedOrigins }) {
    return this.patch(`/api_keys/${encode(prefix)}`, { allowed_origins: allowedOrigins });
  }

  revokeApiKey({ prefix }) {
    return this.delete(`/api_keys/${encode(prefix)}`);
  }

  // --- business -------------------------------------------------------

  // Name and brand: one row for every environment, the same one the inbox
  // edits on the Web chat page.
  business() {
    return this.get("/business");
  }

  // Only the keys given change.
  updateBusiness(fields) {
    return this.patch("/business", fields);
  }

  // --- team -----------------------------------------------------------

  questionSettings() {
    return this.get("/supervisor_questions");
  }

  setQuestionSettings(body) {
    return this.patch("/supervisor_questions", body);
  }

  members() {
    return this.get("/members");
  }

  inviteMember(body) {
    return this.post("/members", body);
  }

  // --- quiet hours ----------------------------------------------------

  // The weekly schedule in which the agent does not answer, or null.
  quietHours() {
    return this.get("/quiet_hours");
  }

  setQuietHours(quietHours) {
    return this.patch("/quiet_hours", { quiet_hours: quietHours });
  }

  // --- templates, webhooks ---------------------------------------------

  listTemplates({ environment }) {
    return this.get("/templates", { environment });
  }

  createTemplate({ name, language, category, body = null, examples = [], footer = null, buttons = [], components = null,
    parameterFormat = null }) {
    if (components) {
      const payload = { name, language, category, components };
      if (parameterFormat) payload.parameter_format = parameterFormat;
      return this.post("/templates", payload);
    }
    const payload = { name, language, category, body, examples };
    if (String(footer ?? "").trim() !== "") payload.footer = String(footer).trim();
    if (buttons.length > 0) payload.buttons = buttons;
    return this.post("/templates", payload);
  }

  deleteTemplate({ name, language = null }) {
    return this.delete(`/templates/${encode(name)}${query({ language })}`);
  }

  listWebhookEndpoints() {
    return this.get("/webhook_endpoints");
  }

  createWebhookEndpoint({ environment, url, events = [], label = null }) {
    const body = { environment, url, events };
    if (String(label ?? "").trim() !== "") body.label = String(label).trim();
    return this.post("/webhook_endpoints", body);
  }

  updateWebhookEndpoint({ id, ...attrs }) {
    return this.patch(`/webhook_endpoints/${encode(id)}`, attrs);
  }

  deleteWebhookEndpoint({ id }) {
    return this.delete(`/webhook_endpoints/${encode(id)}`);
  }

  testWebhookEndpoint({ id }) {
    return this.post(`/webhook_endpoints/${encode(id)}/test`);
  }

  listWebhookDeliveries({ id }) {
    return this.get(`/webhook_endpoints/${encode(id)}/deliveries`);
  }

  // --- contacts -------------------------------------------------------

  exportContact({ id }) {
    return this.get(`/contacts/${encode(id)}/export`);
  }

  deleteContact({ id }) {
    return this.delete(`/contacts/${encode(id)}`);
  }

  // --- chats ----------------------------------------------------------

  // Who is writing: `asPhone` a verified phone (Vatio::Preview::Tester), or
  // `visitorToken` a signed-in visitor, the JWT the workspace signed, which
  // Vatio verifies against the public key in vatio.yml (see
  // lib/visitor-identity.mjs). Left out, the chat is the token holder.
  createChat({ environment, asPhone = null, visitorToken = null }) {
    return this.post("/chats", chatFields({ environment, asPhone, visitorToken }));
  }

  resetChat({ chatId, environment, asPhone = null, visitorToken = null }) {
    return this.post(`/chats/${encode(chatId)}/reset`, chatFields({ environment, asPhone, visitorToken }));
  }

  // A fresh token for a chat that already knows who it is talking to. Answers
  // `identified: false` with a reason when it does not verify, or names someone
  // else.
  identifyChat({ chatId, visitorToken }) {
    return this.post(`/chats/${encode(chatId)}/identify`, { visitor_token: visitorToken });
  }

  // No `view` parameter: the developer token is the developer view, so the
  // API returns one shape and the caller decides how much of it to print.
  showChat({ chatId }) {
    return this.get(`/chats/${encode(chatId)}`);
  }

  chatMessages({ chatId, after = null, limit = null }) {
    const params = {};
    if (after) params.after = after;
    if (limit) params.limit = limit;
    return this.get(`/chats/${encode(chatId)}/messages`, params);
  }

  // `files` are `{ name, bytes }`, sent as the public API takes a visitor's
  // (multipart `files[]`), so the agent reads them as it would on the web.
  sendChatMessage({ chatId, content, files = [] }) {
    if (files.length === 0) return this.post(`/chats/${encode(chatId)}/messages`, { content });

    const form = new FormData();
    if (content) form.set("content", content);
    for (const file of files) form.append("files[]", new Blob([file.bytes]), file.name);
    return this.post(`/chats/${encode(chatId)}/messages`, form);
  }

  exportChats({ from, to = null, environment = null, channel = null, after = null }) {
    const params = { from };
    if (to) params.to = to;
    if (environment) params.environment = environment;
    if (channel) params.channel = channel;
    if (after) params.after = after;
    return this.get("/chats/export", params);
  }

}

// /api/developer/v1/workspaces -- not workspace-scoped, so it takes the bare host.
export class CliClient extends HttpClient {
  listWorkspaces() {
    return this.get("/api/developer/v1/workspaces");
  }

  createWorkspace({ slug, name = null, organization = null }) {
    const body = { slug };
    if (String(name ?? "").trim() !== "") body.name = String(name).trim();
    if (String(organization ?? "").trim() !== "") body.organization = String(organization).trim().toLowerCase();
    return this.post("/api/developer/v1/workspaces", body);
  }

  async workspaceExists(slug) {
    const payload = await this.listWorkspaces();
    const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    return workspaces.some((workspace) => String(workspace.slug) === String(slug));
  }
}

// A DELETE carries no body, so what it needs beyond the path rides as a query.
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
