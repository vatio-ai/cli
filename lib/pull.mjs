// `vatio pull`: a deployed agent, written back into the files it came from.
//
// A revision is a manifest, not a directory, and only half of it can be
// written back as it is. A tool keeps its whole file (`source`), byte for
// byte, so tools/KEY.yml is that text. vatio.yml keeps neither its comments
// nor its key order, and the deployed `auth:` holds the key itself where the
// file names a path. So vatio.yml is never regenerated: the file already on
// disk is edited, inside its `agent:` block only, and only at the keys whose
// value changed. Everything else in it -- `workspace:`, `auth:`, every
// comment, a hand-wrapped paragraph nobody edited -- stays byte for byte.
//
// Nothing here writes. planPull reads the directory and says what each file
// would become, so a deployment that cannot be written back fails before any
// file is touched, and the command decides whether to write at all.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Document, Pair, Scalar, YAMLMap, YAMLSeq, isMap, isScalar, isSeq, parseDocument } from "yaml";

import { MANIFEST_FILE } from "./workspace.mjs";

export class PullError extends Error {
  constructor(message) {
    super(message);
    this.name = "PullError";
  }
}

// The order a person reads an agent in (RevisionFiles::AGENT_KEY_ORDER on the
// platform). A key the file does not have yet goes in at its place in it.
const AGENT_KEY_ORDER = ["name", "instructions", "personality", "tools", "knowledge", "links"];
// What the platform drops from `agent:` on the way in, so a deployed agent
// never has them: the file's to keep, not a deletion to mirror.
const LOCAL_ONLY_KEYS = new Set(["key", "hours", "handoff"]);
// On every deployed agent whether the file declared them or not. Written only
// when they say something or the file already has them, so a vatio.yml that
// never mentioned them does not grow `knowledge: []`.
const ALWAYS_DEPLOYED = new Set(["knowledge", "links"]);
// VatioToolSpecParser::KEY_FORMAT. A key is a file name here, so one that
// does not match is never joined to a path.
const TOOL_KEY_FORMAT = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const TOOL_FILE = /^(.+)\.(yml|yaml)$/;
// Where a rewritten `>` paragraph wraps, counting its indentation.
const FOLD_WIDTH = 80;

// [{ path, action: "created" | "changed" | "deleted", content }], one per file
// that differs from the deployment, paths relative to the workspace root.
export function planPull(root, manifest) {
  const changes = [];
  const before = readFileSync(join(root, MANIFEST_FILE), "utf8");
  const after = mergeAgent(before, deployedAgent(manifest));
  if (after !== before) changes.push({ path: MANIFEST_FILE, action: "changed", content: after });
  return changes.concat(planTools(root, manifest?.tools));
}

// The workspace's one agent, whatever slug an older revision stored it under.
function deployedAgent(manifest) {
  const agents = manifest?.agents;
  if (isPlainObject(agents)) {
    const slug = Object.hasOwn(agents, "main") ? "main" : Object.keys(agents).sort()[0];
    if (isPlainObject(agents[slug])) return agents[slug];
  }
  throw new PullError("the deployment has no agent to write back");
}

function planTools(root, tools) {
  if (tools != null && !Array.isArray(tools)) throw new PullError("the deployment's tools are not a list");

  const local = localToolFiles(join(root, "tools"));
  const deployed = new Set();
  const changes = [];

  for (const tool of tools ?? []) {
    const key = String(tool?.key ?? "");
    if (!TOOL_KEY_FORMAT.test(key)) {
      throw new PullError(`the deployment has a tool named ${JSON.stringify(key)}, which is not a tool file name`);
    }
    if (deployed.has(key)) throw new PullError(`the deployment lists tool ${key} twice`);
    if (typeof tool.source !== "string") {
      throw new PullError(`the deployment does not hold the file of tool ${key}, so it cannot be written back`);
    }
    deployed.add(key);

    // tools/KEY.yaml stays .yaml: renaming it would be a change nobody made.
    const names = local.get(key) ?? [];
    const name = names.length > 0 && !names.includes(`${key}.yml`) ? names[0] : `${key}.yml`;
    const path = `tools/${name}`;
    const current = names.includes(name) ? readFileSync(join(root, path), "utf8") : null;
    if (current === tool.source) continue;
    changes.push({ path, action: current === null ? "created" : "changed", content: tool.source });
  }

  for (const [key, names] of local) {
    if (deployed.has(key)) continue;
    for (const name of names) changes.push({ path: `tools/${name}`, action: "deleted" });
  }
  return changes;
}

