import { executeTool, TOOL_DEFINITIONS } from "./tools.mjs";

export const MCP_VERSION = "2025-11-25";

const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export async function handleMcpMessage(store, message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { status: 400, body: failure(message?.id ?? null, -32600, "Invalid JSON-RPC request") };
  }
  if (!Object.hasOwn(message, "id")) {
    if (message.method === "notifications/initialized") return { status: 202, body: null };
    return { status: 400, body: failure(null, -32600, "Unsupported notification") };
  }
  const id = message.id;
  if (message.method === "initialize") {
    return { status: 200, body: result(id, {
      protocolVersion: MCP_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "latchbook", title: "Latchbook Home Service Agent", version: "0.1.0" },
      instructions: "Local demo data only. Ask a human before approving or closing a case. No provider is contacted by these tools.",
    }) };
  }
  if (message.method === "ping") return { status: 200, body: result(id, {}) };
  if (message.method === "tools/list") return { status: 200, body: result(id, { tools: TOOL_DEFINITIONS }) };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
      return { status: 200, body: failure(id, -32602, "Unknown tool") };
    }
    try {
      const payload = await executeTool(store, name, args);
      return { status: 200, body: result(id, {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError: false,
      }) };
    } catch (error) {
      return { status: 200, body: result(id, {
        content: [{ type: "text", text: error.message }],
        isError: true,
      }) };
    }
  }
  return { status: 200, body: failure(id, -32601, "Method not found") };
}
