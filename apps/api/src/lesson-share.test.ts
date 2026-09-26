import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { demoCandidate } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { hashTeamToken } from "./auth.js";
import { InMemoryLessonRepository } from "./repository.js";

const scope = { teamId: "demo-team", projectId: "event-platform" };
const headers = { authorization: "Bearer test-token", "x-engineer-id": "engineer-a" };

test("a shared lesson is published at once and reaches another engineer's memory", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository(), token: "test-token", scope, storage: "memory" });
  try {
    const key = randomUUID();
    const shared = await app.inject({ method: "POST", url: "/v1/lessons/share", headers: { ...headers, "idempotency-key": key }, payload: demoCandidate });
    assert.equal(shared.statusCode, 201);
    assert.equal(shared.json().status, "published");
    assert.equal(shared.json().teamId, scope.teamId);
    const retry = await app.inject({ method: "POST", url: "/v1/lessons/share", headers: { ...headers, "idempotency-key": key }, payload: demoCandidate });
    assert.equal(retry.json().id, shared.json().id);

    const memory = (await app.inject({ url: "/v1/memory", headers: { ...headers, "x-engineer-id": "engineer-b" } })).json();
    assert.deepEqual(memory.lessons.map((lesson: { id: string }) => lesson.id), [shared.json().id]);
    const kinds = (await app.inject({ url: "/v1/audit", headers })).json().events
      .filter((event: { lessonId: string | null }) => event.lessonId === shared.json().id).map((event: { kind: string }) => event.kind).sort();
    assert.deepEqual(kinds, ["harness.updated", "lesson.proposed", "lesson.published"]);
    // Sharing appends a harness version, so the lesson stays in memory after later publishes.
    const harness = (await app.inject({ url: "/v1/harness", headers })).json();
    assert.equal(harness.version, 1);
    assert.deepEqual(harness.lessons, [{ id: shared.json().id, version: 1 }]);
    const search = (await app.inject({ method: "POST", url: "/v1/memory/search", headers, payload: { query: "duplicates" } })).json();
    assert.equal(search.harnessVersion, 1);
    assert.deepEqual(search.lessons.map((lesson: { id: string }) => lesson.id), [shared.json().id]);

    // The gated route is unchanged: a proposal stays a candidate.
    const proposed = await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: demoCandidate });
    assert.equal(proposed.json().status, "candidate");
    assert.equal((await app.inject({ method: "POST", url: "/v1/lessons/share", headers, payload: { ...demoCandidate, status: "rejected" } })).statusCode, 400);
  } finally { await app.close(); }
});

test("a correction replaces the outdated lesson so no agent keeps loading it", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository(), token: "test-token", scope, storage: "memory" });
  try {
    const share = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/lessons/share", headers: { ...headers, "idempotency-key": randomUUID() }, payload });
    const old = (await share({ ...demoCandidate, title: "Dedupe TTL is 36 hours" })).json();
    assert.equal((await share({ ...demoCandidate, title: "Bad reference", replaces: ["no-such-lesson"] })).statusCode, 400);
    const fixed = await share({ ...demoCandidate, title: "Dedupe TTL is now 72 hours", replaces: [old.id] });
    assert.equal(fixed.statusCode, 201);

    const memory = (await app.inject({ url: "/v1/memory", headers })).json();
    assert.deepEqual(memory.lessons.map((lesson: { title: string }) => lesson.title), ["Dedupe TTL is now 72 hours"]);
    assert.equal((await app.inject({ url: `/v1/lessons/${old.id}`, headers })).json().status, "superseded");
    const harness = (await app.inject({ url: "/v1/harness", headers })).json();
    assert.deepEqual(harness.lessons.map((ref: { id: string }) => ref.id), [fixed.json().id]);
    const shared = (await app.inject({ url: "/v1/audit", headers })).json().events
      .find((event: { lessonId: string; kind: string }) => event.lessonId === fixed.json().id && event.kind === "lesson.published");
    assert.match(shared.summary, new RegExp(`supersedes ${old.id}`));
  } finally { await app.close(); }
});

test("hosted readers cannot share; writers can", async () => {
  const reader = "synthetic-team-access-token-reader-000000000002";
  const writer = "synthetic-team-access-token-writer-000000000002";
  const app = buildApp({
    repository: new InMemoryLessonRepository(), token: "unused", scope, storage: "memory",
    teamAuth: {
      grants: [{ actorId: "viewer", role: "reader", tokenHash: hashTeamToken(reader) }, { actorId: "alice", role: "writer", tokenHash: hashTeamToken(writer) }],
      sessionSecret: "synthetic-session-secret-for-share-test-001", publicOrigin: "https://team.example.test",
    },
  });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/v1/lessons/share", headers: { authorization: `Bearer ${reader}` }, payload: demoCandidate })).statusCode, 403);
    const shared = await app.inject({ method: "POST", url: "/v1/lessons/share", headers: { authorization: `Bearer ${writer}` }, payload: demoCandidate });
    assert.equal(shared.statusCode, 201);
    assert.equal(shared.json().authorId, "alice");
  } finally { await app.close(); }
});
