# Architecture and safety boundary

```text
Browser speech/text -> simulator agent -> same domain tools exposed through /mcp
                                      | recover or start an incident interview
                                      | find appliance and search local records
                                      | compare recorded warranty date
                                      | review prior cases and assess evidence
                                      | draft persistent, cited case
                                      v
                             explicit human approval
                                      v
                             local shareable service brief
                                      |
                         household-reported outcome
                                      |
                         citable record for future reports
```

The app runs on localhost by default. It neither transmits household data to a model provider nor uses an Alexa preview API. The web simulator is a transparent demonstration of an Alexa+-style interaction. A compatible MCP client can independently initialize the `2025-11-25` Streamable HTTP endpoint and call the same tools.

## Agentic sequence

For an incomplete appliance issue, `runAgentTurn` starts a symptom-specific incident interview; the next observation completes it. A detailed first report may skip that follow-up. The agent then searches local records, compares the recorded warranty date, reads prior cases, assesses source integrity, and drafts a cited persistent case. Earlier household-reported outcomes become searchable records and are linked to recurring cases. The result includes an inspectable tool trace, local record IDs, evidence signals, and a warranty caveat. The narrow deterministic router is intentional: a judge can reproduce the workflow without an LLM account, paid API, or prompt-induced hallucination.

## Approval model

The agent never calls `approve_service_case` from speech or text alone. The simulator requires a visible confirmation dialog with an approver name. MCP clients receive a tool description requiring explicit human confirmation; a production MCP host must enforce that requirement at the client/identity layer. Approval in this prototype changes only local state. It is not a provider communication, booking, warranty claim, purchase, or repair order.

## Data and reliability

`JsonStore` serializes changes through a promise queue and writes a temporary JSON file before rename. Sample data are fictional. Interviews, custom plain-text notes, cases, and household-reported outcomes are saved in `data/home.json`, ignored by Git. The simulator and MCP tools share this same store. Tests create isolated temporary stores and verify the real HTTP protocol and workflow. The evidence audit is a provenance check, not an independent fact checker or warranty decision.

## MCP transport profile

- Version: `2025-11-25` only.
- One `/mcp` endpoint; each client message is a POST. Requests return JSON-RPC JSON, notifications return HTTP 202. GET returns 405 because this server does not offer a listening SSE stream.
- No MCP session ID is assigned; transport is stateless. Persistent home cases are application state, not transport sessions.
- Accept header must include `application/json` and `text/event-stream`, as specified for Streamable HTTP clients.
- Local-only Host/Origin validation helps prevent browser cross-origin and DNS-rebinding use. Remote/multi-user access is out of scope.

Primary standards: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
