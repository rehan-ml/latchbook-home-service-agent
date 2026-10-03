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

test("interviews, builds a cited case through real tools, and persists it", async () => withStore(async (store) => {
  const first = await runAgentTurn(store, "The washer is leaking again");
  assert.equal(first.stage, "interview");
  assert.match(first.reply, /where do you see the water/i);
  assert.equal((await store.read()).cases.length, 0);
  const turn = await runAgentTurn(store, "Water is near the inlet hose after the cycle.");
  assert.equal(turn.case.status, "draft");
  assert.deepEqual(turn.trace.map((step) => step.tool), [
    "get_active_incident_intake", "answer_incident_intake", "search_home_records", "check_warranty", "list_service_cases", "assess_evidence", "draft_service_case",
  ]);
  assert.equal(turn.case.intakeId, first.intake.id);
  assert.ok(turn.sources.some((source) => source.id === "history-washer"));
  assert.equal(turn.assessment.status, "source backed");
  assert.match(turn.reply, /not diagnosed/i);
  assert.equal((await store.read()).cases.length, 1);
}));

test("requires explicit approval and never claims external booking", async () => withStore(async (store) => {
  await runAgentTurn(store, "The washer is leaking again");
  const turn = await runAgentTurn(store, "Water is under the washer after the cycle.");
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
  await runAgentTurn(store, "Standing water remains inside after the cycle.");
  const status = await runAgentTurn(store, "What is the dishwasher case status?");
  assert.match(status.reply, /draft/);
  await store.reset();
  assert.equal((await store.read()).cases.length, 0);
}));

test("repeated incident wording reuses a draft instead of multiplying cases", async () => withStore(async (store) => {
  const report = "The washer is leaking near the inlet after a cycle.";
  const first = await runAgentTurn(store, report);
  const second = await runAgentTurn(store, report);
  assert.equal(second.case.id, first.case.id);
  assert.equal((await store.read()).cases.length, 1);
}));

test("closing a case creates a citable household outcome for recurrence", async () => withStore(async (store) => {
  const first = await runAgentTurn(store, "The washer is leaking near the inlet after a cycle.");
  await executeTool(store, "approve_service_case", { caseId: first.case.id, confirmedBy: "Maya" });
  const closed = await executeTool(store, "close_service_case", { caseId: first.case.id, outcome: "A technician replaced the inlet seal; the leak stopped." });
  assert.equal(closed.case.status, "closed");
  const next = await runAgentTurn(store, "The washer is leaking near the inlet after another cycle.");
  assert.ok(next.sources.some((source) => source.id === closed.outcomeRecord.id));
  assert.ok(next.case.relatedCaseIds.includes(first.case.id));
  assert.ok(next.assessment.signals.some((signal) => signal.type === "history"));
}));

test("evidence audit flags conflicting and stale warranty notes", async () => withStore(async (store) => {
  const added = await executeTool(store, "add_home_record", { applianceId: "washer", title: "Warranty note", text: "Warranty end 12 March 2025." });
  await store.update((state) => {
    state.records.find((record) => record.id === added.record.id).recordedAt = "2024-01-01";
  });
  const result = await executeTool(store, "assess_evidence", { applianceId: "washer", symptom: "Leak near inlet after cycle", evidenceIds: [added.record.id] });
  assert.equal(result.assessment.status, "needs reconciliation");
  assert.ok(result.assessment.signals.some((signal) => signal.type === "conflict"));
  assert.ok(result.assessment.signals.some((signal) => signal.type === "stale"));
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