// key -> its file names in tools/: what the platform reads as tools
// (tools/*.{yml,yaml}), and nothing else in the directory.
function localToolFiles(dir) {
  const files = new Map();
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const match = TOOL_FILE.exec(entry.name);
    if (!entry.isFile() || entry.name.startsWith(".") || !match) continue;
    files.set(match[1], [...(files.get(match[1]) ?? []), entry.name].sort());
  }
  return files;
}

// vatio.yml's text with its `agent:` block saying what `agent` says. The same
// text, unchanged, when it already does.
export function mergeAgent(source, agent) {
  const doc = parseDocument(source);
  if (doc.errors.length > 0) throw new PullError(`${MANIFEST_FILE}: ${doc.errors[0].message}`);
  if (!isMap(doc.contents)) throw new PullError(`${MANIFEST_FILE} must be a mapping`);

  const local = doc.toJS()?.agent;
  const plan = agentPlan(isPlainObject(local) ? local : {}, agent);
  if (plan.set.size === 0 && plan.remove.length === 0 && isPlainObject(local)) return source;

  // Edited in place first. If that ever reads back as anything but the
  // intended agent, yaml writes the whole agent block instead, and then the
  // whole file: comments survive both, though a hand-wrapped `>` paragraph is
  // wrapped again.
  for (const write of [spliced, rewrittenAgent, rewritten]) {
    let text = null;
    try {
      text = write(source, plan);
    } catch {
      text = null;
    }
    if (text !== null && says(text, source, plan.expected)) return text;
  }
  throw new PullError(`could not rewrite the agent: block of ${MANIFEST_FILE} safely; it is unchanged`);
}

// Which keys of the file's agent change, which go, and the agent it should
// read as afterwards.
function agentPlan(local, server) {
  const order = [
    ...AGENT_KEY_ORDER.filter((key) => Object.hasOwn(server, key)),
    ...Object.keys(server).filter((key) => !AGENT_KEY_ORDER.includes(key) && key !== "key")
  ];
  const set = new Map();
  for (const key of order) {
    const has = Object.hasOwn(local, key);
    const value = presented(key, server[key], has ? local[key] : undefined);
    if (!has && ALWAYS_DEPLOYED.has(key) && isEmpty(value)) continue;
    if (has && isDeepStrictEqual(value, local[key])) continue;
    set.set(key, value);
  }
  const remove = Object.keys(local).filter((key) => !Object.hasOwn(server, key) && !LOCAL_ONLY_KEYS.has(key));

  const expected = { ...local };
  for (const key of remove) delete expected[key];
  for (const [key, value] of set) expected[key] = value;
  return { order, set, remove, expected };
}

// The deployed value in the form the file already says it, when the two mean
// the same: the platform stores `knowledge: docs` as ["docs"], and a bare url
// under `links:` as { url }.
function presented(key, value, mine) {
  if (key === "knowledge" && mine !== undefined && isDeepStrictEqual(knowledgeNames(mine), value)) return mine;
  if (key === "links" && isPlainObject(value)) {
    const links = {};
    for (const [name, entry] of Object.entries(value)) {
      const own = isPlainObject(mine) ? mine[name] : undefined;
      links[name] = own !== undefined && isDeepStrictEqual(linkEntry(own), linkEntry(entry)) ? own : compactLink(entry);
    }
    return links;
  }
  return value;
}

