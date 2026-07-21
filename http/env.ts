export interface HttpConfig {
	host: string;
	port: number;
	fullToken?: string;
	readonlyToken?: string;
}

/**
 * Read + validate HTTP-mode configuration from an environment map.
 * Fails closed: throws unless at least one bearer token is configured.
 */
export function readHttpConfig(
	env: Record<string, string | undefined>,
): HttpConfig {
	const fullToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
	const readonlyToken = env.MCP_READONLY_TOKEN?.trim() || undefined;

	if (!fullToken && !readonlyToken) {
		throw new Error(
			"HTTP mode requires MCP_AUTH_TOKEN and/or MCP_READONLY_TOKEN to be set (fail-closed).",
		);
	}
	if (fullToken && readonlyToken && fullToken === readonlyToken) {
		throw new Error("MCP_AUTH_TOKEN and MCP_READONLY_TOKEN must be distinct.");
	}

	const port = env.PORT ? Number.parseInt(env.PORT, 10) : 3737;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT: ${env.PORT}`);
	}

	return {
		host: env.HOST?.trim() || "0.0.0.0",
		port,
		fullToken,
		readonlyToken,
	};
}
