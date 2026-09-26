import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { MongoClient } from "mongodb";
import type { AuditEvent, Lesson } from "@team-memory/contracts";
import { demoCandidate, demoLessons } from "../../../packages/contracts/src/demo.js";
import { compareLesson } from "../../evaluator/src/compare.js";
import { buildApp } from "./app.js";
import { hashTeamToken, type TeamAuthConfig } from "./auth.js";
import { InMemoryLessonRepository, MongoLessonRepository, RepositoryError } from "./repository.js";

const headers = { authorization: "Bearer test-token" };
const scope = { teamId: "demo-team", projectId: "event-platform" };
const uri = process.env.MONGODB_GATE_URI?.trim();
const seeded = demoLessons[0]!;

async function publish(app: FastifyInstance, title: string) {
  const created = (await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: { ...demoCandidate, title } })).json() as Lesson;
  const evaluated = await app.inject({ method: "POST", url: `/v1/lessons/${created.id}/evaluate`, headers, payload: { expectedVersion: 1 } });
  assert.equal(evaluated.statusCode, 200);
  assert.equal(evaluated.json().lesson.status, "published");
  return evaluated.json() as { lesson: Lesson; harness: { number: number; lessons: { id: string }[] } };
}
const memoryIds = async (app: FastifyInstance) => {
  const body = (await app.inject({ url: "/v1/memory", headers: { ...headers, "x-engineer-id": "engineer-b" } })).json();
  return { version: body.harnessVersion as number, ids: (body.lessons as Lesson[]).map((lesson) => lesson.id).sort() };
};

test("publishing appends a harness version and rollback removes the lesson from agent memory", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository([seeded]), token: "test-token", scope, storage: "memory" });
  try {
    // Before any harness record, every published lesson is active as version 0.
    assert.deepEqual(await memoryIds(app), { version: 0, ids: [seeded.id] });

    const first = await publish(app, "Check event deduplication");
    assert.equal(first.harness.number, 1);
    assert.deepEqual(first.harness.lessons.map((ref) => ref.id).sort(), [seeded.id, first.lesson.id].sort());
    assert.deepEqual(await memoryIds(app), { version: 1, ids: [seeded.id, first.lesson.id].sort() });

    const rollback = await app.inject({ method: "POST", url: "/v1/harness/rollback", headers: { ...headers, "x-engineer-id": "reviewer" },
      payload: { expectedVersion: 1, lessonId: first.lesson.id } });
    assert.equal(rollback.statusCode, 200);
    assert.equal(rollback.json().harness.number, 2);
    assert.equal(rollback.json().harness.reason, "rollback");
    assert.deepEqual(await memoryIds(app), { version: 2, ids: [seeded.id] });
    // The lesson keeps its gate result; it is simply no longer loaded by agents.
    assert.equal((await app.inject({ url: `/v1/lessons/${first.lesson.id}`, headers })).json().status, "published");

    const stale = await app.inject({ method: "POST", url: "/v1/harness/rollback", headers, payload: { expectedVersion: 1, lessonId: seeded.id } });
    assert.equal(stale.statusCode, 409);
    const inactive = await app.inject({ method: "POST", url: "/v1/harness/rollback", headers, payload: { expectedVersion: 2, lessonId: first.lesson.id } });
    assert.equal(inactive.statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: "/v1/harness/rollback", headers, payload: { lessonId: seeded.id } })).statusCode, 400);

    const state = (await app.inject({ url: "/v1/harness", headers })).json();
    assert.equal(state.version, 2);
    assert.deepEqual(state.versions.map((version: { number: number; reason: string }) => `${version.number}:${version.reason}`), ["2:rollback", "1:publish"]);

    const events = (await app.inject({ url: "/v1/audit", headers })).json().events as AuditEvent[];
    assert.equal(events.find((event) => event.kind === "harness.updated")?.harnessVersion, 1);
    assert.equal(events.find((event) => event.kind === "harness.rollback")?.actorId, "reviewer");
    assert.equal(events.find((event) => event.kind === "memory.consumed")?.harnessVersion, 2);
  } finally { await app.close(); }
});

test("loading the active harness is audited; inspecting it is not", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository([seeded]), token: "test-token", scope, storage: "memory" });
  try {
    const count = async () => (await app.inject({ url: "/v1/audit", headers })).json().events.filter((event: AuditEvent) => event.kind === "memory.consumed").length;
    await app.inject({ url: "/v1/harness", headers });
    assert.equal(await count(), 0);
    const active = await app.inject({ url: "/v1/harness/active", headers: { ...headers, "x-engineer-id": "agent-b" } });
    assert.equal(active.statusCode, 200);
    assert.deepEqual(active.json().lessons.map((lesson: Lesson) => lesson.id), [seeded.id]);
    assert.equal(await count(), 1);
  } finally { await app.close(); }
});