// VatioManifestDirectory.knowledge_names_from.
function knowledgeNames(raw) {
  if (raw == null) return [];
  const names = (Array.isArray(raw) ? raw : [raw]).map((name) => String(name ?? "").trim()).filter(Boolean);
  return [...new Set(names)];
}

// VatioManifestDirectory.link_entry, without its validation.
function linkEntry(raw) {
  const row = typeof raw === "string" ? { url: raw } : raw;
  if (!isPlainObject(row)) return raw;
  const entry = { url: String(row.url ?? "").trim() };
  const when = String(row.when ?? "").trim();
  if (when !== "") entry.when = when;
  if (isPlainObject(row.values) && Object.keys(row.values).length > 0) entry.values = row.values;
  return entry;
}

// A link that is only a url is written as one, the way people write it.
function compactLink(entry) {
  return isPlainObject(entry) && Object.keys(entry).length === 1 && typeof entry.url === "string" ? entry.url : entry;
}

// The source with every changed key's lines replaced, a removed key's lines
// (and the comment right above it) taken out, and a new key's lines put in
// after the key that comes before it -- and not one other byte moved. Null
// when the file is laid out in a way this cannot edit line by line.
function spliced(source, plan) {
  const doc = parseDocument(source);
  const lines = new Lines(source);
  const pair = doc.contents.items.find((item) => keyOf(item) === "agent");
  if (!pair || !isMap(pair.value) || pair.value.flow || pair.value.items.length === 0) {
    return wholeAgent(source, doc, lines, pair, plan);
  }

  // Each key's lines, and where the key before it ends: a comment above a
  // removed key goes with it, but never one inside the value before.
  const regions = new Map();
  let floor = lines.at(pair.key.range[0]);
  for (const item of pair.value.items) {
    const key = keyOf(item);
    const region = lines.region(item);
    if (key === null || !region) return null;
    regions.set(key, { ...region, floor });
    floor = region.last;
  }
  const column = [...regions.values()][0].column;
  if (column === 0 || [...regions.values()].some((region) => region.column !== column)) return null;
  const style = {
    column,
    indent: column,
    indentSeq: seqIndented(pair.value, lines, column),
    padFlow: flowPadding(source),
    eol: lines.eol,
    doc
  };

  const edits = [];
  for (const key of plan.remove) {
    const region = regions.get(key);
    edits.push({ from: lines.start(lines.commentsAbove(region, column)), to: lines.end(region.last), text: "" });
  }
  for (const [key, value] of plan.set) {
    const region = regions.get(key);
    if (region) {
      edits.push({
        from: lines.start(region.first),
        to: lines.end(region.last),
        text: renderPair(key, value, region.pair.value, { ...style, old: { lines, region } })
      });
      continue;
    }
    const at = insertionPoint(key, plan, regions, lines, column);
    edits.push({ from: at, to: at, text: renderPair(key, value, null, style) });
  }
  return applyEdits(source, edits, lines.eol);
}

// After the closest key before this one in reading order that the file keeps;
// before the first key when there is none.
function insertionPoint(key, plan, regions, lines, column) {
  const before = plan.order.slice(0, plan.order.indexOf(key)).reverse();
  for (const anchor of before) {
    if (regions.has(anchor) && !plan.remove.includes(anchor)) return lines.end(regions.get(anchor).last);
  }
  return lines.start(lines.commentsAbove([...regions.values()][0], column));
}

// A file with no `agent:` block, or one that is not an indented mapping (`agent:
// {name: x}`, a bare `agent:`), gets the whole block written out.
function wholeAgent(source, doc, lines, pair, plan) {
  const agent = orderedAgent(plan);
  const style = { column: 0, indent: 2, indentSeq: true, padFlow: flowPadding(source), eol: lines.eol, doc };
  const text = renderPair("agent", agent, pair?.value ?? null, style, { block: true });
  if (pair) {
    const region = lines.region(pair);
    if (!region || region.column !== 0) return null;
    return applyEdits(source, [{ from: lines.start(region.first), to: lines.end(region.last), text }], lines.eol);
  }
  const workspace = doc.contents.items.find((item) => keyOf(item) === "workspace");
  const region = workspace && lines.region(workspace);
  const at = region && region.column === 0 ? lines.end(region.last) : source.length;
  return applyEdits(source, [{ from: at, to: at, text: `${lines.eol}${text}` }], lines.eol);
}

