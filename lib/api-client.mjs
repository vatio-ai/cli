// Everything the CLI can ask of one workspace: /api/developer/v1/:slug/*.
//
// One class rather than a client per surface. They share a host, a token and an
// error contract, and splitting them only ever meant passing the same three
// things around four times.

import { HttpClient } from "./http.mjs";

const encode = (value) => encodeURIComponent(String(value));

export class ApiClient extends HttpClient {
  // --- deploy ---------------------------------------------------------

  deployStatus() {
    return this.get("/status");
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

  pushPreview({ manifest, gitSha = null, gitBranch = null, createdBy = null, environment = null }) {
    const body = { manifest };
    if (gitSha) body.git_sha = gitSha;
    if (gitBranch) body.git_branch = gitBranch;
    if (createdBy) body.created_by = createdBy;
    if (environment) body.environment = environment;
    return this.put("/push", body);
  }

  publish({ createdBy = null, environment = null } = {}) {
    const body = {};
    if (createdBy) body.created_by = createdBy;
    if (environment) body.environment = environment;
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

  deleteEnvironment(name) {
    return this.delete(`/env/${encode(name)}`);
  }

  // --- secrets --------------------------------------------------------

  // Without an environment, the value everywhere; with one, the value only
  // that environment uses instead.
  listSecrets({ environment = null } = {}) {
    return this.get("/secrets", { environment });
  }

  upsertSecret({ key, value, environment = null }) {
    const body = { value };
    if (environment) body.environment = environment;
    return this.put(`/secrets/${encode(key)}`, body);
  }

  deleteSecret({ key, environment = null }) {
    return this.delete(`/secrets/${encode(key)}${query({ environment })}`);
  }

  // --- knowledge bases ------------------------------------------------
  //
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

  // --- publishable tokens ------------------------------------------

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

  // --- chats ----------------------------------------------------------

  createChat({ environment }) {
    return this.post("/chats", { environment });
  }

  resetChat({ chatId, environment }) {
    return this.post(`/chats/${encode(chatId)}/reset`, { environment });
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

  sendChatMessage({ chatId, content }) {
    return this.post(`/chats/${encode(chatId)}/messages`, { content });
  }

}

// /api/developer/v1/workspaces -- not workspace-scoped, so it takes the bare host.
export class CliClient extends HttpClient {
  listWorkspaces() {
    return this.get("/api/developer/v1/workspaces");
  }

  createWorkspace({ slug, name = null }) {
    const body = { slug };
    if (String(name ?? "").trim() !== "") body.name = String(name).trim();
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
