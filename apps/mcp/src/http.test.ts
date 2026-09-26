import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildApp } from "../../api/src/app.js";
import { hashTeamToken, type TeamAuthConfig } from "../../api/src/auth.js";
import { createHostedHandler } from "../../api/src/hosted.js";
import { InMemoryLessonRepository } from "../../api/src/repository.js";
import { createMcpHttpHandler } from "./http.js";

const origin = "https://xchange.example.test";
const scope = { teamId: "mcp-http-test", projectId: "synthetic" };
const tokens = { writer: "synthetic-mcp-writer-token-123456789", reader: "synthetic-mcp-reader-token-123456789" };
function fixture() {
  const teamAuth: TeamAuthConfig = { grants: [
    { actorId: "mcp-writer", tokenHash: hashTeamToken(tokens.writer), role: "writer" },
    { actorId: "mcp-reader", tokenHash: hashTeamToken(tokens.reader), role: "reader" },
  ], sessionSecret: "synthetic-mcp-http-session-secret-123456789", publicOrigin: origin, guestRead: true };
  const app = buildApp({ repository: new InMemoryLessonRepository(), teamAuth, scope, storage: "memory", token: "disabled" });
  const apiHandler = createHostedHandler(async () => app);
  const apiFetch: typeof fetch = async (input, init) => apiHandler(new Request(input, init));
  const handler = createMcpHttpHandler({ apiOrigin: origin, publicOrigin: origin, expectedScope: scope, fetch: apiFetch });
  return { app, handler };
}
async function connect(handler: (request: Request) => Promise<Response>, token: string) {
  const client = new Client({ name: "synthetic-mcp-http-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (input, init) => handler(new Request(input, init)),
  }));
  return client;
}

test("HTTP MCP uses per-request credentials and preserves API receipts and reader boundaries", async () => {
  const { app, handler } = fixture();
  const clients: Client[] = [];
  try {
    const [writer, reader] = await Promise.all([connect(handler, tokens.writer), connect(handler, tokens.reader)]);
    clients.push(writer, reader);
    const [writerTools, readerTools] = await Promise.all([writer.listTools(), reader.listTools()]);
    assert.equal(writerTools.tools.length, 14);
    assert.equal(readerTools.tools.length, 10);
    assert.equal(readerTools.tools.some(tool => tool.name === "xchange_create_ticket"), false);
    const operationId = randomUUID();
    const input = { name: "xchange_create_ticket", arguments: { operationId, ticket: { summary: "Synthetic MCP receipt" } } };
    const first = await writer.callTool(input) as CallToolResult;
    assert.equal(first.isError, undefined);
    assert.equal(first.structuredContent?.id, operationId);
    assert.deepEqual((await writer.callTool(input)).structuredContent, first.structuredContent);
    assert.equal((await reader.callTool(input)).isError, true);
    assert.equal((await reader.callTool({ name: "xchange_read_ticket", arguments: { id: operationId } }) as CallToolResult).structuredContent?.id, operationId);
    const [writerAccess, readerAccess] = await Promise.all([
      writer.callTool({ name: "xchange_access", arguments: {} }), reader.callTool({ name: "xchange_access", arguments: {} }),
    ]);
    assert.equal((writerAccess as CallToolResult).structuredContent?.actorId, "mcp-writer");
    assert.equal((readerAccess as CallToolResult).structuredContent?.actorId, "mcp-reader");
    const activity = await writer.callTool({ name: "xchange_record_activity", arguments: {
      operationId: randomUUID(), activity: { kind: "observation", title: "Synthetic attribution", detail: "Check the authenticated actor.", evidence: [{ reference: "test:mcp-http", summary: "Isolated fixture." }] },
    } }) as CallToolResult;
    assert.equal(activity.structuredContent?.actorLabel, "mcp-writer");
  } finally { await Promise.all(clients.map(client => client.close())); await app.close(); }
});

test("HTTP MCP denies anonymous/cookie/invalid callers, foreign Origin and oversized protocol payloads", async () => {
  const { app, handler } = fixture();
  try {
    assert.equal((await handler(new Request(`${origin}/mcp`, { method: "POST" }))).status, 401);
    assert.equal((await handler(new Request(`${origin}/mcp`, { method: "POST", headers: { cookie: "session=not-mcp-auth" } }))).status, 401);
    const headers = { authorization: `Bearer ${tokens.reader}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    assert.equal((await handler(new Request(`${origin}/mcp`, { method: "POST", headers: { ...headers, authorization: "Bearer revoked" } }))).status, 401);
    assert.equal((await handler(new Request(`${origin}/mcp`, { method: "POST", headers: { ...headers, origin: "https://foreign.example.test" } }))).status, 403);
    assert.equal((await handler(new Request(`${origin}/mcp`, { headers }))).status, 405);
    assert.equal((await handler(new Request(`${origin}/mcp`, { method: "POST", headers, body: "x".repeat(512 * 1024 + 1) }))).status, 413);
    const response = await handler(new Request(`${origin}/mcp`, { method: "POST", headers, body: "not JSON" }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally { await app.close(); }
});

test("HTTP MCP rejects a local owner API even with a bearer token", async () => {
  const handler = createMcpHttpHandler({ apiOrigin: origin, publicOrigin: origin, expectedScope: scope,
    fetch: async () => Response.json({ mode: "local", actorId: "owner", role: "owner", scope }),
  });
  const response = await handler(new Request(`${origin}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokens.writer}` } }));
  assert.equal(response.status, 403);
});