function orderedAgent(plan) {
  const agent = {};
  for (const key of plan.order) if (Object.hasOwn(plan.expected, key)) agent[key] = plan.expected[key];
  for (const [key, value] of Object.entries(plan.expected)) if (!Object.hasOwn(agent, key)) agent[key] = value;
  return agent;
}

// The fallback: the same changes made to the parsed document, and yaml writing
// all of it back out.
function rewritten(source, plan) {
  const doc = parseDocument(source);
  const pair = doc.contents.items.find((item) => keyOf(item) === "agent");
  if (!pair || !isMap(pair.value)) {
    const node = updateNode(pair?.value ?? null, orderedAgent(plan), doc);
    if (isMap(node)) node.flow = false;
    if (pair) pair.value = node;
    else doc.contents.items.push(new Pair(new Scalar("agent"), node));
  } else {
    const map = pair.value;
    map.items = map.items.filter((item) => !plan.remove.includes(keyOf(item)));
    for (const [key, value] of plan.set) {
      const item = map.items.find((candidate) => keyOf(candidate) === key);
      if (item) item.value = updateNode(item.value, value, doc);
      else map.items.push(new Pair(new Scalar(key), fresh(value)));
    }
  }
  const text = doc.toString({ flowCollectionPadding: flowPadding(source) });
  return source.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
}

// That rewrite's `agent:` block in place of the file's, so what is outside it
// still does not move.
function rewrittenAgent(source, plan) {
  const text = rewritten(source, plan);
  const regionIn = (body) => {
    const pair = parseDocument(body).contents?.items?.find((item) => keyOf(item) === "agent");
    const lines = new Lines(body);
    const region = pair && lines.region(pair);
    return region && region.column === 0 ? { from: lines.start(region.first), to: lines.end(region.last) } : null;
  };
  const was = regionIn(source);
  const now = regionIn(text);
  if (!was || !now) return null;
  return applyEdits(source, [{ from: was.from, to: was.to, text: text.slice(now.from, now.to) }], new Lines(source).eol);
}

// Whether `text` reads as the original file with only its agent changed, and
// changed into `expected`.
function says(text, source, expected) {
  const after = parseDocument(text);
  if (after.errors.length > 0) return false;
  const now = after.toJS();
  const was = parseDocument(source).toJS();
  if (!isPlainObject(now) || !isDeepStrictEqual(now.agent, expected)) return false;
  const rest = (data) => Object.entries(data).filter(([key]) => key !== "agent");
  return isDeepStrictEqual(rest(now), rest(was));
}

// `key: value` as the lines that go into the file at `column`, in the file's
// own indentation. The node it was is reused where the value did not change,
// so what is left of it keeps its comments and its style.
function renderPair(key, value, old, style, { block = false } = {}) {
  const node = updateNode(old, value, style.doc);
  if (block && isMap(node)) node.flow = false;
  // Without indentSeq yaml counts the `- ` as two columns of the indentation,
  // so a list written flush under its key needs a step of exactly two.
  const flush = isSeq(node) && !node.flow && !style.indentSeq;
  const indent = flush ? 2 : (nestedIndent(old, style) ?? style.indent);
  const folded = isScalar(node) && node.type === Scalar.BLOCK_FOLDED;

  const map = new YAMLMap();
  map.items.push(new Pair(new Scalar(key), node));
  const mini = new Document();
  mini.contents = map;
  let rendered = mini
    .toString({
      indent,
      indentSeq: style.indentSeq,
      flowCollectionPadding: style.padFlow,
      lineWidth: folded ? Math.max(FOLD_WIDTH - style.column, 40) : 0
    })
    .replace(/\n$/, "")
    .split("\n");
  if (folded && style.old && isScalar(old) && old.type === Scalar.BLOCK_FOLDED) {
    rendered = keepParagraphs(rendered, node.value, style.old, style.column, indent);
  }
  const pad = " ".repeat(style.column);
  return rendered.map((line) => (line === "" ? "" : `${pad}${line}`)).join(style.eol) + style.eol;
}

