import { executeTool } from "./tools.mjs";

function applianceQuery(text) {
  if (/dishwasher|dish\s*washer/i.test(text)) return "dishwasher";
  if (/washing machine|washer|laundry/i.test(text)) return "washing machine";
  return null;
}

function summarizeSource(record) {
  return { id: record.id, title: record.title, kind: record.kind, excerpt: record.excerpt };
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
      ? { reply: `${matching.id} for the ${matching.applianceName} is ${matching.status}. ${matching.note}`, trace, case: matching, sources: [] }
      : { reply: "There is no service case yet. Try ‘The washer is leaking again’ to build one from the home records.", trace, case: null, sources: [] };
  }

  if (/\b(approve|confirm|close|resolve)\b/i.test(text)) {
    return {
      reply: "A spoken phrase alone will not approve or close a case. Please use the explicit confirmation control on the case card so the action is visible and deliberate.",
      trace, case: null, sources: [],
    };
  }

  if (!query) {
    return {
      reply: "I can turn a washer or dishwasher problem into a sourced service brief. For example: ‘The washer is leaking again’ or ‘The dishwasher will not drain.’",
      trace, case: null, sources: [],
    };
  }

  const found = await call("find_appliance", { query }, "Identify the appliance in the home inventory");
  if (found.appliances.length !== 1) {
    return { reply: "I could not identify one appliance confidently. Please say ‘washer’ or ‘dishwasher’ and describe the symptom.", trace, case: null, sources: [] };
  }
  const appliance = found.appliances[0];
  const records = await call("search_home_records", { applianceId: appliance.id, query: text }, "Retrieve cited local manual and incident records");
  const warranty = await call("check_warranty", { applianceId: appliance.id }, "Compare the recorded warranty date");
  const prior = await call("list_service_cases", { applianceId: appliance.id }, "Check prior service-case state");
  const draft = await call("draft_service_case", {
    applianceId: appliance.id,
    symptom: text,
    evidenceIds: records.records.map((item) => item.id),
  }, "Create a local draft only; no external contact");

  const recurrence = records.records.some((item) => item.kind === "Prior incident")
    ? " I found a prior incident note that may be relevant."
    : "";
  const previous = prior.cases.length ? ` There ${prior.cases.length === 1 ? "is" : "are"} ${prior.cases.length} earlier case${prior.cases.length === 1 ? "" : "s"} in the local log.` : "";
  const warrantySummary = warranty.recordedStatus === "within recorded date"
    ? `The recorded warranty end date (${warranty.warrantyEnds}) has not passed`
    : `The recorded warranty end date (${warranty.warrantyEnds}) has passed`;
  const reply = `I created ${draft.case.id} for the ${appliance.name}.${recurrence}${previous} ${warrantySummary}, but coverage needs provider confirmation. I have not diagnosed the fault, contacted anyone, or booked a visit. Review the cited brief before approving it.`;

  return { reply, trace, case: draft.case, sources: records.records.map(summarizeSource), warranty };
}

export function buildServiceBrief(state, caseId) {
  const serviceCase = state.cases.find((item) => item.id === caseId);
  if (!serviceCase) throw new Error("Service case not found.");
  if (serviceCase.status === "draft") throw new Error("A person must approve the case before its brief can be exported.");
  const appliance = state.appliances.find((item) => item.id === serviceCase.applianceId);
  const records = serviceCase.evidenceIds.map((id) => state.records.find((item) => item.id === id)).filter(Boolean);
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
    "No diagnosis, repair instructions, provider contact, or booking is implied. A qualified professional should verify the issue and warranty coverage.",
  ].join("\n");
}
