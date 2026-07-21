import { describe, it, expect } from "bun:test";
import { readHttpConfig } from "../../http/env.js";

describe("readHttpConfig", () => {
	it("throws when no token is set", () => {
		expect(() => readHttpConfig({})).toThrow(/token/i);
	});

	it("throws when full and readonly tokens are identical", () => {
		expect(() =>
			readHttpConfig({ MCP_AUTH_TOKEN: "same", MCP_READONLY_TOKEN: "same" }),
		).toThrow(/distinct/i);
	});

	it("defaults host/port and accepts a readonly-only token", () => {
		const cfg = readHttpConfig({ MCP_READONLY_TOKEN: "r" });
		expect(cfg.host).toBe("0.0.0.0");
		expect(cfg.port).toBe(3737);
		expect(cfg.fullToken).toBeUndefined();
		expect(cfg.readonlyToken).toBe("r");
	});

	it("parses PORT/HOST and both tokens", () => {
		const cfg = readHttpConfig({
			MCP_AUTH_TOKEN: "f",
			MCP_READONLY_TOKEN: "r",
			HOST: "127.0.0.1",
			PORT: "9494",
		});
		expect(cfg.host).toBe("127.0.0.1");
		expect(cfg.port).toBe(9494);
		expect(cfg.fullToken).toBe("f");
	});

	it("throws on invalid PORT", () => {
		expect(() => readHttpConfig({ MCP_READONLY_TOKEN: "r", PORT: "nope" })).toThrow(
			/PORT/i,
		);
	});
});
