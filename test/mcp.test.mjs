import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../server.mjs";
import { JsonStore } from "../src/store.mjs";

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "latchbook-http-test-"));
  const server = createAppServer({ store: new JsonStore(join(directory, "home.json")) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
}

async function mcp(base, method, params, id = 1, headers = {}) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

test("negotiates MCP 2025-11-25 and exposes functional tools", async () => withServer(async (base) => {
  const initialized = await mcp(base, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.protocolVersion, "2025-11-25");

  const notification = await fetch(`${base}/mcp`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(notification.status, 202);

  const listed = await mcp(base, "tools/list", {});
  const names = (await listed.json()).result.tools.map((tool) => tool.name);
  assert.ok(names.includes("draft_service_case"));
  assert.ok(names.includes("approve_service_case"));

  const called = await mcp(base, "tools/call", { name: "find_appliance", arguments: { query: "washing machine" } });
  const body = await called.json();
  assert.equal(body.result.structuredContent.appliances[0].id, "washer");
  assert.equal(body.result.isError, false);
}));

test("uses one POST endpoint with strict local-origin and version checks", async () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await mcp(base, "tools/list", {}, 2, { "MCP-Protocol-Version": "2024-11-05" })).status, 400);
  assert.equal((await mcp(base, "tools/list", {}, 3, { Origin: "https://evil.example" })).status, 403);
}));

test("simulator API runs the same persistent workflow", async () => withServer(async (base) => {
  const turn = await fetch(`${base}/api/turn`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterance: "The dishwasher will not drain" }),
  });
  assert.equal(turn.status, 200);
  const data = await turn.json();
  assert.equal(data.case.status, "draft");
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.cases.length, 1);
  assert.equal(state.records[0].text, undefined);
  assert.ok(state.records[0].excerpt);
  assert.equal((await fetch(`${base}/api/brief?id=${data.case.id}`)).status, 400);
  const page = await (await fetch(base)).text();
  assert.match(page, /Latchbook/);
}));
