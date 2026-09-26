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
    assert.deepEqual(kinds, ["lesson.proposed", "lesson.published"]);

    // The gated route is unchanged: a proposal stays a candidate.
    const proposed = await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: demoCandidate });
    assert.equal(proposed.json().status, "candidate");
    assert.equal((await app.inject({ method: "POST", url: "/v1/lessons/share", headers, payload: { ...demoCandidate, status: "rejected" } })).statusCode, 400);
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