test("the audit feed pages through every harness event and filters by kind and actor", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository([seeded]), token: "test-token", scope, storage: "memory" });
  try {
    for (const engineer of ["agent-a", "agent-b", "agent-a"]) await app.inject({ url: "/v1/memory", headers: { ...headers, "x-engineer-id": engineer } });
    const published = await publish(app, "Check event deduplication");
    await app.inject({ method: "POST", url: "/v1/harness/rollback", headers: { ...headers, "x-engineer-id": "reviewer" }, payload: { expectedVersion: 1, lessonId: published.lesson.id } });
    // Three reads, then proposed + evaluated + published + harness.updated, then harness.rollback.
    const all = (await app.inject({ url: "/v1/audit", headers })).json() as { events: AuditEvent[]; nextCursor: string | null };
    assert.equal(all.nextCursor, null);
    assert.equal(all.events.length, 8);
    // Newest first; events in the same millisecond keep a stable order by ID.
    assert.deepEqual(all.events.map((event) => event.at), [...all.events.map((event) => event.at)].sort().reverse());
    const paged: AuditEvent[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const page = (await app.inject({ url: `/v1/audit?limit=3${cursor ? `&cursor=${cursor}` : ""}`, headers })).json() as { events: AuditEvent[]; nextCursor: string | null };
      paged.push(...page.events); cursor = page.nextCursor; pages++;
    } while (cursor);
    assert.equal(pages, 3);
    assert.deepEqual(paged.map((event) => event.id), all.events.map((event) => event.id));

    const reads = (await app.inject({ url: "/v1/audit?kind=memory.consumed&actorId=agent-a", headers })).json().events as AuditEvent[];
    assert.equal(reads.length, 2);
    assert.ok(reads.every((event) => event.kind === "memory.consumed" && event.actorId === "agent-a" && event.consumed?.length === 1));
    assert.equal((await app.inject({ url: `/v1/audit?since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, headers })).json().events.length, 0);
    assert.equal((await app.inject({ url: `/v1/audit?cursor=${randomUUID()}`, headers })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/audit?limit=0", headers })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/audit?kind=unknown", headers })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/audit?since=2026-09-27T00:00:00Z&until=2026-09-26T00:00:00Z", headers })).statusCode, 400);
    // Reading the feed is inspection: it adds no event.
    assert.equal((await app.inject({ url: "/v1/audit", headers })).json().events.length, 8);
  } finally { await app.close(); }
});

test("only an evaluator credential can roll back the hosted harness", async () => {
  const grant = (actorId: string, role: "writer" | "evaluator") => ({ actorId, role, tokenHash: hashTeamToken(`synthetic-harness-token-${actorId}-0000000000001`) });
  const teamAuth: TeamAuthConfig = { grants: [grant("writer-1", "writer"), grant("reviewer-1", "evaluator")],
    sessionSecret: "synthetic-session-secret-for-harness-0001", publicOrigin: "https://team.example.test" };
  const app = buildApp({ repository: new InMemoryLessonRepository([{ ...seeded, ...scope }]), token: "unused", teamAuth, scope, storage: "memory" });
  const as = (actorId: string) => ({ authorization: `Bearer synthetic-harness-token-${actorId}-0000000000001` });
  try {
    const payload = { expectedVersion: 0, lessonId: seeded.id };
    assert.equal((await app.inject({ method: "POST", url: "/v1/harness/rollback", headers: as("writer-1"), payload })).statusCode, 403);
    const done = await app.inject({ method: "POST", url: "/v1/harness/rollback", headers: { ...as("reviewer-1"), "x-engineer-id": "spoofed" }, payload });
    assert.equal(done.statusCode, 200);
    assert.equal(done.json().harness.actorId, "reviewer-1");
    assert.deepEqual(done.json().lessons, []);
  } finally { await app.close(); }
});

test("mongo harness versions commit with publication and reject stale rollbacks", { skip: uri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_memory_harness_${randomUUID().slice(0, 8)}`;
  const repository = await MongoLessonRepository.connect(uri!, database);
  const admin = new MongoClient(uri!);
  try {
    await admin.connect();
    const candidate = await repository.propose(scope, { ...demoCandidate, title: "Check event deduplication" }, randomUUID());
    const published = await repository.commitEvaluation(scope, candidate.id, 1, compareLesson(candidate));
    assert.equal(published.harness?.number, 1);
    assert.deepEqual((await repository.activeHarness(scope)).lessons.map((lesson) => lesson.id), [candidate.id]);

    const rolled = await repository.rollbackLesson(scope, 1, candidate.id, "reviewer");
    assert.equal(rolled.harness.number, 2);
    assert.deepEqual(rolled.lessons, []);
    await assert.rejects(repository.rollbackLesson(scope, 1, candidate.id, "reviewer"),
      (error: unknown) => error instanceof RepositoryError && error.status === 409);
    const stored = await admin.db(database).collection("harness_versions").find({ ...scope }).sort({ number: 1 }).toArray();
    assert.deepEqual(stored.map((version) => `${version.number}:${version.reason}:${version.lessons.length}`), ["1:publish:1", "2:rollback:0"]);
    assert.equal(await admin.db(database).collection("audit_events").countDocuments({ kind: { $in: ["harness.updated", "harness.rollback"] } }), 2);

    // The feed pages by (at, id) through proposed, evaluated, published, harness.updated and harness.rollback.
    const whole = await repository.listAudit(scope);
    assert.equal(whole.events.length, 5);
    const first = await repository.listAudit(scope, { limit: 2 });
    assert.equal(first.events.length, 2);
    assert.ok(first.nextCursor);
    const rest = await repository.listAudit(scope, { limit: 100, cursor: first.nextCursor! });
    assert.equal(rest.nextCursor, null);
    assert.deepEqual([...first.events, ...rest.events].map((event) => event.id), whole.events.map((event) => event.id));
    assert.deepEqual((await repository.listAudit(scope, { limit: 100, kind: "harness.rollback" })).events.map((event) => event.actorId), ["reviewer"]);
    await assert.rejects(repository.listAudit(scope, { limit: 100, cursor: randomUUID() }), (error: unknown) => error instanceof RepositoryError && error.status === 400);
  } finally {
    await admin.db(database).dropDatabase();
    await admin.close();
    await repository.close();
  }
});
