# Latchbook

**From “the washer is leaking again” to a cited, approval-first service brief.**

Latchbook is a local, voice-first home service agent built for the Alexa+ track of the 2026 Amazon Developer Hackathon. It has a real Model Context Protocol (MCP) Streamable HTTP endpoint implementing protocol version `2025-11-25`, plus an independent web simulator that shows the same tool workflow. It does **not** claim to be a deployed Alexa+ add-on or to use gated Alexa+ developer tools.

The agent identifies an appliance, retrieves relevant home records, checks the recorded warranty date, reviews case history, and drafts a service case. A human must explicitly approve before the brief is marked shareable. Nothing is sent, booked, purchased, or changed outside this local application.

## Why this is more than Q&A

The product addresses the messy moment *before* service: people repeat a problem without the model number, prior incident, manual warning, or warranty context. A generic chatbot can answer a question; Latchbook keeps a persistent local repair history and turns a spoken observation into a sourced, reviewable handoff.

The simulator's natural-language router is intentionally narrow and deterministic—no paid model or hidden cloud service. The actual Alexa+-track integration is the MCP server, whose tools can be discovered and invoked by a compatible MCP client. The simulator demonstrates the intended voice + visual experience without pretending to be the restricted Alexa+ preview toolkit.

## Run at zero software cost

Requires Node.js 22 or newer. No `npm install` is necessary because the application has no runtime dependencies.

```bash
npm start
```

Open <http://127.0.0.1:8787>. The server binds to localhost only. Typed input works in every modern browser; voice input uses the browser's Speech Recognition API when available. All sample appliance names and documents are fictional. You can paste a user-owned plain-text note to demonstrate live retrieval beyond the seed records.

```bash
npm test
```

The tests verify MCP initialization, tool discovery and invocation, strict local-origin/version handling, the five-tool agent sequence, persistence, citations, warranty caveats, approval gating, and user-added record retrieval.

## MCP connection

- Endpoint: `http://127.0.0.1:8787/mcp`
- Transport: Streamable HTTP, JSON-RPC 2.0, JSON response mode (no SSE stream)
- Protocol version: `2025-11-25`
- State: stateless MCP transport; household case data persists in `data/home.json`
- Supported methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`
- Tools: `find_appliance`, `search_home_records`, `check_warranty`, `list_service_cases`, `draft_service_case`, `approve_service_case`, `close_service_case`, `add_home_record`

The server requires both `application/json` and `text/event-stream` in the MCP POST `Accept` header, accepts the protocol-version header after initialization, returns 202 for the initialized notification, and returns 405 for GET because it does not offer SSE. It validates local `Host` and `Origin` headers; it is **not** a publicly hosted multi-user service.

See [architecture](docs/ARCHITECTURE.md) for the trust boundary and [hackathon audit](docs/HACKATHON_AUDIT.md) for exact submission requirements.

## Demo path

1. Choose **The washer is leaking again**. Watch the five real tool steps and the citations to a fictional manual and prior incident.
2. Inspect the recorded warranty caveat and draft-only state. Ask **What is the washer case status?** to prove memory across turns.
3. Click **Review & approve brief**, type the human approver's name, then copy the service brief. Nothing is sent externally.
4. Add a plain-text note, ask about the appliance again, and observe the note appearing as a citable record.
5. Try **The dishwasher will not drain** to demonstrate a second appliance with a different recorded warranty status.

## Repository map

```text
src/seed.mjs        Fictional demo appliances and records
src/store.mjs       Atomic local JSON persistence
src/tools.mjs       The eight domain/MCP tools
src/agent.mjs       Multi-step simulator orchestrator and brief builder
src/mcp.mjs         MCP 2025-11-25 JSON-RPC lifecycle and tool dispatch
server.mjs          Local HTTP app, simulator routes, and /mcp endpoint
public/             Responsive voice/text/visual simulator
test/               Protocol and workflow tests
```

## Boundaries and next steps

- This prototype does not ingest PDFs or run OCR; user-added records are plain text only.
- Warranty status is a comparison with a stored date, **not** an actual coverage determination.
- Manual excerpts are fictional; they are not real manufacturer instructions or a substitute for a qualified professional.
- The browser speech API is optional and browser-dependent. The typed path is fully functional.
- No contractor marketplace, calendar, email, or Alexa production account is connected. The brief is for a human to review and share.
- A production version would need authentication, household isolation, encryption, consent controls, real integrations, and provider verification before remote hosting.

## License

MIT © 2026 Rehan Raza
