#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	createMcpServer,
	loadModule,
	resetModuleCache,
	setSafeMode,
} from "./mcp/server";

// Safe mode implementation - lazy loading of modules
let useEagerLoading = true;
let loadingTimeout: ReturnType<typeof setTimeout> | null = null;

console.error("Starting apple-mcp server...");

// Set a timeout to switch to safe mode if initialization takes too long
loadingTimeout = setTimeout(() => {
	console.error(
		"Loading timeout reached. Switching to safe mode (lazy loading...)",
	);
	useEagerLoading = false;
	setSafeMode(true);
	resetModuleCache();
	start();
}, 5000); // 5 second timeout

// Eager loading attempt — warms the module cache in mcp/server.ts.
async function attemptEagerLoading() {
	try {
		console.error("Attempting to eagerly load modules...");

		await loadModule("contacts");
		console.error("- Contacts module loaded successfully");

		await loadModule("notes");
		console.error("- Notes module loaded successfully");

		await loadModule("message");
		console.error("- Message module loaded successfully");

		await loadModule("mail");
		console.error("- Mail module loaded successfully");

		await loadModule("reminders");
		console.error("- Reminders module loaded successfully");

		await loadModule("calendar");
		console.error("- Calendar module loaded successfully");

		await loadModule("maps");
		console.error("- Maps module loaded successfully");

		if (loadingTimeout) {
			clearTimeout(loadingTimeout);
			loadingTimeout = null;
		}

		console.error("All modules loaded successfully, using eager loading mode");
		start();
	} catch (error) {
		console.error("Error during eager loading:", error);
		console.error("Switching to safe mode (lazy loading)...");

		if (loadingTimeout) {
			clearTimeout(loadingTimeout);
			loadingTimeout = null;
		}

		useEagerLoading = false;
		setSafeMode(true);
		resetModuleCache();

		start();
	}
}

// Attempt eager loading first
attemptEagerLoading();

// Ensure the transport is started at most once (timeout + eager paths race).
let started = false;

async function start(): Promise<void> {
	if (started) return;
	started = true;

	if (loadingTimeout) {
		clearTimeout(loadingTimeout);
		loadingTimeout = null;
	}

	const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
	if (transport === "http") {
		const { startHttpServer } = await import("./http/server");
		await startHttpServer();
	} else {
		await startStdio();
	}
}

async function startStdio(): Promise<void> {
	const server = createMcpServer({ allowMessaging: true });

	console.error("Setting up MCP server transport...");
	console.error("Initializing transport...");
	const transport = new StdioServerTransport();

	// Ensure stdout is only used for JSON messages
	console.error("Setting up stdout filter...");
	const originalStdoutWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
		if (typeof chunk === "string" && !chunk.startsWith("{")) {
			console.error("Filtering non-JSON stdout message");
			return true; // Silently skip non-JSON messages
		}
		return originalStdoutWrite(chunk, encoding, callback);
	}) as typeof process.stdout.write;

	try {
		console.error("Connecting transport to server...");
		await server.connect(transport);
		console.error("Server connected successfully (stdio)!");
	} catch (error) {
		console.error("Failed to initialize MCP server:", error);
		process.exit(1);
	}
}
