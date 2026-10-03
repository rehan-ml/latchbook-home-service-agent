const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let currentCase = null;
let lastSources = [];
let lastTrace = [];
let voiceTurn = false;
let turnInFlight = false;
let currentIntake = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The request failed.");
  return data;
}

function post(path, payload) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

function appendMessage(role, content) {
  const element = document.createElement("div");
  element.className = `message ${role}`;
  element.innerHTML = `<span class="message-avatar">${role === "assistant" ? "L" : "Y"}</span><div><small>${role === "assistant" ? "Latchbook" : "You"}</small><p>${escapeHtml(content)}</p></div>`;
  $("#messages").append(element);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  return element;
}

function renderIntake(intake) {
  currentIntake = intake;
  $("#intakeBar").classList.toggle("hidden", !intake);
  if (!intake) return;
  $("#intakeQuestion").textContent = intake.question;
  $("#intakeSuggestion").dataset.answer = intake.applianceId === "washer"
    ? "Water is near the inlet hose after the cycle. I did not open the machine."
    : "Standing water remains inside after the cycle. I checked the removable filter.";
}

function renderCase(serviceCase, sources = lastSources, trace = lastTrace) {
  currentCase = serviceCase;
  lastSources = sources;
  lastTrace = trace;
  if (!serviceCase) {
    $("#casePanel").classList.add("hidden");
    return;
  }
  $("#casePanel").classList.remove("hidden");
  $("#caseId").textContent = serviceCase.id;
  $("#caseAppliance").textContent = serviceCase.applianceName;
  $("#caseSymptom").textContent = serviceCase.symptom;
  $("#caseStatus").textContent = serviceCase.status;
  $("#caseStatus").className = `status-pill ${serviceCase.status}`;
  $("#approvalState").textContent = serviceCase.status === "draft" ? "Waiting for approval" : serviceCase.status === "approved" ? `Approved by ${serviceCase.approvedBy}` : "Case resolved";
  $("#sourceList").innerHTML = serviceCase.evidenceIds.length
    ? serviceCase.evidenceIds.map((id) => {
      const source = sources.find((item) => item.id === id);
      return `<div class="source-card"><small>${escapeHtml(source?.kind ?? "Local record")} · ${escapeHtml(id)}</small><strong>${escapeHtml(source?.title ?? "Saved source")}</strong>${source?.excerpt ? `<p>${escapeHtml(source.excerpt)}</p>` : ""}</div>`;
    }).join("")
    : `<p class="empty-state">No matching local record was found. The case is based only on your report.</p>`;
  $("#toolTrace").innerHTML = trace.length
    ? trace.map((step) => `<li><div><strong>${escapeHtml(step.tool.replaceAll("_", " "))}</strong>${escapeHtml(step.detail)}</div></li>`).join("")
    : `<li><div><strong>Persistent case</strong>Reopen a scenario to see a fresh tool trace.</div></li>`;
  const assessment = serviceCase.assessment;
  $("#evidenceStatus").textContent = assessment?.status ?? "Earlier case";
  $("#evidenceSummary").textContent = assessment
    ? `${assessment.sourceCount} local source${assessment.sourceCount === 1 ? "" : "s"} · ${assessment.priorCaseIds.length} earlier case${assessment.priorCaseIds.length === 1 ? "" : "s"}`
    : "This case was created before the evidence check was added.";
  $("#evidenceSignals").innerHTML = assessment?.signals?.map((signal) => `<li class="${escapeHtml(signal.type)}"><strong>${escapeHtml(signal.type)}</strong>${escapeHtml(signal.message)}</li>`).join("") ?? "";
  const related = serviceCase.relatedCaseIds ?? [];
  $("#relatedCases").classList.toggle("hidden", !related.length);
  $("#relatedCases").innerHTML = related.length ? `<span>PREVIOUS LOCAL CASES</span><strong>${related.map(escapeHtml).join(" · ")}</strong><p>Review these earlier cases before assuming the same fault has returned.</p>` : "";
  $("#approveButton").disabled = serviceCase.status !== "draft";
  $("#copyButton").disabled = serviceCase.status === "draft";
  $("#closeButton").disabled = serviceCase.status !== "approved";
}