// How far the old value's own lines were indented past its key, so a
// rewritten block lines up with what the file did.
function nestedIndent(old, style) {
  if (!style.old || !old?.range || (isSeq(old) && !style.indentSeq)) return null;
  const { lines, region } = style.old;
  // A block scalar's first line is its header; its body starts below.
  for (let line = lines.at(old.range[0]) + (isScalar(old) ? 1 : 0); line <= region.last; line += 1) {
    if (lines.blank(line) || line === region.first) continue;
    const step = indentOf(lines.line(line)) - style.column;
    return step > 0 ? step : null;
  }
  return null;
}

// A rewritten `>` scalar wraps every paragraph again, so an edit to one
// sentence would show as the whole instructions changing. A paragraph whose
// text did not change gets the file's own lines back instead.
//
// `rendered` is relative to the key's column, its body `indent` deep; the
// file's lines are where they are, `column` further in.
function keepParagraphs(rendered, value, { lines, region }, column, indent) {
  const header = rendered[0];
  if (!/: >[-+]?$/.test(header)) return rendered;
  const pieces = value.replace(/\n+$/, "").split("\n");
  const groups = paragraphs(rendered.slice(1), indent);
  if (!groups || groups.length !== pieces.length || groups.some((group, i) => fold(group) !== pieces[i])) return rendered;

  const body = [];
  for (let line = region.first + 1; line <= region.last; line += 1) body.push(lines.line(line));
  const kept = new Map();
  for (const group of paragraphs(body, column + indent) ?? []) {
    kept.set(fold(group), group.map((line) => line.slice(column)));
  }
  return [header, ...groups.flatMap((group, i) => [...(i > 0 ? [""] : []), ...(kept.get(pieces[i]) ?? group)])];
}

// Lines split at single blank lines into paragraphs, each a run of plain text
// lines at exactly `column`: anything else (a more-indented line, trailing
// space, two blank lines in a row) is null, because folding it is not simply
// joining with spaces.
function paragraphs(body, column) {
  const groups = [[]];
  for (const line of body) {
    if (line === "" || line.trim() === "") {
      if (groups.at(-1).length === 0) return null;
      groups.push([]);
      continue;
    }
    if (indentOf(line) !== column || /\s$/.test(line) || line.includes("\t")) return null;
    groups.at(-1).push(line);
  }
  if (groups.at(-1).length === 0) return null;
  return groups;
}

function fold(group) {
  return group.map((line) => line.trim()).join(" ");
}

// The value as a node, reusing `old` and whatever inside it is unchanged.
function updateNode(old, value, doc) {
  if (Array.isArray(value)) {
    if (!isSeq(old)) return fresh(value);
    const pool = [...old.items];
    old.items = value.map((item) => {
      const index = pool.findIndex((node) => isDeepStrictEqual(jsOf(node, doc), item));
      return index === -1 ? fresh(item) : pool.splice(index, 1)[0];
    });
    return old;
  }
  if (isPlainObject(value)) {
    if (!isMap(old) || old.items.some((item) => keyOf(item) === null || keyOf(item) === "<<")) return fresh(value);
    const kept = old.items.filter((item) => Object.hasOwn(value, keyOf(item)));
    for (const item of kept) item.value = updateNode(item.value, value[keyOf(item)], doc);
    const added = Object.keys(value)
      .filter((key) => !kept.some((item) => keyOf(item) === key))
      .map((key) => new Pair(new Scalar(key), fresh(value[key])));
    old.items = [...kept, ...added];
    return old;
  }

  if (isScalar(old) && isDeepStrictEqual(old.value, value)) return old;
  const node = new Scalar(value);
  if (typeof value === "string" && value !== "") {
    const was = isScalar(old) && typeof old.value === "string" ? old.type : null;
    if (was === Scalar.BLOCK_LITERAL || was === Scalar.BLOCK_FOLDED) node.type = was;
    else if (value.includes("\n")) node.type = Scalar.BLOCK_LITERAL;
    else if (was) node.type = was;
  }
  if (isScalar(old) && old.comment) node.comment = old.comment;
  return node;
}

