import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildApp } from "../../api/src/app.js";
import { hashTeamToken, type TeamRole } from "../../api/src/auth.js";
import { InMemoryLessonRepository } from "../../api/src/repository.js";
import { demoCandidate, demoLessons } from "../../../packages/contracts/src/demo.js";
import { XchangeClient, XchangeError, validateApiOrigin, type Access } from "./client.js";
import { createXchangeMcpServer, getToolCatalog } from "./tools.js";

const scope = { teamId: "mcp-tests", projectId: "workspace" };
const token = "synthetic-mcp-credential-not-a-real-secret";
const actorId = "agent-test";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

async function fixture(t: TestContext, role: TeamRole = "writer") {
  const repository = new InMemoryLessonRepository([
    { ...demoLessons[0]!, ...scope, id: "shared-lesson" },
    { ...demoLessons[0]!, ...scope, id: "private-lesson", projectId: "private" },
  ]);
  const app = buildApp({ repository, scope, storage: "memory", token: "unused",
    teamAuth: { grants: [{ actorId, tokenHash: hashTeamToken(token), role }], sessionSecret: "synthetic-session-signing-secret-for-tests", publicOrigin: "https://xchange.test" } });
  const calls: { path: string; method: string }[] = [];
  const control: { override?: (path: string, init?: RequestInit) => Response | undefined } = {};
  const api = new XchangeClient({ origin: "https://xchange.test", token, expectedScope: scope, expectedMode: "team",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname + url.search;
      calls.push({ path, method: init?.method ?? "GET" });
      const override = control.override?.(path, init);
      if (override) return override;
      const response = await app.inject({ method: (init?.method ?? "GET") as "GET" | "POST" | "PUT", url: path,
        headers: Object.fromEntries(new Headers(init?.headers)), ...(init?.body ? { payload: String(init.body) } : {}) });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": String(response.headers["content-type"]) } });
    } });
  const access = await api.verifyAccess();
  const server = createXchangeMcpServer(api, access);
  const mcp = new Client({ name: "synthetic-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  t.after(async () => { await mcp.close(); await server.close(); await app.close(); });
  return { api, access, server, mcp, repository, app, control, calls };
}

async function call(mcp: Client, name: string, args: Record<string, unknown> = {}) {
  return await mcp.callTool({ name, arguments: args }) as CallToolResult;
}
function errorOf(result: Awaited<ReturnType<typeof call>>) {
  assert.equal(result.isError, true);
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find(block => block.type === "text")!.text!) as { error: string; message: string; status?: number };
}

test("SDK discovery exposes typed role-filtered tools, accurate hints and no privilege escalation", async t => {
  const writer = await fixture(t);
  const listed = (await writer.mcp.listTools()).tools;
  assert.equal(listed.length, 14);
  assert.deepEqual(listed.map(tool => tool.name), getToolCatalog(writer.access).map(tool => tool.name));
  const memory = listed.find(tool => tool.name === "xchange_load_memory")!;
  assert.equal(memory.annotations?.readOnlyHint, false);
  assert.equal(memory.annotations?.idempotentHint, false);
  assert.equal(listed.find(tool => tool.name === "xchange_inspect_harness")!.annotations?.readOnlyHint, true);
  const create = listed.find(tool => tool.name === "xchange_create_ticket")!;
  assert.ok(create.inputSchema.required?.includes("operationId"));
  assert.equal(create.inputSchema.additionalProperties, false);
  const canvas = listed.find(tool => tool.name === "xchange_save_canvas")!;
  assert.ok(canvas.inputSchema.required?.includes("expectedRevision"));
  assert.ok(!listed.some(tool => /evaluate|rollback|credential|query|update_ticket/.test(tool.name)));
  const reader = await fixture(t, "reader");
  assert.equal((await reader.mcp.listTools()).tools.length, 10);
  const before = reader.calls.length;
  assert.equal((await call(reader.mcp, "xchange_create_ticket", { operationId: randomUUID(), ticket: { summary: "Forbidden" } })).isError, true);
  assert.equal(reader.calls.length, before);
  const evaluator = await fixture(t, "evaluator");
  assert.equal((await evaluator.mcp.listTools()).tools.length, 14);
});

