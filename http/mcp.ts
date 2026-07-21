import type { Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../mcp/server.js";
import { getScope } from "./auth.js";

/**
 * Handle an MCP request over Streamable HTTP (Web Standard transport, stateless).
 * A fresh transport + server is created per request; the token scope decides
 * whether outbound messaging operations are allowed.
 */
export async function handleMcp(c: Context): Promise<Response> {
	const scope = getScope(c);
	const transport = new WebStandardStreamableHTTPServerTransport();
	const server = createMcpServer({ allowMessaging: scope === "full" });
	await server.connect(transport);
	return transport.handleRequest(c.req.raw);
}
