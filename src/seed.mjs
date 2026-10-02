export function seedState() {
  return {
    version: 1,
    household: "The Harper home",
    appliances: [
      { id: "washer", name: "Northstar Wash 700", kind: "washing machine", model: "NW-700", purchased: "2025-04-15", warrantyEnds: "2027-04-15", location: "Utility room" },
      { id: "dishwasher", name: "Cedarline Dish 400", kind: "dishwasher", model: "CD-400", purchased: "2023-08-01", warrantyEnds: "2025-08-01", location: "Kitchen" },
    ],
    records: [
      { id: "manual-washer", applianceId: "washer", kind: "Manual excerpt", title: "Washer: water near the machine", text: "If water appears near the inlet hose, stop the cycle. If it is safe to do so, turn off the water supply and contact qualified service if the leak persists. Do not open the electrical housing. This excerpt is fictional demo data." },
      { id: "warranty-washer", applianceId: "washer", kind: "Warranty note", title: "Washer limited warranty", text: "The recorded limited warranty runs through 15 April 2027. Coverage for a leak depends on inspection and the provider's terms. This is fictional demo data, not a coverage decision." },
      { id: "history-washer", applianceId: "washer", kind: "Prior incident", title: "September service note", text: "On 5 September 2026, the inlet hose seal was inspected after a small leak. The visit note says to report any recurrence. This is fictional demo data." },
      { id: "manual-dishwasher", applianceId: "dishwasher", kind: "Manual excerpt", title: "Dishwasher: standing water", text: "For standing water, stop the cycle. If safe, switch off the appliance before inspecting the removable filter. Do not open electrical panels. Contact qualified service if the issue continues. This excerpt is fictional demo data." },
      { id: "warranty-dishwasher", applianceId: "dishwasher", kind: "Warranty note", title: "Dishwasher limited warranty", text: "The recorded limited warranty ended on 1 August 2025. Check any separate service plan before assuming coverage. This is fictional demo data." },
    ],
    cases: [],
    events: [],
    nextId: 1,
  };
}
