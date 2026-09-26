import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import type { AuditEvent, Lesson } from "@team-memory/contracts";
import { demoCandidate } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository, MongoLessonRepository, RepositoryError } from "./repository.js";

const headers = { authorization: "Bearer test-token" };
const scope = { teamId: "demo-team", projectId: "event-platform" };
const uri = process.env.MONGODB_GATE_URI?.trim();

test("a retried proposal with the same Idempotency-Key returns one candidate and one audit event", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository(), token: "test-token", scope, storage: "memory" });
  try {
    const key = randomUUID();
    const first = await app.inject({ method: "POST", url: "/v1/lessons", headers: { ...headers, "idempotency-key": key }, payload: demoCandidate });
    const retry = await app.inject({ method: "POST", url: "/v1/lessons", headers: { ...headers, "idempotency-key": key }, payload: demoCandidate });
    assert.equal(first.statusCode, 201);
    assert.equal(retry.statusCode, 201);
    assert.equal(first.json().id, key);
    assert.deepEqual(retry.json(), first.json());

    const reused = await app.inject({ method: "POST", url: "/v1/lessons", headers: { ...headers, "idempotency-key": key }, payload: { ...demoCandidate, title: "Different lesson" } });
    assert.equal(reused.statusCode, 409);
    const invalid = await app.inject({ method: "POST", url: "/v1/lessons", headers: { ...headers, "idempotency-key": "not-a-uuid" }, payload: demoCandidate });
    assert.equal(invalid.statusCode, 400);

    const lessons = (await app.inject({ url: "/v1/lessons", headers })).json().lessons as Lesson[];
    assert.deepEqual(lessons.map((lesson) => lesson.id), [key]);
    const events = (await app.inject({ url: "/v1/audit", headers })).json().events as AuditEvent[];
    assert.equal(events.filter((event) => event.kind === "lesson.proposed").length, 1);

    // Without a key, each submission is a new candidate, as before.
    await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: demoCandidate });
    await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: demoCandidate });
    assert.equal((await app.inject({ url: "/v1/lessons", headers })).json().lessons.length, 3);
  } finally { await app.close(); }
});

test("mongo proposals are idempotent per key and scoped", { skip: uri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_memory_proposals_${randomUUID().slice(0, 8)}`;
  const repository = await MongoLessonRepository.connect(uri!, database);
  const admin = new MongoClient(uri!);
  try {
    await admin.connect();
    const key = randomUUID();
    const first = await repository.propose(scope, demoCandidate, key);
    const retry = await repository.propose(scope, demoCandidate, key);
    assert.deepEqual(retry, first);
    await assert.rejects(repository.propose(scope, { ...demoCandidate, title: "Changed" }, key),
      (error: unknown) => error instanceof RepositoryError && error.status === 409);
    await assert.rejects(repository.propose({ ...scope, projectId: "other" }, demoCandidate, key),
      (error: unknown) => error instanceof RepositoryError && error.status === 409);
    assert.equal(await admin.db(database).collection("lessons").countDocuments({ id: key }), 1);
    assert.equal(await admin.db(database).collection("audit_events").countDocuments({ kind: "lesson.proposed", lessonId: key }), 1);
  } finally {
    await admin.db(database).dropDatabase();
    await admin.close();
    await repository.close();
  }
});