async function refreshState() {
  const state = await api("/api/state");
  $("#homeTitle").textContent = state.household;
  $("#appliances").innerHTML = state.appliances.map((item) => `
    <div class="appliance"><span class="appliance-mark">${item.id === "washer" ? "≈" : "▤"}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.location)} · ${escapeHtml(item.model)}</small></div></div>
  `).join("");
  $("#recordCount").textContent = state.records.length;
  $("#caseCount").textContent = state.cases.length;
  $("#events").innerHTML = state.events.length
    ? state.events.map((event) => `<div class="event"><strong>${escapeHtml(event.type.replaceAll("_", " "))}${event.caseId ? ` · ${escapeHtml(event.caseId)}` : ""}</strong>${escapeHtml(event.detail)}<small>${escapeHtml(new Date(event.at).toLocaleString())}</small></div>`).join("")
    : `<p class="empty-state">No action yet. A draft will appear here.</p>`;
  renderIntake(state.activeIntake);
  if (currentIntake && !currentCase) {
    renderCase(null);
    return;
  }
  const selected = (currentCase && state.cases.find((item) => item.id === currentCase.id)) ?? state.cases.at(-1);
  if (selected) {
    const sources = selected.evidenceIds.map((id) => state.records.find((item) => item.id === id)).filter(Boolean);
    renderCase(selected, sources, currentCase?.id === selected.id ? lastTrace : []);
  } else {
    renderCase(null);
  }
}

async function sendTurn(utterance) {
  const text = utterance.trim();
  if (!text || turnInFlight) return;
  turnInFlight = true;
  $$('[data-prompt]').forEach((button) => { button.disabled = true; });
  $("#composerError").textContent = "";
  appendMessage("user", text);
  $("#utterance").value = "";
  const busy = appendMessage("assistant", "Checking the home records…");
  $("#composer").querySelector(".send-button").disabled = true;
  try {
    const turn = await post("/api/turn", { utterance: text });
    busy.remove();
    appendMessage("assistant", turn.reply);
    if (turn.stage === "interview") {
      renderIntake(turn.intake);
      renderCase(null);
    }
    if (turn.case) renderCase(turn.case, turn.sources, turn.trace);
    await refreshState();
    if (turn.case) $("#casePanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (voiceTurn && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(turn.reply));
    }
  } catch (error) {
    busy.remove();
    $("#composerError").textContent = error.message;
  } finally {
    voiceTurn = false;
    turnInFlight = false;
    $$('[data-prompt]').forEach((button) => { button.disabled = false; });
    $("#composer").querySelector(".send-button").disabled = false;
  }
}

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  sendTurn($("#utterance").value);
});
$$('[data-prompt]').forEach((button) => button.addEventListener("click", () => sendTurn(button.dataset.prompt)));
$("#intakeSuggestion").addEventListener("click", () => sendTurn($("#intakeSuggestion").dataset.answer));

const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
if (Recognition) {
  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.onresult = (event) => { voiceTurn = true; sendTurn(event.results[0][0].transcript); };
  recognition.onend = () => $("#voiceButton").classList.remove("listening");
  recognition.onerror = () => { $("#voiceButton").classList.remove("listening"); $("#composerError").textContent = "Microphone unavailable; typing still works."; };
  $("#voiceButton").addEventListener("click", () => { $("#composerError").textContent = ""; $("#voiceButton").classList.add("listening"); recognition.start(); });
} else {
  $("#voiceButton").disabled = true;
  $("#voiceButton").title = "Browser speech recognition is unavailable; type your request instead.";
}

