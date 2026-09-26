import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { CanvasInputSchema, CanvasResponseSchema, type CanvasWrite } from "../../../packages/contracts/src/canvas.js";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository } from "./repository.js";
import { InMemoryTicketRepository } from "./tickets.js";
import { CanvasConflict, InMemoryCanvasRepository, MongoCanvasRepository } from "./canvases.js";
import { loadConfig } from "./config.js";
const scope = { teamId: "canvas-test-team", projectId: "canvas-test-project" };
const input: CanvasWrite = { expectedRevision: 0, canvas: { title: "Shared investigation", description: "", nodes: [{ kind: "note", id: "note", x: 40, y: 40, color: "sage", title: "Observation", text: "Literal <script>alert(1)</script>" }], edges: [] } };

test("canvas boundary rejects executable fields, bad geometry and broken graphs", () => {
  for (const canvas of [
    { ...input.canvas, html: "<script/>" },
    { ...input.canvas, nodes: [{ ...input.canvas.nodes[0], x: Infinity }] },
    { ...input.canvas, nodes: [{ ...input.canvas.nodes[0], color: "url(evil)" }] },
    { ...input.canvas, nodes: [...input.canvas.nodes, ...input.canvas.nodes] },
    { ...input.canvas, edges: [{ id: "edge", from: "note", to: "missing", label: "" }] },
    { ...input.canvas, edges: [{ id: "edge", from: "note", to: "note", label: "" }] },
  ]) assert.equal(CanvasInputSchema.safeParse(canvas).success, false);
  assert.equal(CanvasInputSchema.parse(input.canvas).nodes[0]!.kind, "note");
});

test("canvas API authenticates, resolves scoped records, and rejects stale writes", async () => {
  const canvases = new InMemoryCanvasRepository();
  const lessons = new InMemoryLessonRepository([{ ...demoLessons[0]!, ...scope }]);
  const tickets = new InMemoryTicketRepository();
  const foreign = await tickets.create({ ...scope, projectId: "other" }, randomUUID(), { summary: "Foreign", description: "", component: "", key: "FOREIGN", acceptanceCriteria: [] });
  const app = buildApp({ repository: lessons, tickets, canvases, token: "test", scope, storage: "memory" });
  const id = randomUUID(); const op = randomUUID();
  const headers = { authorization: "Bearer test", "idempotency-key": op, "x-engineer-id": "agent-a" };
  try {
    assert.equal((await app.inject({ url: "/v1/canvases" })).statusCode, 401);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, payload: input })).statusCode, 401);
    assert.equal((await app.inject({ url: "/v1/canvas-schema", headers })).statusCode, 200);
    const invalid = { ...input, canvas: { ...input.canvas, nodes: [{ id: "foreign", kind: "record", x: 0, y: 0, color: "neutral", ref: { kind: "ticket", id: foreign.id } }] } };
    assert.equal((await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers, payload: invalid })).statusCode, 400);
    const payload = { ...input, canvas: { ...input.canvas, nodes: [...input.canvas.nodes, { kind: "record", id: "lesson", x: 360, y: 40, color: "neutral", ref: { kind: "lesson", id: demoLessons[0]!.id } }], edges: [{ id: "edge", from: "note", to: "lesson", label: "informed" }] } };
    const created = await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers, payload });
    assert.equal(created.statusCode, 200, created.body);
    const first = CanvasResponseSchema.parse(created.json());
    assert.equal(first.record.revision, 1); assert.equal(first.references[0]!.title, demoLessons[0]!.title);
    assert.equal(first.record.editorLabel, "agent-a");
    assert.deepEqual((await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers, payload })).json(), created.json());
    assert.equal((await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers, payload: { ...payload, canvas: { ...payload.canvas, title: "Changed" } } })).statusCode, 409);
    const changed = { ...payload, expectedRevision: 1, canvas: { ...payload.canvas, title: "Agent B update" } };
    assert.equal((await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers: { ...headers, "idempotency-key": randomUUID() }, payload: changed })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers: { ...headers, "idempotency-key": randomUUID() }, payload: changed })).statusCode, 409);
    assert.equal((await app.inject({ url: `/v1/canvases/${id}`, headers })).json().record.canvas.title, "Agent B update");
    assert.equal(await canvases.get({ ...scope, teamId: "other" }, id), null);
    assert.equal((await app.inject({ url: `/v1/lessons/${demoLessons[0]!.id}`, headers })).statusCode, 200);
  } finally { await app.close(); }
});

test("connection configuration fails closed and health errors do not expose credentials", async () => {
  assert.throws(() => loadConfig({ STORAGE_MODE: "mongodb" }));
  assert.throws(() => loadConfig({ HOST: "0.0.0.0" }));
  assert.throws(() => loadConfig({ MONGODB_LABEL: "mongodb://secret" }));
  assert.equal(loadConfig({ MONGODB_URI: "mongodb://127.0.0.1:27017" }).mode, "mongodb");
  const canvases = new InMemoryCanvasRepository(); canvases.ping = async () => { throw new Error("mongodb://private-user:secret@host"); };
  const app = buildApp({ repository: new InMemoryLessonRepository(), canvases, token: "test", scope, storage: "memory" });
  try { const result = await app.inject({ url: "/health" }); assert.equal(result.statusCode, 503); assert.ok(!result.body.includes("private-user")); }
  finally { await app.close(); }
});

const uri = process.env.MONGODB_GATE_URI?.trim();
test("Mongo canvases survive restart with atomic revisions and concurrent retry safety", { skip: uri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_canvas_test_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(uri!); let repo = await MongoCanvasRepository.connect(uri!, database);
  try {
    const id = randomUUID(), op = randomUUID();
    const created = await Promise.all(Array.from({ length: 4 }, () => repo.write(scope, id, input, op, "agent-a")));
    assert.ok(created.every(record => record.revision === 1));
    const changed = { ...input, expectedRevision: 1, canvas: { ...input.canvas, title: "Changed" } };
    const raced = await Promise.allSettled([repo.write(scope, id, changed, randomUUID(), "agent-a"), repo.write(scope, id, changed, randomUUID(), "agent-b")]);
    assert.equal(raced.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(raced.some(result => result.status === "rejected" && result.reason instanceof CanvasConflict));
    await repo.close(); repo = await MongoCanvasRepository.connect(uri!, database); await repo.ping();
    const loaded = await repo.get(scope, id); assert.equal(loaded?.revision, 2); assert.equal(loaded?.canvas.nodes[0]?.kind, "note");
    assert.equal(await repo.get({ ...scope, projectId: "other" }, id), null);
    assert.equal((await repo.list(scope)).length, 1);
  } finally { await repo.close(); await client.connect(); await client.db(database).dropDatabase(); await client.close(); }
});