test("typed reads stay scoped and distinguish harness inspection from audited memory loading", async t => {
  const { mcp, repository, calls } = await fixture(t, "reader");
  const catalog = await call(mcp, "xchange_catalog");
  assert.deepEqual((catalog.structuredContent!.lessons as { id: string }[]).map(item => item.id), ["shared-lesson"]);
  assert.equal(errorOf(await call(mcp, "xchange_read_lesson", { id: "private-lesson" })).status, 404);
  assert.equal((await call(mcp, "xchange_read_lesson", { id: "shared-lesson" })).structuredContent!.id, "shared-lesson");
  const before = (await repository.listAudit(scope)).events.length;
  await call(mcp, "xchange_inspect_harness");
  assert.equal((await repository.listAudit(scope)).events.length, before);
  const memory = await call(mcp, "xchange_load_memory");
  assert.equal((memory.structuredContent!.lessons as unknown[]).length, 1);
  const consumption = (await repository.listAudit(scope)).events.filter(event => event.kind === "memory.consumed");
  assert.equal(consumption.length, 1);
  assert.equal(consumption[0]!.actorId, actorId);
  assert.equal(calls.filter(item => item.path === "/v1/access").length, 6);
});

test("ticket writes require UUID operation keys, preserve content and reject conflicting retries", async t => {
  const { mcp, calls } = await fixture(t);
  const before = calls.length;
  assert.equal((await call(mcp, "xchange_create_ticket", { ticket: { summary: "Need a key" } })).isError, true);
  assert.equal((await call(mcp, "xchange_create_ticket", { operationId: "invalid", ticket: { summary: "Bad key" } })).isError, true);
  assert.equal((await call(mcp, "xchange_create_ticket", { operationId: randomUUID(), ticket: { summary: "No status override", status: "done" } })).isError, true);
  assert.equal(calls.length, before);
  const operationId = randomUUID();
  const ticket = { summary: "Use individual credentials", description: "Human text: keep it exactly as supplied.\nSecond line." };
  const created = await call(mcp, "xchange_create_ticket", { operationId, ticket });
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent!.id, operationId);
  assert.equal(created.structuredContent!.description, ticket.description);
  assert.equal(created.structuredContent!.status, "open");
  const replay = await call(mcp, "xchange_create_ticket", { operationId, ticket });
  assert.deepEqual(replay.structuredContent, created.structuredContent);
  assert.equal(errorOf(await call(mcp, "xchange_create_ticket", { operationId, ticket: { summary: "Changed" } })).status, 409);
  const read = await call(mcp, "xchange_read_ticket", { id: operationId });
  assert.deepEqual(read.structuredContent, created.structuredContent);
  assert.equal(calls.filter(item => item.method === "POST").length, 3);
});

test("canvas writes enforce observed revisions, preserve retries and resolve scoped references", async t => {
  const { mcp } = await fixture(t);
  const ticketId = randomUUID();
  await call(mcp, "xchange_create_ticket", { operationId: ticketId, ticket: { summary: "Harness proof" } });
  const id = randomUUID(), operationId = randomUUID();
  const canvas = { title: "What improves agent work?", description: "Evidence and next steps", nodes: [
    { id: "ticket", kind: "record", x: 0, y: 0, color: "amber", ref: { kind: "ticket", id: ticketId } },
  ], edges: [] };
  const created = await call(mcp, "xchange_save_canvas", { id, operationId, expectedRevision: 0, canvas });
  assert.equal(created.isError, undefined);
  assert.equal((created.structuredContent!.record as { revision: number }).revision, 1);
  assert.equal((created.structuredContent!.references as { id: string }[])[0]!.id, ticketId);
  const replay = await call(mcp, "xchange_save_canvas", { id, operationId, expectedRevision: 0, canvas });
  assert.deepEqual(replay.structuredContent, created.structuredContent);
  assert.equal(errorOf(await call(mcp, "xchange_save_canvas", { id, operationId: randomUUID(), expectedRevision: 0, canvas })).status, 409);
  const latest = await call(mcp, "xchange_read_canvas", { id });
  assert.deepEqual(latest.structuredContent, created.structuredContent);
  assert.equal((await call(mcp, "xchange_save_canvas", { id, operationId: randomUUID(), canvas })).isError, true);
});

