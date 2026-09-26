import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { MongoClient } from "mongodb";
import { ActivityInputSchema, type ActivityInput, type ActivityPage } from "../../../packages/contracts/src/activity.js";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { InMemoryLessonRepository } from "./repository.js";
import { InMemoryActivityRepository, MongoActivityRepository, registerActivity } from "./activity.js";

const scope = { teamId: "test-team", projectId: "test-project" };
const other = { ...scope, projectId: "other-project" };
const evidence = [{ reference: "synthetic-check", summary: "Synthetic evidence for the acceptance test." }];
const input = (extra: Partial<ActivityInput> = {}): ActivityInput => ActivityInputSchema.parse({
  kind: "decision", title: "Check before retrying", detail: "Check whether the previous operation completed before retrying.", evidence, ...extra,
});
function harness() {
  const records = new InMemoryActivityRepository();
  const lesson = { ...demoLessons[0]!, ...scope };
  const lessons = new InMemoryLessonRepository([lesson, { ...lesson, id: "foreign", ...other }, { ...lesson, id: "unpublished", status: "candidate" }]);
  const app = Fastify();
  app.register(async api => {
    api.addHook("onRequest", async (request, reply) => { if (request.headers.authorization !== "Bearer test-token") return reply.code(401).send({ error: "Unauthorized" }); });
    registerActivity(api, records, scope, lessons);
  }, { prefix: "/v1" });
  const headers = { authorization: "Bearer test-token", "x-engineer-id": "test-reporter" };
  const post = (body: ActivityInput, id = randomUUID()) => app.inject({ method: "POST", url: "/v1/activity", headers: { ...headers, "idempotency-key": id }, payload: body });
  return { app, records, lesson, post, headers };
}
test("decision → application → outcome → correction retains one scoped history across retries", async () => {
  const { app, post, headers } = harness();
  try {
    const operation = randomUUID();
    const created = await post(input(), operation); assert.equal(created.statusCode, 201);
    const decision = created.json();
    assert.deepEqual((await post(input(), operation)).json(), decision);
    assert.equal((await post(input({ title: "Different content" }), operation)).statusCode, 409);
    const applicationResponse = await post(input({ kind: "application", subject: { kind: "activity", id: decision.id }, runId: "task-b", title: "Reconcile before retry" }));
    assert.equal(applicationResponse.statusCode, 201); const application = applicationResponse.json();
    const result = input({ kind: "outcome", subject: { kind: "activity", id: application.id }, runId: "task-b", title: "Fewer duplicate calls", outcome: {
      assessment: "helped", comparison: "Same fixture and check with memory off/on; a single synthetic trial.", metrics: [{ name: "Calls", unit: "calls", before: 3, after: 1 }],
    } });
    assert.equal((await post({ ...result, runId: "wrong-task" })).statusCode, 400);
    assert.equal((await post({ ...result, subject: { kind: "activity", id: decision.id } })).statusCode, 400);
    const outcomeResponse = await post(result); assert.equal(outcomeResponse.statusCode, 201); const outcome = outcomeResponse.json();
    const correction = await post(input({ kind: "correction", title: "Comparison was incomplete", detail: "The baseline had a different timeout. Do not treat this outcome as proof.", subject: { kind: "activity", id: outcome.id } }));
    assert.equal(correction.statusCode, 201);
    const history = (await app.inject({ url: `/v1/activity?rootKind=activity&rootId=${decision.id}`, headers })).json();
    assert.equal(history.records.length, 4);
    assert.equal(history.records.every((record: { root: { id: string } }) => record.root.id === decision.id), true);
    assert.equal(history.records.find((record: { id: string }) => record.id === outcome.id).outcome.assessment, "helped", "correction never silently rewrites original evidence");
    const filtered = (await app.inject({ url: "/v1/activity?kind=outcome&limit=1", headers })).json();
    assert.deepEqual(filtered.records[0].correctedBy, [correction.json().id], "correction stays visible when its own row is excluded by filters");
    assert.deepEqual((await app.inject({ url: `/v1/activity/${outcome.id}`, headers })).json().correctedBy, [correction.json().id]);
    assert.equal((await app.inject({ method: "DELETE", url: `/v1/activity/${outcome.id}`, headers })).statusCode, 404);
  } finally { await app.close(); }
});
test("activity verifies references, lesson versions and project boundaries without self-publication", async () => {
  const { app, records, post, headers, lesson } = harness();
  try {
    const foreignId = randomUUID(); await records.append(other, foreignId, input(), "other", { kind: "activity", id: foreignId });
    assert.equal((await app.inject({ url: "/v1/activity" })).statusCode, 401);
    assert.equal((await post({ ...input(), teamId: "forged" } as ActivityInput)).statusCode, 400);
    assert.equal((await app.inject({ url: `/v1/activity/${foreignId}`, headers })).statusCode, 404);
    assert.equal((await post(input({ subject: { kind: "activity", id: foreignId } }))).statusCode, 404);
    const application = input({ kind: "application", runId: "run-1", subject: { kind: "lesson", id: lesson.id, version: lesson.version } });
    assert.equal((await post({ ...application, subject: { kind: "lesson", id: "foreign", version: 1 } })).statusCode, 404);
    assert.equal((await post({ ...application, subject: { kind: "lesson", id: "unpublished", version: 1 } })).statusCode, 409);
    assert.equal((await post({ ...application, subject: { kind: "lesson", id: lesson.id, version: lesson.version + 1 } })).statusCode, 409);
    const response = await post(application); assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().root, { kind: "lesson", id: lesson.id });
    assert.equal(response.json().actorLabel, "test-reporter");
    assert.equal((await app.inject({ url: `/v1/activity?cursor=${foreignId}`, headers })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/activity?limit=101", headers })).statusCode, 400);
  } finally { await app.close(); }
});
test("history filters run before pagination; earlier records remain reachable", async () => {
  const { app, records, headers } = harness();
  try {
    const firstId = randomUUID();
    await records.append(scope, firstId, input(), "test", { kind: "activity", id: firstId });
    for (let i = 0; i < 105; i++) {
      const id = randomUUID(); await records.append(scope, id, input({ kind: "observation", title: `Observation ${i}` }), "test", { kind: "activity", id });
    }
    const found = (await app.inject({ url: "/v1/activity?kind=decision&limit=1", headers })).json();
    assert.equal(found.records[0].id, firstId); assert.equal(found.nextCursor, null);
    const ids = new Set<string>(); let cursor: string | null = null;
    do {
      const response: ActivityPage = (await app.inject({ url: `/v1/activity?limit=17${cursor ? `&cursor=${cursor}` : ""}`, headers })).json();
      for (const record of response.records) { assert.equal(ids.has(record.id), false); ids.add(record.id); }
      cursor = response.nextCursor;
    } while (cursor);
    assert.equal(ids.size, 106);
  } finally { await app.close(); }
});

const uri = process.env.MONGODB_GATE_URI?.trim();
test("Mongo activity persists across clients and concurrent retries produce one record", { skip: uri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_memory_activity_${randomUUID().replaceAll("-", "")}`;
  const admin = new MongoClient(uri!); await admin.connect();
  const first = await MongoActivityRepository.connect(uri!, database), second = await MongoActivityRepository.connect(uri!, database);
  try {
    const id = randomUUID(), root = { kind: "activity" as const, id };
    const rows = await Promise.all([first.append(scope, id, input(), "test", root), second.append(scope, id, input(), "test", root)]);
    assert.deepEqual(rows[0], rows[1]);
    await first.close();
    assert.equal((await second.list(scope, { limit: 50 })).records.length, 1);
    assert.equal((await second.get(scope, id))?.title, input().title);
    assert.equal(await second.get(other, id), null);
    await assert.rejects(() => second.append(scope, id, input({ title: "Conflicting retry" }), "test", root));
    for (let i = 0; i < 6; i++) { const next = randomUUID(); await second.append(scope, next, input({ kind: "observation" }), "test", { kind: "activity", id: next }); }
    assert.equal((await second.list(scope, { kind: "decision", limit: 1 })).records[0]?.id, id);
    const seen = new Set<string>(); let cursor: string | undefined;
    do {
      const result = await second.list(scope, { limit: 2, cursor });
      result.records.forEach(record => { assert.equal(seen.has(record.id), false); seen.add(record.id); });
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.size, 7);
    const correctionId = randomUUID();
    await second.append(scope, correctionId, input({ kind: "correction", subject: { kind: "activity", id } }), "test", root);
    assert.deepEqual((await second.list(scope, { kind: "decision", limit: 1 })).records[0]?.correctedBy, [correctionId]);
  } finally { await first.close(); await second.close(); await admin.db(database).dropDatabase(); await admin.close(); }
});
