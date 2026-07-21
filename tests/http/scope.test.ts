import { describe, it, expect } from "bun:test";
import { createMcpServer } from "../../mcp/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

async function connect(allowMessaging: boolean) {
	const server = createMcpServer({ allowMessaging });
	const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	return client;
}

describe("write-block guard", () => {
	it("read scope rejects messages:send", async () => {
		const client = await connect(false);
		const res: any = await client.callTool({
			name: "messages",
			arguments: { operation: "send", phoneNumber: "1", message: "hi" },
		});
		expect(res.isError).toBe(true);
		expect(JSON.stringify(res.content)).toMatch(/not permitted/i);
	});

	it("read scope rejects mail:send", async () => {
		const client = await connect(false);
		const res: any = await client.callTool({
			name: "mail",
			arguments: { operation: "send", to: "a@b.c", subject: "x", body: "y" },
		});
		expect(res.isError).toBe(true);
		expect(JSON.stringify(res.content)).toMatch(/not permitted/i);
	});

	it("read scope rejects messages:schedule", async () => {
		const client = await connect(false);
		const res: any = await client.callTool({
			name: "messages",
			arguments: {
				operation: "schedule",
				phoneNumber: "1",
				message: "hi",
				scheduledTime: "2030-01-01T00:00:00Z",
			},
		});
		expect(res.isError).toBe(true);
	});
});
