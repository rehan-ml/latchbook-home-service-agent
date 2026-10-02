import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.mjs";
import { runAgentTurn, buildServiceBrief } from "../src/agent.mjs";
import { executeTool } from "../src/tools.mjs";

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "latchbook-test-"));
  try { return await run(new JsonStore(join(directory, "home.json"))); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("builds a cited case through multiple real tools and persists it", async () => withStore(async (store) => {
  const turn = await runAgentTurn(store, "The washer is leaking again");
  assert.equal(turn.case.status, "draft");
  assert.equal(turn.trace.length, 5);
  assert.deepEqual(turn.trace.map((step) => step.tool), [
    "find_appliance", "search_home_records", "check_warranty", "list_service_cases", "draft_service_case",
  ]);
  assert.ok(turn.sources.some((source) => source.id === "history-washer"));
  assert.match(turn.reply, /not diagnosed/i);
  assert.equal((await store.read()).cases.length, 1);
}));

test("requires explicit approval and never claims external booking", async () => withStore(async (store) => {
  const turn = await runAgentTurn(store, "The washer is leaking again");
  const spoken = await runAgentTurn(store, "Approve it");
  assert.match(spoken.reply, /explicit confirmation control/);
  assert.equal((await store.read()).cases[0].status, "draft");
  const draftState = await store.read();
  assert.throws(() => buildServiceBrief(draftState, turn.case.id), /approve the case/);

  const approved = await executeTool(store, "approve_service_case", { caseId: turn.case.id, confirmedBy: "Maya" });
  assert.equal(approved.case.status, "approved");
  assert.match(approved.case.note, /No provider has been contacted/);
  const brief = buildServiceBrief(await store.read(), turn.case.id);
  assert.match(brief, /history-washer/);
  assert.match(brief, /coverage unverified/);
  await assert.rejects(() => executeTool(store, "approve_service_case", { caseId: turn.case.id, confirmedBy: "Maya" }), /Only an existing draft/);
}));

test("reports expired recorded warranty without promising coverage", async () => withStore(async (store) => {
  const result = await executeTool(store, "check_warranty", { applianceId: "dishwasher" }, { today: () => "2026-10-02" });
  assert.equal(result.recordedStatus, "past recorded date");
  assert.match(result.caveat, /not a guarantee/);
}));

test("new user records are searchable and cited", async () => withStore(async (store) => {
  const added = await executeTool(store, "add_home_record", {
    applianceId: "dishwasher", title: "My drainage note", text: "Drain trouble started after the filter was cleaned.",
  });
  const found = await executeTool(store, "search_home_records", { applianceId: "dishwasher", query: "drain trouble" });
  assert.ok(found.records.some((record) => record.id === added.record.id));
}));

test("status survives a new agent turn and reset is explicit", async () => withStore(async (store) => {
  await runAgentTurn(store, "The dishwasher will not drain");
  const status = await runAgentTurn(store, "What is the dishwasher case status?");
  assert.match(status.reply, /draft/);
  await store.reset();
  assert.equal((await store.read()).cases.length, 0);
}));

test("repeated incident wording reuses a draft instead of multiplying cases", async () => withStore(async (store) => {
  const first = await runAgentTurn(store, "The washer is leaking again");
  const second = await runAgentTurn(store, "The washer is leaking again");
  assert.equal(second.case.id, first.case.id);
  assert.equal((await store.read()).cases.length, 1);
}));

test("unsupported external action does not mutate local state", async () => withStore(async (store) => {
  const turn = await runAgentTurn(store, "Book a repair technician for the washer");
  assert.match(turn.reply, /cannot contact a provider or book/);
  assert.equal(turn.trace.length, 0);
  assert.equal((await store.read()).cases.length, 0);
}));

test("a service case cannot cite another appliance's record", async () => withStore(async (store) => {
  await assert.rejects(() => executeTool(store, "draft_service_case", {
    applianceId: "washer", symptom: "The washer is leaking", evidenceIds: ["manual-dishwasher"],
  }), /does not belong/);
  assert.equal((await store.read()).cases.length, 0);
}));
