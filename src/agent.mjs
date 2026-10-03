import { executeTool } from "./tools.mjs";

function applianceQuery(text) {
  if (/dishwasher|dish\s*washer/i.test(text)) return "dishwasher";
  if (/washing machine|washer|laundry/i.test(text)) return "washing machine";
  return null;
}

function summarizeSource(record) {
  return { id: record.id, title: record.title, kind: record.kind, excerpt: record.excerpt };
}

function hasEnoughContext(text) {
  const place = /\b(near|under|behind|around|inside|outside|inlet|hose|filter|floor|base|bottom|kitchen|utility)\b/i.test(text);
  const time = /\b(after|before|during|when|since|yesterday|today|last night|this morning|cycle|overnight)\b/i.test(text);
  return place && time;
}

async function compileCase(call, store, appliance, symptom, intakeId = null) {
  const records = await call("search_home_records", { applianceId: appliance.id, query: symptom.slice(0, 160) }, "Retrieve cited local manual, incident, and outcome records");
  const warranty = await call("check_warranty", { applianceId: appliance.id }, "Compare the recorded warranty date");
  const prior = await call("list_service_cases", { applianceId: appliance.id }, "Read previous service-case outcomes");
  const assessment = await call("assess_evidence", {
    applianceId: appliance.id, symptom, evidenceIds: records.records.map((item) => item.id),
  }, "Flag missing, stale, or conflicting evidence");
  const draft = await call("draft_service_case", {
    applianceId: appliance.id, symptom, evidenceIds: records.records.map((item) => item.id),
    ...(intakeId ? { intakeId } : {}),
  }, "Create a local draft with evidence assessment");

  const recurrence = records.records.some((item) => item.kind === "Service outcome")
    ? " I found a household-recorded outcome from an earlier resolved case that may be relevant."
    : records.records.some((item) => item.kind === "Prior incident")
      ? " I found a prior incident note that may be relevant."
      : "";
  const previous = prior.cases.length ? ` There ${prior.cases.length === 1 ? "is" : "are"} ${prior.cases.length} earlier case${prior.cases.length === 1 ? "" : "s"} in the local log.` : "";
  const warrantySummary = warranty.recordedStatus === "within recorded date"
    ? `The recorded warranty end date (${warranty.warrantyEnds}) has not passed`
    : `The recorded warranty end date (${warranty.warrantyEnds}) has passed`;
  const attention = assessment.assessment.signals.find((item) => item.type === "conflict" || item.type === "stale");
  const reply = `I drafted ${draft.case.id} for the ${appliance.name}.${recurrence}${previous} ${warrantySummary}, but coverage needs provider confirmation.${attention ? ` Evidence check: ${attention.message}` : ""} I have not diagnosed the fault, contacted anyone, or booked a visit. Review the cited brief before approving it.`;
  return { reply, case: draft.case, sources: records.records.map(summarizeSource), warranty, assessment: assessment.assessment, stage: "case", intake: null };
}