test("activity validates evidence chains and lesson proposals remain candidates with bound authors", async t => {
  const { mcp, repository } = await fixture(t);
  const id = randomUUID();
  const observation = { kind: "observation", title: "Shared access needs scope", detail: "Our synthetic client could read only its assigned workspace.", evidence: [{ reference: "test:mcp/scoping", summary: "An out-of-scope lesson returned 404." }] };
  const created = await call(mcp, "xchange_record_activity", { operationId: id, activity: observation });
  assert.equal(created.structuredContent!.actorLabel, actorId);
  assert.deepEqual((await call(mcp, "xchange_read_activity", { id })).structuredContent, created.structuredContent);
  const page = await call(mcp, "xchange_list_activity", { rootKind: "activity", rootId: id, limit: 1 });
  assert.equal((page.structuredContent!.records as unknown[]).length, 1);
  assert.equal((await call(mcp, "xchange_list_activity", { rootKind: "activity" })).isError, true);
  assert.equal((await call(mcp, "xchange_record_activity", { operationId: randomUUID(), activity: { ...observation, kind: "outcome" } })).isError, true);
  const { authorId: _ignored, ...candidate } = demoCandidate;
  const lesson = await call(mcp, "xchange_propose_lesson", { operationId: randomUUID(), candidate });
  assert.equal(lesson.structuredContent!.status, "candidate");
  assert.equal(lesson.structuredContent!.authorId, actorId);
  assert.equal((await repository.activeHarness(scope)).lessons.length, 1);
  assert.equal((await call(mcp, "xchange_propose_lesson", { operationId: randomUUID(), candidate: { ...candidate, authorId: "impersonated" } })).isError, true);
  assert.equal((await call(mcp, "xchange_propose_lesson", { operationId: randomUUID(), candidate: { ...candidate, status: "published" } })).isError, true);
});

test("every call rejects revoked credentials, changed scope and changed roles before accessing records", async t => {
  const { mcp, control, calls, access } = await fixture(t);
  control.override = path => path === "/v1/access" ? json({ error: "raw upstream detail must not leak" }, 401) : undefined;
  let before = calls.length;
  const revoked = errorOf(await call(mcp, "xchange_catalog"));
  assert.equal(revoked.status, 401);
  assert.equal(calls.length, before + 1);
  assert.ok(!revoked.message.includes("raw upstream"));
  for (const changed of [{ ...access, scope: { ...scope, projectId: "other" } }, { ...access, role: "reader" }, { ...access, actorId: "someone-else" }]) {
    control.override = path => path === "/v1/access" ? json(changed) : undefined;
    before = calls.length;
    assert.equal(errorOf(await call(mcp, "xchange_create_ticket", { operationId: randomUUID(), ticket: { summary: "Blocked" } })).status, 403);
    assert.equal(calls.length, before + 1);
  }
});

test("tools reject malformed or out-of-scope upstream records rather than leaking them", async t => {
  const { mcp, control } = await fixture(t);
  control.override = path => path === "/v1/lessons" ? json({ scope, lessons: [{ ...demoLessons[0]!, ...scope, projectId: "private" }] }) : undefined;
  const result = await call(mcp, "xchange_catalog");
  assert.equal(errorOf(result).error, "scope_mismatch");
  assert.equal(result.structuredContent, undefined);
  control.override = path => path === "/v1/lessons" ? json({ scope, lessons: [{ title: "Incomplete" }] }) : undefined;
  assert.equal(errorOf(await call(mcp, "xchange_catalog")).error, "invalid_response");
});

test("fixed origin, redirects, payload/response bounds and upstream errors are enforced without retries", async () => {
  assert.equal(validateApiOrigin("http://127.0.0.1:4317"), "http://127.0.0.1:4317");
  assert.equal(validateApiOrigin("https://xchange.test/"), "https://xchange.test");
  for (const value of ["http://remote.test", "https://name:password@xchange.test", "https://xchange.test/path", "https://xchange.test?token=secret", "file:///tmp/data"]) assert.throws(() => validateApiOrigin(value), XchangeError);
  let attempts = 0;
  const api = new XchangeClient({ origin: "https://xchange.test", token, fetch: async (_url, init) => {
    attempts++;
    assert.equal(init?.redirect, "error");
    return json({ secret: "never return this" }, 409);
  } });
  await assert.rejects(api.request("/v1/tickets", "POST", {}, randomUUID()), (error: unknown) => error instanceof XchangeError && error.status === 409 && !error.message.includes("never return"));
  assert.equal(attempts, 1);
  await assert.rejects(api.request("https://other.test/v1/tickets"), XchangeError);
  await assert.rejects(api.request("/v1/../../tickets"), XchangeError);
  await assert.rejects(api.request("/v1/tickets", "POST", {}), XchangeError);
  await assert.rejects(api.request("/v1/tickets", "POST", { text: "a".repeat(512 * 1024) }, randomUUID()), XchangeError);
  assert.equal(attempts, 1);
  const redirect = new XchangeClient({ origin: "https://xchange.test", token, fetch: async () => new Response(null, { status: 302, headers: { location: "https://other.test" } }) });
  await assert.rejects(redirect.request("/v1/access"), (error: unknown) => error instanceof XchangeError && error.code === "redirect");
  const large = new XchangeClient({ origin: "https://xchange.test", token, maxResponseBytes: 64, fetch: async () => json({ text: "a".repeat(100) }) });
  await assert.rejects(large.request("/v1/access"), (error: unknown) => error instanceof XchangeError && error.code === "too_large");
  const malformed = new XchangeClient({ origin: "https://xchange.test", token, fetch: async () => new Response("not JSON", { headers: { "content-type": "application/json" } }) });
  await assert.rejects(malformed.request("/v1/access"), (error: unknown) => error instanceof XchangeError && error.code === "invalid_response");
});

