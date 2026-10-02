import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentTurn, buildServiceBrief } from "./src/agent.mjs";
import { MCP_VERSION, handleMcpMessage } from "./src/mcp.mjs";
import { JsonStore } from "./src/store.mjs";
import { executeTool } from "./src/tools.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const DEFAULT_STORE = new JsonStore(process.env.LATCHBOOK_DATA_FILE ?? join(ROOT, "data", "home.json"));
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:",
  });
  res.end(body === null ? undefined : contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

function isLocalRequest(req) {
  const host = String(req.headers.host ?? "").toLowerCase();
  const hostname = host.split(":")[0];
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return origin.protocol === "http:" && origin.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function bodyJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32_768) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON."); }
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname);
  const safe = normalize(requested).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, safe);
  if (!file.startsWith(`${PUBLIC}\\`) && !file.startsWith(`${PUBLIC}/`)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    send(res, 200, await readFile(file), MIME[extname(file)] ?? "application/octet-stream");
    return true;
  } catch { return false; }
}

export function createAppServer({ store = DEFAULT_STORE } = {}) {
  return createServer(async (req, res) => {
    if (!isLocalRequest(req)) return send(res, 403, { error: "Local origin required." });
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname === "/mcp") {
        if (req.method === "GET" || req.method === "DELETE") return send(res, 405, { error: "SSE and session deletion are not supported by this stateless endpoint." });
        if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
        const accept = String(req.headers.accept ?? "");
        if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
          return send(res, 406, { error: "MCP clients must accept application/json and text/event-stream." });
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "JSON required." });
        const message = await bodyJson(req);
        const version = req.headers["mcp-protocol-version"];
        if ((version && version !== MCP_VERSION) || (!version && message.method !== "initialize")) {
          return send(res, 400, { error: `MCP-Protocol-Version: ${MCP_VERSION} required.` });
        }
        const response = await handleMcpMessage(store, message);
        return send(res, response.status, response.body);
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        const state = await store.read();
        return send(res, 200, { household: state.household, appliances: state.appliances, records: state.records.map(({ text, ...rest }) => ({ ...rest, excerpt: text.slice(0, 320) })), cases: state.cases, events: state.events.slice(-12).reverse() });
      }
      if (req.method === "POST" && url.pathname === "/api/turn") {
        const input = await bodyJson(req);
        return send(res, 200, await runAgentTurn(store, input.utterance));
      }
      if (req.method === "POST" && url.pathname === "/api/approve") {
        const input = await bodyJson(req);
        return send(res, 200, await executeTool(store, "approve_service_case", input));
      }
      if (req.method === "POST" && url.pathname === "/api/close") {
        const input = await bodyJson(req);
        return send(res, 200, await executeTool(store, "close_service_case", input));
      }
      if (req.method === "POST" && url.pathname === "/api/record") {
        const input = await bodyJson(req);
        return send(res, 200, await executeTool(store, "add_home_record", input));
      }
      if (req.method === "POST" && url.pathname === "/api/reset") {
        await store.reset();
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/brief") {
        return send(res, 200, buildServiceBrief(await store.read(), url.searchParams.get("id")), "text/plain; charset=utf-8");
      }
      if (req.method === "GET" && await serveStatic(url.pathname, res)) return;
      return send(res, 404, { error: "Not found." });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log(`Latchbook simulator and MCP server ready at http://127.0.0.1:${port}`);
  });
}
