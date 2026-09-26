import assert from "node:assert/strict";
import test from "node:test";
import { demoCandidate, demoLessons } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository } from "./repository.js";

test("memory is scoped and candidate submission does not publish knowledge", async () => {
  const demo = demoLessons[0]!;
  const app = buildApp({
    repository: new InMemoryLessonRepository([demo, { ...demo, id: "other-team", teamId: "private-team" }]),
    token: "test-token",
    scope: { teamId: "demo-team", projectId: "event-platform" },
    storage: "memory",
  });
  try {
    assert.equal((await app.inject({ url: "/v1/memory" })).statusCode, 401);
    const headers = { authorization: "Bearer test-token" };
    const before = await app.inject({ url: "/v1/memory", headers });
    assert.deepEqual(before.json().lessons.map((lesson: { id: string }) => lesson.id), [demo.id]);

    const bad = await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: { ...demoCandidate, status: "published" } });
    assert.equal(bad.statusCode, 400);

    const created = await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: demoCandidate });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().status, "candidate");
    assert.equal(created.json().teamId, "demo-team");
    const after = await app.inject({ url: "/v1/memory", headers });
    assert.equal(after.json().lessons.length, 1);
    const all = await app.inject({ url: "/v1/lessons", headers });
    assert.equal(all.json().lessons.length, 2);
  } finally { await app.close(); }
});
