import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { XchangeClient, XchangeError, validateApiOrigin, type XchangeClientOptions } from "./client.js";
import { createXchangeMcpServer } from "./tools.js";

export interface HttpOptions {
  apiOrigin: string;
  publicOrigin: string;
  expectedScope: NonNullable<XchangeClientOptions["expectedScope"]>;
  fetch?: typeof globalThis.fetch;
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } },
    { status, headers: { "cache-control": "no-store" } });
}

/** Stateless per-caller transport: never falls back to a process/owner credential. */
export function createMcpHttpHandler(options: HttpOptions) {
  const apiOrigin = validateApiOrigin(options.apiOrigin);
  const publicOrigin = validateApiOrigin(options.publicOrigin);
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== publicOrigin) return errorResponse(403, "Origin is not allowed.");
    const authorization = request.headers.get("authorization") ?? "";
    const token = /^Bearer ([\x21-\x7e]{1,1024})$/i.exec(authorization)?.[1];
    if (!token) return errorResponse(401, "An individual Xchange bearer credential is required.");
    if (request.method !== "POST") {
      const response = errorResponse(405, "Use POST for this stateless MCP endpoint.");
      response.headers.set("allow", "POST");
      return response;
    }
    let server: ReturnType<typeof createXchangeMcpServer> | undefined;
    try {
      const client = new XchangeClient({ origin: apiOrigin, token, expectedScope: options.expectedScope,
        expectedMode: "team", fetch: options.fetch });
      const access = await client.verifyAccess();
      server = createXchangeMcpServer(client, access);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 512 * 1024,
      });
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      response.headers.set("cache-control", "no-store");
      return response;
    } catch (error) {
      const status = error instanceof XchangeError && [401, 403].includes(error.status ?? 0) ? error.status! : 503;
      return errorResponse(status, error instanceof XchangeError ? error.message : "The Xchange MCP connection is unavailable.");
    } finally {
      await server?.close();
    }
  };
}