$("#approveButton").addEventListener("click", () => $("#approveDialog").showModal());
$("#approveForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await post("/api/approve", { caseId: currentCase.id, confirmedBy: $("#confirmedBy").value });
    $("#approveDialog").close();
    await refreshState();
    appendMessage("assistant", `${currentCase.id} is approved as a local brief. You can copy it now. Nothing has been sent or booked.`);
  } catch (error) { window.alert(error.message); }
});
$("#closeButton").addEventListener("click", () => $("#closeDialog").showModal());
$("#closeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await post("/api/close", { caseId: currentCase.id, outcome: $("#caseOutcome").value });
    $("#closeDialog").close();
    $("#caseOutcome").value = "";
    await refreshState();
    appendMessage("assistant", `${currentCase.id} is closed. Your household-reported outcome is now a citable local record for future incidents.`);
  } catch (error) { window.alert(error.message); }
});
$$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));

$("#copyButton").addEventListener("click", async () => {
  try {
    const response = await fetch(`/api/brief?id=${encodeURIComponent(currentCase.id)}`);
    if (!response.ok) throw new Error("Could not build the brief.");
    const brief = await response.text();
    try {
      await navigator.clipboard.writeText(brief);
      $("#copyButton").textContent = "Copied to clipboard";
    } catch {
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([brief], { type: "text/plain" }));
      link.href = url; link.download = `${currentCase.id}-service-brief.txt`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("#copyButton").textContent = "Downloaded brief";
    }
    setTimeout(() => $("#copyButton").textContent = "Copy approved brief", 2200);
  } catch (error) { window.alert(error.message); }
});

$("#recordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await post("/api/record", {
      applianceId: $("#recordAppliance").value,
      title: $("#recordTitleInput").value,
      text: $("#recordText").value,
    });
    $("#recordMessage").textContent = `Saved ${result.record.id} locally. Ask about this appliance to use it.`;
    $("#recordTitleInput").value = "";
    $("#recordText").value = "";
    await refreshState();
  } catch (error) { $("#recordMessage").textContent = error.message; }
});

$("#resetButton").addEventListener("click", async () => {
  if (!window.confirm("Reset the fictional home, removing local notes and cases from this demo?")) return;
  await post("/api/reset", {});
  currentCase = null; lastSources = []; lastTrace = [];
  $("#casePanel").classList.add("hidden");
  $("#messages").innerHTML = "";
  appendMessage("assistant", "The fictional home is reset. Try a new washer or dishwasher scenario.");
  await refreshState();
});

refreshState().catch((error) => { $("#composerError").textContent = error.message; });

async function mcpRequest(method, params, id) {
  const response = await fetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "MCP request failed.");
  return payload;
}

$("#inspectMcp").addEventListener("click", async () => {
  const button = $("#inspectMcp");
  button.disabled = true;
  $("#inspectorTranscript").textContent = "Connecting to the local MCP endpoint…";
  try {
    const initialized = await mcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "latchbook-browser-inspector", version: "1.0.0" } }, 1);
    const notification = await fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    if (notification.status !== 202) throw new Error("MCP initialization notification was not accepted.");
    const listed = await mcpRequest("tools/list", {}, 2);
    const called = await mcpRequest("tools/call", { name: "find_appliance", arguments: { query: "washing machine" } }, 3);
    const tools = listed.result.tools;
    const appliance = called.result.structuredContent.appliances[0];
    $("#inspectorVersion").textContent = initialized.result.protocolVersion;
    $("#inspectorCount").textContent = `${tools.length} live tools`;
    $("#inspectorResult").textContent = appliance.name;
    $("#inspectorTranscript").textContent = JSON.stringify({ initialize: initialized.result, initializedNotification: notification.status, tools: tools.map((item) => item.name), toolCall: called.result.structuredContent }, null, 2);
  } catch (error) {
    $("#inspectorTranscript").textContent = `MCP check failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