export async function runAgentTurn(store, utterance) {
  const text = String(utterance ?? "").trim();
  if (text.length < 4 || text.length > 500) throw new Error("Say or type a request between 4 and 500 characters.");
  const trace = [];
  const call = async (name, args, detail) => {
    const result = await executeTool(store, name, args);
    trace.push({ tool: name, detail });
    return result;
  };

  if (/\b(book|schedule|send|email|call)\b/i.test(text) && /\b(repair|technician|service|provider)\b/i.test(text)) {
    return {
      reply: "I can prepare a cited service brief, but this demo cannot contact a provider or book an appointment. Tell me which appliance and what happened; you can approve and copy the brief afterward.",
      trace, case: null, sources: [],
    };
  }

  const query = applianceQuery(text);
  if (/\b(status|update|what happened|where is|which case)\b/i.test(text)) {
    const result = await call("list_service_cases", {}, "Read persistent case state");
    const matching = query
      ? result.cases.find((item) => item.applianceId === (query === "dishwasher" ? "dishwasher" : "washer"))
      : result.cases[0];
    return matching
      ? { reply: `${matching.id} for the ${matching.applianceName} is ${matching.status}. ${matching.note}${matching.outcome ? ` Household-reported outcome: ${matching.outcome}` : ""}`, trace, case: matching, sources: [], stage: "case" }
      : { reply: "There is no service case yet. Report a washer or dishwasher problem to begin an incident interview.", trace, case: null, sources: [], stage: "idle" };
  }

  if (/\b(approve|confirm|close|resolve)\b/i.test(text)) {
    return {
      reply: "A spoken phrase alone will not approve or close a case. Please use the explicit confirmation control on the case card so the action is visible and deliberate.",
      trace, case: null, sources: [],
    };
  }

  const activeResult = await call("get_active_incident_intake", {}, "Check for an unfinished incident interview");
  const active = activeResult.intake;
  if (active && (!query || query === (active.applianceId === "dishwasher" ? "dishwasher" : "washing machine"))) {
    const answered = await call("answer_incident_intake", { intakeId: active.id, detail: text }, "Record the household's follow-up observation");
    const state = await store.read();
    const appliance = state.appliances.find((item) => item.id === active.applianceId);
    const symptom = `${answered.intake.report}. Household detail: ${answered.intake.detail}`.slice(0, 500);
    const compiled = await compileCase(call, store, appliance, symptom, active.id);
    return { ...compiled, trace };
  }

  if (!query) {
    return {
      reply: "I can turn a washer or dishwasher problem into a sourced service brief. For example: ‘The washer is leaking again’ or ‘The dishwasher will not drain.’",
      trace, case: null, sources: [], stage: "idle",
    };
  }

  const found = await call("find_appliance", { query }, "Identify the appliance in the home inventory");
  if (found.appliances.length !== 1) {
    return { reply: "I could not identify one appliance confidently. Please say ‘washer’ or ‘dishwasher’ and describe the symptom.", trace, case: null, sources: [] };
  }
  const appliance = found.appliances[0];
  if (!hasEnoughContext(text)) {
    const started = await call("start_incident_intake", { applianceId: appliance.id, report: text }, "Ask a symptom-specific follow-up");
    return {
      reply: `Before I draft the handoff: ${started.intake.question}`,
      trace, case: null, sources: [], intake: started.intake, stage: "interview",
    };
  }
  const compiled = await compileCase(call, store, appliance, text);
  return { ...compiled, trace };
}

export function buildServiceBrief(state, caseId) {
  const serviceCase = state.cases.find((item) => item.id === caseId);
  if (!serviceCase) throw new Error("Service case not found.");
  if (serviceCase.status === "draft") throw new Error("A person must approve the case before its brief can be exported.");
  const appliance = state.appliances.find((item) => item.id === serviceCase.applianceId);
  const records = serviceCase.evidenceIds.map((id) => state.records.find((item) => item.id === id)).filter(Boolean);
  const related = (serviceCase.relatedCaseIds ?? []).map((id) => state.cases.find((item) => item.id === id)).filter(Boolean);
  return [
    `LATCHBOOK · SERVICE BRIEF ${serviceCase.id}`,
    `Status: ${serviceCase.status.toUpperCase()}`,
    `Appliance: ${appliance.name} (${appliance.model}) · ${appliance.location}`,
    `Observed by household: ${serviceCase.symptom}`,
    `Recorded warranty end: ${appliance.warrantyEnds} (coverage unverified)`,
    "",
    "LOCAL RECORDS TO REVIEW",
    ...records.map((record) => `[${record.id}] ${record.title}: ${record.text}`),
    "",
    "EVIDENCE CHECK",
    ...(serviceCase.assessment?.signals ?? []).map((signal) => `[${signal.type}] ${signal.message}`),
    "",
    "RELATED SERVICE CASES",
    ...(related.length ? related.map((item) => `${item.id}: ${item.status}. ${item.outcome ? `Household-reported outcome: ${item.outcome}` : item.note}`) : ["No earlier case in the local log."]),
    "",
    "No diagnosis, repair instructions, provider contact, or booking is implied. A qualified professional should verify the issue and warranty coverage.",
  ].join("\n");
}
