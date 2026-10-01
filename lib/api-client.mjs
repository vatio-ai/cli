// Everything the CLI can ask of one workspace: /api/v1/:slug/*.
//
// One class rather than a client per surface. They share a host, a token and an
// error contract, and splitting them only ever meant passing the same three
// things around four times.

import { HttpClient } from "./http.mjs";

const encode = (value) => encodeURIComponent(String(value));

export class ApiClient extends HttpClient {
  // --- deploy ---------------------------------------------------------

  deployStatus() {
    return this.get("/deploy/status");
  }

  deployedManifest({ environment = "live" } = {}) {
    return this.get("/deploy/manifest", { environment });
  }

  // Validation without deploying: send the directory, get back the manifest it
  // builds, its errors and warnings, and the diff against `environment`. A
  // workspace that fails to validate is a normal 200 with ok:false -- only a
  // bundle the platform cannot read at all raises.
  check({ files, environment = null }) {
    const body = { files };
    if (environment) body.environment = environment;
    return this.post("/deploy/check", body);
  }

  pushPreview({ manifest, gitSha = null, gitBranch = null, createdBy = null, environment = null }) {
    const body = { manifest };
    if (gitSha) body.git_sha = gitSha;
    if (gitBranch) body.git_branch = gitBranch;
    if (createdBy) body.created_by = createdBy;
    if (environment) body.environment = environment;
    return this.put("/deploy/preview", body);
  }

  publish({ createdBy = null, environment = null } = {}) {
    const body = {};
    if (createdBy) body.created_by = createdBy;
    if (environment) body.environment = environment;
    return this.post("/deploy/publish", body);
  }

  rollback({ createdBy = null } = {}) {
    const body = {};
    if (createdBy) body.created_by = createdBy;
    return this.post("/deploy/rollback", body);
  }

  revisions() {
    return this.get("/deploy/revisions");
  }

  revision(id) {
    return this.get(`/deploy/revisions/${encode(id)}`);
  }

  // --- environments ---------------------------------------------------

  environments() {
    return this.get("/deploy/environments");
  }

  environment(name) {
    return this.get(`/deploy/environments/${encode(name)}`);
  }

  deleteEnvironment(name) {
    return this.delete(`/deploy/environments/${encode(name)}`);
  }

  // --- secrets --------------------------------------------------------

  // Without an environment, the value everywhere; with one, the value only
  // that environment uses instead.
  listSecrets({ environment = null } = {}) {
    return this.get("/deploy/secrets", { environment });
  }

  upsertSecret({ key, value, environment = null }) {
    const body = { value };
    if (environment) body.environment = environment;
    return this.put(`/deploy/secrets/${encode(key)}`, body);
  }

  deleteSecret({ key, environment = null }) {
    return this.delete(`/deploy/secrets/${encode(key)}${query({ environment })}`);
  }

  // --- knowledge bases ------------------------------------------------
  //
  // A base holds entries (markdown) and reads sites (a URL or a pattern). Two
  // nouns, and every call below is one of them.

  // Every read and write below is as one environment sees the base: a
  // branch's, which keeps its changes on top of live, or `live` itself.
  // Without one the platform means `preview`.

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

