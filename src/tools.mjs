import { assessEvidence } from "./evidence.mjs";

const stringField = (description, maxLength = 160) => ({ type: "string", description, maxLength });

export const TOOL_DEFINITIONS = [
  {
    name: "find_appliance", title: "Find an appliance", description: "Find a recorded household appliance by name, kind, or model. Read-only.",
    inputSchema: { type: "object", properties: { query: stringField("Appliance name, kind, or model") }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "search_home_records", title: "Search home records", description: "Search locally stored manual excerpts, warranty notes, and prior incidents; return source IDs and excerpts. Read-only.",
    inputSchema: { type: "object", properties: { applianceId: stringField("Appliance ID", 60), query: stringField("Symptom or question") }, required: ["applianceId", "query"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "check_warranty", title: "Check recorded warranty date", description: "Compare the locally recorded warranty end date with today. This is not a provider coverage decision. Read-only.",
    inputSchema: { type: "object", properties: { applianceId: stringField("Appliance ID", 60) }, required: ["applianceId"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_service_cases", title: "List service cases", description: "List persistent draft, approved, and closed service cases. Read-only.",
    inputSchema: { type: "object", properties: { applianceId: stringField("Optional appliance ID", 60) }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_active_incident_intake", title: "Get current incident interview", description: "Read the household's unfinished appliance incident interview. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
  },
  {
    name: "start_incident_intake", title: "Start an incident interview", description: "Record the household's initial appliance report and ask a symptom-specific follow-up before drafting a case. Local state only.",
    inputSchema: { type: "object", properties: { applianceId: stringField("Appliance ID", 60), report: stringField("Household's initial observation", 500) }, required: ["applianceId", "report"], additionalProperties: false },
  },
  {
    name: "answer_incident_intake", title: "Answer incident interview", description: "Save the household's answer to the incident follow-up; this is an observation, not a verified diagnosis. Local state only.",
    inputSchema: { type: "object", properties: { intakeId: stringField("Incident interview ID", 60), detail: stringField("Household observation, or explicitly unknown", 500) }, required: ["intakeId", "detail"], additionalProperties: false },
  },
  {
    name: "assess_evidence", title: "Assess evidence quality", description: "Classify recorded sources and flag missing details, stale records, or conflicting warranty dates. Read-only; no diagnosis or coverage decision.",
    inputSchema: { type: "object", properties: { applianceId: stringField("Appliance ID", 60), symptom: stringField("Household observations", 500), evidenceIds: { type: "array", items: stringField("Record ID", 80), maxItems: 5 } }, required: ["applianceId", "symptom", "evidenceIds"], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "draft_service_case", title: "Draft a service case", description: "Create a local service-case draft from a symptom and cited record IDs. Does not contact a provider or book anything.",
    inputSchema: { type: "object", properties: {
      applianceId: stringField("Appliance ID", 60), symptom: stringField("Observed symptom", 500),
      evidenceIds: { type: "array", items: stringField("Record ID", 80), maxItems: 5 },
      intakeId: stringField("Optional completed incident interview ID", 60),
    }, required: ["applianceId", "symptom", "evidenceIds"], additionalProperties: false },
  },
  {
    name: "approve_service_case", title: "Approve a service brief", description: "Mark a local draft approved for the household to copy or share. Call only after a human explicitly confirms. Does not send or book externally.",
    inputSchema: { type: "object", properties: { caseId: stringField("Case ID", 60), confirmedBy: stringField("Name of the person who explicitly approved", 100) }, required: ["caseId", "confirmedBy"], additionalProperties: false },
  },
  {
    name: "close_service_case", title: "Close a service case", description: "Close a case with a user-provided outcome. Call only after explicit human confirmation.",
    inputSchema: { type: "object", properties: { caseId: stringField("Case ID", 60), outcome: stringField("What happened", 500) }, required: ["caseId", "outcome"], additionalProperties: false },
  },
  {
    name: "add_home_record", title: "Add a home record", description: "Save a user-provided plain-text manual excerpt or service note locally for future retrieval. No PDF/OCR or cloud upload.",
    inputSchema: { type: "object", properties: {
      applianceId: stringField("Appliance ID", 60), title: stringField("Record title", 120),
      text: stringField("Plain text from a user-owned document", 4000),
    }, required: ["applianceId", "title", "text"], additionalProperties: false },
  },
];

const clean = (value, maximum, label) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
  return value.trim();
};

const applianceById = (state, id) => {
  const appliance = state.appliances.find((item) => item.id === id);
  if (!appliance) throw new Error("Appliance not found.");
  return appliance;
};

function words(value) {
  return String(value).toLowerCase().replace(/leaking/g, "leak").replace(/draining/g, "drain")
    .match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];
}

function recordMatches(records, query) {
  const queryWords = [...new Set(words(query))];
  return records.map((record) => {
    const haystack = words(`${record.title} ${record.text}`);
    const score = queryWords.reduce((total, word) => total + haystack.filter((token) => token.startsWith(word)).length, 0);
    return { record, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
    .slice(0, 4).map(({ record }) => ({ id: record.id, kind: record.kind, title: record.title, excerpt: record.text.slice(0, 320) }));
}

export async function executeTool(store, name, input = {}, { today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const args = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (name === "find_appliance") {
    const query = clean(args.query, 160, "query").toLowerCase();
    const state = await store.read();
    return { appliances: state.appliances.filter((item) => `${item.name} ${item.kind} ${item.model}`.toLowerCase().includes(query)) };
  }
  if (name === "search_home_records") {
    const id = clean(args.applianceId, 60, "applianceId");
    const query = clean(args.query, 160, "query");
    const state = await store.read();
    applianceById(state, id);
    return { records: recordMatches(state.records.filter((record) => record.applianceId === id), query) };
  }
  if (name === "check_warranty") {
    const state = await store.read();
    const appliance = applianceById(state, clean(args.applianceId, 60, "applianceId"));
    const date = today();
    const recordedStatus = appliance.warrantyEnds >= date ? "within recorded date" : "past recorded date";
    return {
      applianceId: appliance.id, warrantyEnds: appliance.warrantyEnds, checkedOn: date, recordedStatus,
      caveat: "A recorded date is not a guarantee of coverage. Check the provider's terms and inspection decision.",
      sourceId: `warranty-${appliance.id}`,
    };
  }
  if (name === "list_service_cases") {
    const state = await store.read();
    const id = args.applianceId ? clean(args.applianceId, 60, "applianceId") : null;
    return { cases: state.cases.filter((item) => !id || item.applianceId === id).slice().reverse() };
  }
  if (name === "get_active_incident_intake") {
    const state = await store.read();
    return { intake: (state.intakes ?? []).findLast((item) => item.status === "awaiting detail") ?? null };
  }
  if (name === "start_incident_intake") {
    const applianceId = clean(args.applianceId, 60, "applianceId");
    const report = clean(args.report, 500, "report");
    return store.update((state) => {
      const appliance = applianceById(state, applianceId);
      state.intakes ??= [];
      const existing = state.intakes.findLast((item) => item.status === "awaiting detail" && item.applianceId === applianceId && item.report.toLowerCase() === report.toLowerCase());
      if (existing) return { intake: existing, reused: true };
      state.intakes.filter((item) => item.status === "awaiting detail").forEach((item) => { item.status = "superseded"; });
      const question = /\b(leak\w*|water|wet|drip\w*)\b/i.test(report)
        ? "Where do you see the water, and when did it appear? If you cannot tell, say unknown."
        : /\b(drain|standing water|empty)\b/i.test(report)
          ? "Is water still inside after the cycle, and was the removable filter checked? If you cannot tell, say unknown."
          : `What did you observe about the ${appliance.name}, and when did it happen? If you cannot tell, say unknown.`;
      const intake = { id: `IN-${String(state.nextId++).padStart(3, "0")}`, applianceId, report, question, detail: null, status: "awaiting detail", createdAt: new Date().toISOString() };
      state.intakes.push(intake);
      state.events.push({ at: intake.createdAt, type: "intake_started", caseId: null, detail: `Started ${intake.id} for ${appliance.name}.` });
      return { intake, reused: false };
    });
  }
  if (name === "answer_incident_intake") {
    const intakeId = clean(args.intakeId, 60, "intakeId");
    const detail = clean(args.detail, 500, "detail");
    return store.update((state) => {
      const intake = (state.intakes ?? []).find((item) => item.id === intakeId && item.status === "awaiting detail");
      if (!intake) throw new Error("No active incident interview matches that ID.");
      intake.detail = detail;
      intake.status = "complete";
      intake.completedAt = new Date().toISOString();
      state.events.push({ at: intake.completedAt, type: "intake_completed", caseId: null, detail: `Recorded household detail for ${intake.id}.` });
      return { intake };
    });
  }
  if (name === "assess_evidence") {
    const applianceId = clean(args.applianceId, 60, "applianceId");
    const symptom = clean(args.symptom, 500, "symptom");
    if (!Array.isArray(args.evidenceIds) || args.evidenceIds.length > 5) throw new Error("evidenceIds must be an array of at most five record IDs.");
    const evidenceIds = [...new Set(args.evidenceIds.map((id) => clean(id, 80, "evidenceId")))];
    return { assessment: assessEvidence(await store.read(), applianceId, symptom, evidenceIds) };
  }
  if (name === "draft_service_case") {
    const applianceId = clean(args.applianceId, 60, "applianceId");
    const symptom = clean(args.symptom, 500, "symptom");
    if (!Array.isArray(args.evidenceIds) || args.evidenceIds.length > 5) throw new Error("evidenceIds must be an array of at most five record IDs.");
    const evidenceIds = [...new Set(args.evidenceIds.map((id) => clean(id, 80, "evidenceId")))];
    const intakeId = args.intakeId ? clean(args.intakeId, 60, "intakeId") : null;
    return store.update((state) => {
      const appliance = applianceById(state, applianceId);
      const invalid = evidenceIds.filter((id) => !state.records.some((record) => record.id === id && record.applianceId === applianceId));
      if (invalid.length) throw new Error("A cited record does not belong to this appliance.");
      const intake = intakeId ? (state.intakes ?? []).find((item) => item.id === intakeId && item.applianceId === applianceId && item.status === "complete") : null;
      if (intakeId && !intake) throw new Error("A completed interview for this appliance is required.");
      const existing = state.cases.find((item) => item.applianceId === applianceId && item.status === "draft" && item.symptom.toLowerCase() === symptom.toLowerCase());
      if (existing) return { case: existing, reused: true };
      const assessment = assessEvidence(state, applianceId, symptom, evidenceIds);
      const serviceCase = {
        id: `LB-${String(state.nextId++).padStart(3, "0")}`, applianceId, applianceName: appliance.name,
        symptom, evidenceIds, intakeId, assessment, relatedCaseIds: assessment.priorCaseIds,
        status: "draft", createdAt: new Date().toISOString(), approvedBy: null,
        note: "Draft only. No provider has been contacted or appointment booked.",
      };
      state.cases.push(serviceCase);
      state.events.push({ at: serviceCase.createdAt, type: "case_drafted", caseId: serviceCase.id, detail: `Drafted from ${evidenceIds.length} local record(s).` });
      return { case: serviceCase, reused: false };
    });
  }
  if (name === "approve_service_case") {
    const caseId = clean(args.caseId, 60, "caseId");
    const confirmedBy = clean(args.confirmedBy, 100, "confirmedBy");
    return store.update((state) => {
      const serviceCase = state.cases.find((item) => item.id === caseId);
      if (!serviceCase || serviceCase.status !== "draft") throw new Error("Only an existing draft can be approved.");
      serviceCase.status = "approved";
      serviceCase.approvedBy = confirmedBy;
      serviceCase.approvedAt = new Date().toISOString();
      serviceCase.note = "Approved as a shareable brief. No provider has been contacted or appointment booked.";
      state.events.push({ at: serviceCase.approvedAt, type: "case_approved", caseId, detail: `Approved by ${confirmedBy}.` });
      return { case: serviceCase };
    });
  }
  if (name === "close_service_case") {
    const caseId = clean(args.caseId, 60, "caseId");
    const outcome = clean(args.outcome, 500, "outcome");
    return store.update((state) => {
      const serviceCase = state.cases.find((item) => item.id === caseId);
      if (!serviceCase || serviceCase.status !== "approved") throw new Error("Only an approved case can be closed.");
      serviceCase.status = "closed";
      serviceCase.outcome = outcome;
      serviceCase.closedAt = new Date().toISOString();
      const outcomeRecord = {
        id: `outcome-${state.nextId++}`, applianceId: serviceCase.applianceId, caseId, kind: "Service outcome",
        title: `Household follow-up for ${caseId}`, recordedAt: serviceCase.closedAt.slice(0, 10),
        text: `Household-reported service outcome for ${serviceCase.applianceName}. Original report: ${serviceCase.symptom.replace(/[.!?]+$/, "")}. Reported outcome: ${outcome.replace(/[.!?]+$/, "")}. Not independently verified.`,
      };
      state.records.push(outcomeRecord);
      serviceCase.outcomeRecordId = outcomeRecord.id;
      state.events.push({ at: serviceCase.closedAt, type: "case_closed", caseId, detail: outcome });
      return { case: serviceCase, outcomeRecord: { id: outcomeRecord.id, title: outcomeRecord.title } };
    });
  }
  if (name === "add_home_record") {
    const applianceId = clean(args.applianceId, 60, "applianceId");
    const title = clean(args.title, 120, "title");
    const recordText = clean(args.text, 4000, "text");
    return store.update((state) => {
      applianceById(state, applianceId);
      const record = { id: `note-${state.nextId++}`, applianceId, kind: "User note", title, text: recordText, recordedAt: new Date().toISOString().slice(0, 10) };
      state.records.push(record);
      state.events.push({ at: new Date().toISOString(), type: "record_added", caseId: null, detail: `Added ${record.id} for ${applianceId}.` });
      return { record: { id: record.id, applianceId, kind: record.kind, title: record.title } };
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}
