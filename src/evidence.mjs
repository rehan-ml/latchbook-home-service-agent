const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

function dateInText(text) {
  const iso = String(text).match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const written = String(text).match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (!written) return null;
  const month = MONTHS[written[2].toLowerCase()] + 1;
  return `${written[3]}-${String(month).padStart(2, "0")}-${written[1].padStart(2, "0")}`;
}

export function assessEvidence(state, applianceId, symptom, evidenceIds, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const appliance = state.appliances.find((item) => item.id === applianceId);
  if (!appliance) throw new Error("Appliance not found.");
  const records = evidenceIds.map((id) => state.records.find((item) => item.id === id && item.applianceId === applianceId));
  if (records.some((item) => !item)) throw new Error("An evidence ID is missing or belongs to another appliance.");
  const priorCases = state.cases.filter((item) => item.applianceId === applianceId);
  const completedCases = priorCases.filter((item) => item.status === "closed" && item.outcome);
  const signals = [];
  if (!records.length) signals.push({ type: "missing", message: "No matching home record was found; this case rests on the household report." });
  if (!/\b(?:after|before|during|near|under|behind|around|when|where|at|inside|outside|since|yesterday|today|last night|this morning)\b/i.test(symptom)) {
    signals.push({ type: "missing", message: "The report may still need a time or location detail." });
  }
  const warrantyNotes = records.filter((item) => /warranty/i.test(`${item.kind} ${item.title}`));
  for (const note of warrantyNotes) {
    const noteDate = dateInText(note.text);
    if (noteDate && noteDate !== appliance.warrantyEnds) {
      signals.push({ type: "conflict", message: `Warranty note ${note.id} records ${noteDate}, while the inventory records ${appliance.warrantyEnds}. Confirm with the provider.` });
    }
  }
  for (const record of records) {
    if (record.recordedAt && Date.parse(today) - Date.parse(record.recordedAt) > 365 * 24 * 60 * 60 * 1000) {
      signals.push({ type: "stale", message: `${record.id} is over a year old; confirm that its details still apply.` });
    }
  }
  signals.push({ type: "unverified", message: "The stored warranty date does not establish coverage; provider terms and inspection still apply." });
  if (completedCases.length) signals.push({ type: "history", message: `${completedCases.length} earlier resolved case(s) have household-recorded outcomes to review for recurrence.` });
  return {
    applianceId,
    observed: symptom,
    sourceCount: records.length,
    recorded: records.map((item) => ({ id: item.id, kind: item.kind, title: item.title })),
    priorCaseIds: priorCases.map((item) => item.id),
    completedCaseIds: completedCases.map((item) => item.id),
    signals,
    status: signals.some((item) => item.type === "conflict") ? "needs reconciliation" : records.length ? "source backed" : "observation only",
  };
}