  refreshKnowledgeBase(name) {
    return this.post(`/knowledge_bases/${encode(name)}/refresh`, {});
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

  followKnowledgeSite({ base, url }) {
    return this.post(`/knowledge_bases/${encode(base)}/sites`, { url });
  }

  // Addressed by the URL you typed rather than by an id you would have to look
  // up first. It travels as a query parameter because a URL does not survive
  // being a path segment.
  unfollowKnowledgeSite({ base, url }) {
    return this.delete(`/knowledge_bases/${encode(base)}/sites?url=${encode(url)}`);
  }

  refreshKnowledgeSite({ base, url }) {
    return this.post(`/knowledge_bases/${encode(base)}/sites/refresh`, { url });
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

  // --- publishable tokens and the widget ------------------------------

  listPublishableTokens() {
    return this.get("/publishable_tokens");
  }

  createPublishableToken({ environment, label = null, allowedOrigins = [] }) {
    const body = { environment };
    if (String(label ?? "").trim() !== "") body.label = String(label).trim();
    if (allowedOrigins.length > 0) body.allowed_origins = allowedOrigins;
    return this.post("/publishable_tokens", body);
  }

  setPublishableTokenOrigins({ prefix, allowedOrigins }) {
    return this.patch(`/publishable_tokens/${encode(prefix)}`, { allowed_origins: allowedOrigins });
  }

  revokePublishableToken({ prefix }) {
    return this.delete(`/publishable_tokens/${encode(prefix)}`);
  }

  widget() {
    return this.get("/widget");
  }

  // --- the shared WhatsApp preview ------------------------------------

  listTestPhoneNumbers() {
    return this.get("/test_phone_numbers");
  }

  addTestPhoneNumber({ phoneNumber, environment = null }) {
    const body = { phone_number: phoneNumber };
    if (environment) body.environment = environment;
    return this.post("/test_phone_numbers", body);
  }

  // Which environment the phone reaches on the shared number.
  pointTestPhoneNumber({ phoneNumber, environment }) {
    return this.patch(`/test_phone_numbers/${waId(phoneNumber)}`, { environment });
  }

  verifyTestPhoneNumber({ phoneNumber, code }) {
    return this.post(`/test_phone_numbers/${waId(phoneNumber)}/verify`, { code });
  }

  resendTestPhoneNumberCode({ phoneNumber }) {
    return this.post(`/test_phone_numbers/${waId(phoneNumber)}/resend`, {});
  }

  removeTestPhoneNumber({ phoneNumber }) {
    return this.delete(`/test_phone_numbers/${waId(phoneNumber)}`);
  }

  // --- the workspace's own WhatsApp number ----------------------------

  whatsappAccount() {
    return this.get("/whatsapp_account");
  }

  // Mints the URL for Meta's Embedded Signup and returns it; it connects
  // nothing on its own. Same shape as instagramConnectLink.
  whatsappConnectLink() {
    return this.post("/whatsapp_account", {});
  }

  checkWhatsappAccount() {
    return this.post("/whatsapp_account/check", {});
  }

  activateWhatsappAccount() {
    return this.post("/whatsapp_account/activate", {});
  }

  deactivateWhatsappAccount() {
    return this.post("/whatsapp_account/deactivate", {});
  }

  disconnectWhatsappAccount() {
    return this.delete("/whatsapp_account");
  }

  // --- Instagram ------------------------------------------------------

  instagramAccount() {
    return this.get("/instagram_account");
  }

  instagramConnectLink() {
    return this.post("/instagram_account", {});
  }

  checkInstagramAccount() {
    return this.post("/instagram_account/check", {});
  }

  disconnectInstagramAccount() {
    return this.delete("/instagram_account");
  }

  listTestInstagramAccounts() {
    return this.get("/test_instagram_accounts");
  }

  // Declares which Instagram account you mean. The code comes later, by DM,
  // once that account writes to the shared preview -- Instagram will not let
  // Vatio message an account that has not messaged it first.
  addTestInstagramAccount({ username, environment = null }) {
    const body = { username };
    if (environment) body.environment = environment;
    return this.post("/test_instagram_accounts", body);
  }

  // Which environment the account reaches on the shared one.
  pointTestInstagramAccount({ id, environment }) {
    return this.patch(`/test_instagram_accounts/${encode(id)}`, { environment });
  }

  // Addressed by the code alone: the workspace is already in the path and the
  // code is the only value the developer has in hand.
  verifyTestInstagramAccount({ code }) {
    return this.post("/test_instagram_accounts/verify", { code });
  }

  showTestInstagramAccount(id) {
    return this.get(`/test_instagram_accounts/${encode(id)}`);
  }

  resendTestInstagramAccountCode(id) {
    return this.post(`/test_instagram_accounts/${encode(id)}/resend_otp`, {});
  }

  removeTestInstagramAccount(id) {
    return this.delete(`/test_instagram_accounts/${encode(id)}`);
  }

  // --- chats ----------------------------------------------------------

  createChat({ environment }) {
    return this.post("/chats", { environment });
  }

  resetChat({ chatId, environment }) {
    return this.post(`/chats/${encode(chatId)}/reset`, { environment });
  }

  // No `view` parameter: the developer token is the developer view, so the
  // API returns one shape and the caller decides how much of it to print.
  // `transcript` prints the visitor's half of it; `debug` prints all of it.
  showChat({ chatId }) {
    return this.get(`/chats/${encode(chatId)}`);
  }

  chatMessages({ chatId, after = null, limit = null }) {
    const params = {};
    if (after) params.after = after;
    if (limit) params.limit = limit;
    return this.get(`/chats/${encode(chatId)}/messages`, params);
  }

  sendChatMessage({ chatId, content }) {
    return this.post(`/chats/${encode(chatId)}/messages`, { content });
  }

  destroyChat({ chatId }) {
    return this.delete(`/chats/${encode(chatId)}`);
  }
}

// /cli/* -- not workspace-scoped, so it takes the bare host.
export class CliClient extends HttpClient {
  listWorkspaces() {
    return this.get("/cli/workspaces");
  }

  createWorkspace({ slug, name = null }) {
    const body = { slug };
    if (String(name ?? "").trim() !== "") body.name = String(name).trim();
    return this.post("/cli/workspaces", body);
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

// The path carries the digits: "+" and spaces do not survive a URL, and the
// digits are what the API stores as `wa_id`.
function waId(phoneNumber) {
  return String(phoneNumber ?? "").replace(/\D/g, "");
}