test("access verification rejects misconfigured expected scope or hosted mode", async () => {
  const access: Access = { mode: "local", actorId, role: "owner", scope };
  const api = new XchangeClient({ origin: "http://127.0.0.1:4317", token, expectedMode: "team", expectedScope: scope, fetch: async () => json(access) });
  await assert.rejects(api.verifyAccess(), (error: unknown) => error instanceof XchangeError && error.code === "access_changed");
  const wrongScope = new XchangeClient({ origin: "https://xchange.test", token, expectedScope: { ...scope, teamId: "other" }, fetch: async () => json({ ...access, mode: "team", role: "writer" }) });
  await assert.rejects(wrongScope.verifyAccess(), (error: unknown) => error instanceof XchangeError && error.code === "access_changed");
});

test("timeouts abort the request and retain a safe uncertain-write message without retry", async () => {
  let attempts = 0;
  const api = new XchangeClient({ origin: "https://xchange.test", token, timeoutMs: 5,
    fetch: async (_url, init) => {
      attempts++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("synthetic network detail")), { once: true });
      });
    } });
  await assert.rejects(api.request("/v1/tickets", "POST", { summary: "Uncertain result" }, randomUUID()),
    (error: unknown) => error instanceof XchangeError && error.code === "timeout" && error.message.includes("operation UUID") && !error.message.includes("synthetic network detail"));
  assert.equal(attempts, 1);
});

test("the deadline bounds signal-ignoring fetches and cancels a late response without retry", { timeout: 1000 }, async () => {
  let finish!: (response: Response) => void;
  let attempts = 0, cancellations = 0;
  let signal: AbortSignal | null | undefined;
  const api = new XchangeClient({ origin: "https://xchange.test", token, timeoutMs: 5,
    fetch: async (_url, init) => {
      attempts++;
      signal = init?.signal;
      return new Promise<Response>(resolve => { finish = resolve; });
    } });
  await assert.rejects(api.request("/v1/tickets", "POST", { summary: "May have saved" }, randomUUID()),
    (error: unknown) => error instanceof XchangeError && error.code === "timeout" && error.message.includes("operation UUID"));
  assert.equal(signal?.aborted, true);
  const body = new ReadableStream<Uint8Array>({ cancel() { cancellations++; } });
  finish(new Response(body, { headers: { "content-type": "application/json" } }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert.equal(attempts, 1);
});

test("the deadline bounds stalled response streams even if cancellation never settles", { timeout: 1000 }, async () => {
  let cancellations = 0, attempts = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); },
    cancel() { cancellations++; return new Promise<void>(() => {}); },
  });
  const api = new XchangeClient({ origin: "https://xchange.test", token, timeoutMs: 5,
    fetch: async () => { attempts++; return new Response(body, { headers: { "content-type": "application/json" } }); } });
  await assert.rejects(api.request("/v1/access"), (error: unknown) => error instanceof XchangeError && error.code === "timeout");
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
  assert.equal(attempts, 1);
});

test("error-body cleanup cannot hang or replace a sanitized upstream conflict", { timeout: 1000 }, async () => {
  let cancellations = 0;
  const api = new XchangeClient({ origin: "https://xchange.test", token, timeoutMs: 5,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() { cancellations++; return new Promise<void>(() => {}); },
    }), { status: 409, headers: { "content-type": "application/json" } }) });
  await assert.rejects(api.request("/v1/tickets", "POST", {}, randomUUID()),
    (error: unknown) => error instanceof XchangeError && error.code === "conflict" && error.status === 409);
  assert.equal(cancellations, 1);
});