// A node for a value the file never had: a multi-line string as a `|` block,
// never as one long quoted line.
function fresh(value) {
  if (Array.isArray(value)) {
    const seq = new YAMLSeq();
    seq.items = value.map(fresh);
    return seq;
  }
  if (isPlainObject(value)) {
    const map = new YAMLMap();
    map.items = Object.entries(value).map(([key, item]) => new Pair(new Scalar(key), fresh(item)));
    return map;
  }
  const node = new Scalar(value);
  if (typeof value === "string" && value.includes("\n")) node.type = Scalar.BLOCK_LITERAL;
  return node;
}

// Whether a block list under a key is indented past it (`tools:\n  - a`), the
// way this file writes it. yaml's default when the agent has no block list.
function seqIndented(map, lines, column) {
  for (const item of map.items) {
    const seq = item.value;
    if (!isSeq(seq) || seq.flow || seq.items.length === 0 || !seq.range) continue;
    return seq.range[0] - lines.start(lines.at(seq.range[0])) > column;
  }
  return true;
}

// `[ a, b ]` or `[a, b]`, whichever the file writes; the second when it has
// no flow collection to go by.
function flowPadding(source) {
  return /[[{] [^\s\]}]/.test(source);
}

function applyEdits(source, edits, eol) {
  let text = "";
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    if (edit.from < cursor && edit.to > edit.from) return null;
    const gap = source.slice(cursor, edit.from);
    text += gap;
    // A file whose last line has no newline still ends that line before
    // anything is added after it.
    if (edit.text !== "" && edit.from === source.length && !(text === "" || text.endsWith("\n"))) text += eol;
    text += edit.text;
    cursor = Math.max(cursor, edit.to);
  }
  return text + source.slice(cursor);
}

// The source as lines, for edits that never split one.
class Lines {
  constructor(text) {
    this.text = text;
    this.eol = text.includes("\r\n") ? "\r\n" : "\n";
    this.starts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") this.starts.push(i + 1);
  }

  at(offset) {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  start(line) {
    return this.starts[line];
  }

  // Just past the line's newline.
  end(line) {
    return line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length;
  }

  line(line) {
    return this.text.slice(this.start(line), this.end(line)).replace(/\r?\n$/, "");
  }

  blank(line) {
    return this.line(line).trim() === "";
  }

  // The lines a key and its value take, from the key's line to the value's
  // last, blank lines after it left out: those separate it from the next key.
  // Null when the key does not start its line.
  region(pair) {
    if (!pair.key?.range) return null;
    const keyStart = pair.key.range[0];
    const first = this.at(keyStart);
    if (this.text.slice(this.start(first), keyStart).trim() !== "") return null;
    const end = Math.max(pair.key.range[1], pair.value?.range?.[1] ?? 0);
    let last = this.at(Math.max(end - 1, keyStart));
    while (last > first && this.blank(last)) last -= 1;
    return { first, last, column: keyStart - this.start(first), pair };
  }

  // The first of the comment lines right above a key's region, indented as
  // the key is and below its `floor` line: what goes with the key when it is
  // removed. One indented further is about the value before it.
  commentsAbove({ first: line, floor }, column) {
    let first = line;
    while (first - 1 > floor) {
      const text = this.line(first - 1);
      if (!/^\s*#/.test(text) || indentOf(text) !== column) break;
      first -= 1;
    }
    return first;
  }
}

function keyOf(pair) {
  return isScalar(pair?.key) ? String(pair.key.value) : null;
}

function jsOf(node, doc) {
  return node == null ? null : node.toJS(doc);
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
