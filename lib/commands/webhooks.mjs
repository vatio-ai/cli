// `vatio templates` / `vatio webhooks` — what a developer sets up so their
// backend can send WhatsApp messages through the server API: the templates
// the number can send and new ones for Meta to approve, and where Vatio
// reports what happened. Sending itself is the backend's job, with a server
// key, not the CLI's.

import { deployClient } from "./deploy.mjs";
import { fail, paint, sleep, takeEnv, takeFlag, takeValue } from "../support.mjs";

const WAIT_INTERVAL_MS = 2_000;

// Repeatable: `--event message.sent --event message.replied`.
function takeAll(args, name) {
  const values = [];
  for (let value = takeValue(args, name); value !== null; value = takeValue(args, name)) values.push(value);
  return values;
}

const LIST_USAGE = "vatio templates list [--env live] [--json]";
const CREATE_USAGE = "vatio templates create NAME --language CODE --body TEXT [--example VALUE]... " +
  "[--category utility|marketing] [--footer TEXT] [--json]";

export async function templates(config, args) {
  const json = takeFlag(args, "--json");
  if (args[0] === "create") {
    args.shift();
    return createTemplate(config, args, json);
  }
  const environment = takeEnv(args, { fallback: "live", cwd: config.workspaceRoot });
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";
  if (sub !== "list") fail(`Usage: ${LIST_USAGE}\n       ${CREATE_USAGE}`);

  const payload = await client.listTemplates({ environment });
  const list = Array.isArray(payload.templates) ? payload.templates : [];
  if (json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  const live = environment === "live";
  if (list.length === 0) {
    if (live && payload.whatsapp_connected === false) {
      console.log("This workspace has no WhatsApp number of its own yet. The templates you create stay on Vatio's " +
        "test number until you connect one, and then Vatio moves them to it: vatio templates list --env preview");
    } else if (!live && payload.whatsapp_connected === true) {
      console.log("This workspace has its own WhatsApp number, so its templates are there: vatio templates list");
    } else {
      console.log(`No templates on ${live ? "this workspace's WhatsApp number" : "Vatio's test number for this workspace"} yet. Create one:`);
      console.log('  vatio templates create order_shipped --language es --body "Hi {{1}}, order {{2}} is on its way." ' +
        '--example Ana --example "#1042"');
    }
    return;
  }
  console.log(`Templates on ${live ? "the workspace's number" : "Vatio's test number"} (${list.length}):`);
  for (const template of list) {
    const status = template.status === "APPROVED" ? paint("green", template.status) : paint("cyan", template.status);
    const count = template.parameter_count ?? "?";
    console.log(`  ${template.name} (${template.language})  ${template.category}  ${status}  ${count} param${count === 1 ? "" : "s"}`);
    if (template.body) console.log(`    ${template.body.replace(/\n/g, "\n    ")}`);
    if (template.status === "REJECTED" && template.rejected_reason) console.log(`    ${paint("red", "rejected:")} ${template.rejected_reason}`);
    if (template.status === "APPROVED") console.log(`    "template": ${JSON.stringify(template.example)}`);
  }
}

// On the workspace's own number once it has one, and before that on Vatio's
// test number, where a preview key sends it to the workspace's test phones
// until Vatio moves it to the number the workspace connects. The backend
// decides where, so there is no environment to choose.
async function createTemplate(config, args, json) {
  takeValue(args, "--env");
  const language = takeValue(args, "--language");
  const body = takeValue(args, "--body");
  const category = takeValue(args, "--category") ?? "utility";
  const footer = takeValue(args, "--footer");
  const examples = takeAll(args, "--example");
  const name = args.shift();
  if (!name || !language || !body || args.length > 0) fail(`Usage: ${CREATE_USAGE}`);

  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const template = await client.createTemplate({ name, language, category, body, examples, footer });
  if (json) {
    console.log(JSON.stringify(template, null, 2));
    return;
  }
  const own = template.whatsapp_connected === true;
  const count = template.parameter_count ?? examples.length;
  console.log(`Submitted ${template.name} (${template.language}) for Meta's review on ` +
    `${own ? "your own number" : "Vatio's test number"}: ${template.category}, ` +
    `${count} param${count === 1 ? "" : "s"}, ${paint("cyan", template.status)}.`);
  console.log("Meta usually decides within minutes, at most 24 hours. Check with: vatio templates list" +
    (own ? "" : " --env preview"));
  console.log(own
    ? "Once APPROVED, your backend sends it with a live key outside the 24-hour window with:"
    : "Once APPROVED, a preview key sends it to your test phones outside the 24-hour window with:");
  console.log(`  "template": ${JSON.stringify(template.example)}`);
  if (!own) {
    console.log("When you connect your own number, Vatio moves your templates to it, and from then on your backend " +
      "sends from it with a live key: `vatio whatsapp` prints where.");
  }
}

export async function webhooks(config, args) {
  const environment = takeEnv(args, { fallback: "live", cwd: config.workspaceRoot });
  const label = takeValue(args, "--label");
  const events = takeAll(args, "--event");
  const workspace = config.resolveWorkspaceRequired();
  const client = deployClient(config, workspace);
  const sub = args.shift() ?? "list";

  if (sub === "list") {
    const payload = await client.listWebhookEndpoints();
    const list = Array.isArray(payload.webhook_endpoints) ? payload.webhook_endpoints : [];
    if (list.length === 0) {
      console.log(`No webhook endpoints on workspace ${workspace}`);
      console.log("  Add one: vatio webhooks create https://your-app.com/vatio/webhooks --env live");
      return;
    }
    console.log(`Webhook endpoints on workspace ${workspace} (${list.length}):`);
    for (const endpoint of list) {
      const state = endpoint.enabled ? paint("green", "enabled") : paint("red", "disabled");
      console.log(`  #${endpoint.id}  ${endpoint.environment}  ${endpoint.url}  ${state}`);
      console.log(`    events: ${endpoint.events.length > 0 ? endpoint.events.join(", ") : "all"}` +
        (endpoint.consecutive_failures > 0 ? `   failing: ${endpoint.consecutive_failures} in a row` : ""));
    }
    return;
  }
  if (sub === "create") {
    const url = args.shift();
    if (!url) fail("Usage: vatio webhooks create URL [--event NAME]... [--label NAME] [--env NAME]");
    const payload = await client.createWebhookEndpoint({ environment, url, events, label });
    console.log(`Created webhook endpoint #${payload.id} for ${environment}: ${payload.url}`);
    console.log(`  events: ${payload.events.length > 0 ? payload.events.join(", ") : "all"}`);
    console.log("");
    // Vatio signs every delivery with it; it is not shown again.
    console.log(`  ${payload.secret}`);
    console.log("");
    console.log("Copy the signing secret now — it is not shown again. Check it with: vatio webhooks test " + payload.id);
    return;
  }
  if (sub === "test") {
    const id = args.shift();
    if (!id) fail("Usage: vatio webhooks test ID");
    const delivery = await client.testWebhookEndpoint({ id });
    console.log(`Sent a ping (${delivery.id}). Waiting for your endpoint…`);
    const deadline = Date.now() + 30_000;
    for (;;) {
      await sleep(WAIT_INTERVAL_MS);
      const { deliveries = [] } = await client.listWebhookDeliveries({ id });
      const current = deliveries.find((entry) => entry.id === delivery.id);
      if (current && (current.status === "delivered" || current.attempts > 0)) {
        printDelivery(current);
        return;
      }
      if (Date.now() > deadline) {
        console.log("No answer yet. Check later with: vatio webhooks deliveries " + id);
        return;
      }
    }
  }
  if (sub === "deliveries") {
    const id = args.shift();
    if (!id) fail("Usage: vatio webhooks deliveries ID");
    const { deliveries = [] } = await client.listWebhookDeliveries({ id });
    if (deliveries.length === 0) {
      console.log("No deliveries yet.");
      return;
    }
    for (const delivery of deliveries) printDelivery(delivery);
    return;
  }
  if (sub === "enable") {
    const id = args.shift();
    if (!id) fail("Usage: vatio webhooks enable ID");
    await client.updateWebhookEndpoint({ id, enabled: true });
    console.log(`Enabled webhook endpoint #${id}`);
    return;
  }
  if (sub === "rm" || sub === "remove" || sub === "delete") {
    const id = args.shift();
    if (!id) fail("Usage: vatio webhooks rm ID");
    await client.deleteWebhookEndpoint({ id });
    console.log(`Removed webhook endpoint #${id}`);
    return;
  }

  fail("Usage: vatio webhooks list|create URL [--event NAME]...|test ID|deliveries ID|enable ID|rm ID [--env NAME]");
}

function printDelivery(delivery) {
  const status = delivery.status === "delivered"
    ? paint("green", "delivered")
    : delivery.status === "failed" ? paint("red", "failed") : paint("cyan", "retrying");
  const http = delivery.response_status ? ` HTTP ${delivery.response_status}` : "";
  const error = delivery.last_error ? ` — ${delivery.last_error}` : "";
  console.log(`  ${delivery.id}  ${delivery.event}  ${status}${http}  attempts ${delivery.attempts}  ${delivery.created_at}${error}`);
}
