# Architecture and safety boundary

```text
Browser speech/text -> simulator agent -> same domain tools exposed through /mcp
                                      | find appliance
                                      | search local records
                                      | compare recorded warranty date
                                      | review prior cases
                                      | draft persistent case
                                      v
                             explicit human approval
                                      v
                             local shareable service brief
```

The app runs on localhost by default. It neither transmits household data to a model provider nor uses an Alexa preview API. The web simulator is a transparent demonstration of an Alexa+-style interaction. A compatible MCP client can independently initialize the `2025-11-25` Streamable HTTP endpoint and call the same tools.

## Agentic sequence

For a recognized appliance issue, `runAgentTurn` calls five tools in order: `find_appliance`, `search_home_records`, `check_warranty`, `list_service_cases`, and `draft_service_case`. The result includes an inspectable tool trace, citations to local record IDs, the caveated warranty date, and a persistent draft. Subsequent status questions read the saved case. The narrow deterministic router is intentional: a judge can reproduce the workflow without an LLM account, paid API, or prompt-induced hallucination.

## Approval model

The agent never calls `approve_service_case` from speech or text alone. The simulator requires a visible confirmation dialog with an approver name. MCP clients receive a tool description requiring explicit human confirmation; a production MCP host must enforce that requirement at the client/identity layer. Approval in this prototype changes only local state. It is not a provider communication, booking, warranty claim, purchase, or repair order.

## Data and reliability

`JsonStore` serializes changes through a promise queue and writes a temporary JSON file before rename. Sample data are fictional. A custom plain-text note is saved in `data/home.json`, ignored by Git. The simulator and MCP tools share this same store. Tests create isolated temporary stores and verify the real HTTP protocol and workflow.

## MCP transport profile

- Version: `2025-11-25` only.
- One `/mcp` endpoint; each client message is a POST. Requests return JSON-RPC JSON, notifications return HTTP 202. GET returns 405 because this server does not offer a listening SSE stream.
- No MCP session ID is assigned; transport is stateless. Persistent home cases are application state, not transport sessions.
- Accept header must include `application/json` and `text/event-stream`, as specified for Streamable HTTP clients.
- Local-only Host/Origin validation helps prevent browser cross-origin and DNS-rebinding use. Remote/multi-user access is out of scope.

Primary standards: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
