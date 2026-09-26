import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import {
  ENGINEER_ID_HEADER, MemorySnapshotSchema, renderMemory, type AuditEvent, type CandidateInput, type EvaluationResult, type Lesson,
} from "@team-memory/contracts";
import { demoCandidate } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository } from "./repository.js";

const headers = { authorization: "Bearer test-token" };
const scope = { teamId: "demo-team", projectId: "event-platform" };

async function withApp(run: (app: FastifyInstance) => Promise<void>) {
  const app = buildApp({
    repository: new InMemoryLessonRepository(),
    token: "test-token",
    scope,
    storage: "memory",
  });
  try { await run(app); } finally { await app.close(); }
}

async function propose(app: FastifyInstance, input: CandidateInput) {
  const created = await app.inject({ method: "POST", url: "/v1/lessons", headers, payload: input });
  assert.equal(created.statusCode, 201);
  return created.json() as Lesson;
}

async function evaluate(app: FastifyInstance, id: string, expectedVersion: number) {
  return app.inject({
    method: "POST",
    url: `/v1/lessons/${id}/evaluate`,
    headers,
    payload: { expectedVersion },
  });
}

test("a passing dedup lesson is published and a broadened copy is rejected", async () => {
  await withApp(async (app) => {
    const narrow = await propose(app, { ...demoCandidate, title: "Check event deduplication" });
    const published = await evaluate(app, narrow.id, narrow.version);
    assert.equal(published.statusCode, 200);
    const publishedBody = published.json() as { lesson: Lesson; evaluation: EvaluationResult };
    assert.equal(publishedBody.lesson.status, "published");
    assert.equal(publishedBody.evaluation.decision, "publish");
    assert.equal(JSON.stringify(publishedBody).includes("expectedComponent"), false);

    const memory = await app.inject({
      url: "/v1/memory",
      headers: { ...headers, [ENGINEER_ID_HEADER]: "engineer-b" },
    });
    assert.equal(memory.statusCode, 200);
    const snapshot = MemorySnapshotSchema.parse(memory.json());
    assert.deepEqual(snapshot.lessons.map((lesson) => lesson.id), [narrow.id]);
    assert.match(renderMemory(snapshot), /Check event deduplication/);
    assert.equal(JSON.stringify(snapshot).includes("expectedComponent"), false);
    assert.equal(JSON.stringify(snapshot).includes("DEMO-203"), false);

    const broad = await propose(app, {
      ...demoCandidate,
      title: "Send every duplicate UI bug to event deduplication",
      appliesTo: [...demoCandidate.appliesTo, "frontend"],
    });
    const rejected = await evaluate(app, broad.id, broad.version);
    assert.equal(rejected.statusCode, 200);
    const rejectedBody = rejected.json() as { lesson: Lesson; evaluation: EvaluationResult };
    assert.equal(rejectedBody.lesson.status, "rejected");
    assert.equal(rejectedBody.evaluation.decision, "reject");
    assert.ok(rejectedBody.evaluation.regressions.some((item) => item.includes("DEMO-203")));

    const after = MemorySnapshotSchema.parse((await app.inject({
      url: "/v1/memory",
      headers: { ...headers, [ENGINEER_ID_HEADER]: "engineer-b" },
    })).json());
    assert.deepEqual(after.lessons.map((lesson) => lesson.id), [narrow.id]);
    const markdown = renderMemory(after);
    assert.match(markdown, /Check event deduplication/);
    assert.doesNotMatch(markdown, /Send every duplicate UI bug/);

    const audit = (await app.inject({ url: "/v1/audit", headers })).json() as { events: AuditEvent[] };
    const consumed = audit.events.find((event) => event.kind === "memory.consumed" && event.actorId === "engineer-b" && event.summary.startsWith("Fetched 1"));
    assert.deepEqual(consumed?.consumed, [{ id: narrow.id, version: narrow.version }]);
    assert.equal(audit.events.some((event) => event.kind === "lesson.published" && event.lessonId === narrow.id), true);
    assert.equal(audit.events.some((event) => event.kind === "lesson.rejected" && event.lessonId === broad.id), true);
  });
});

test("stale versions and incomplete lessons do not publish", async () => {
  await withApp(async (app) => {
    const lesson = await propose(app, demoCandidate);
    const stale = await evaluate(app, lesson.id, lesson.version + 1);
    assert.equal(stale.statusCode, 409);
    const stillCandidate = (await app.inject({ url: "/v1/lessons", headers })).json() as { lessons: Lesson[] };
    assert.equal(stillCandidate.lessons[0]?.status, "candidate");
    const noScores = (await app.inject({ url: "/v1/evaluations", headers })).json() as { evaluations: EvaluationResult[] };
    assert.equal(noScores.evaluations.length, 0);

    const unscoped = await propose(app, { ...demoCandidate, title: "No applicability", appliesTo: [] });
    const review = await evaluate(app, unscoped.id, unscoped.version);
    assert.equal(review.statusCode, 200);
    const reviewBody = review.json() as { lesson: Lesson; evaluation: EvaluationResult };
    assert.equal(reviewBody.evaluation.decision, "needs-review");
    assert.equal(reviewBody.lesson.status, "candidate");
    const memory = (await app.inject({ url: "/v1/memory", headers })).json() as { lessons: Lesson[] };
    assert.equal(memory.lessons.length, 0);

    const missing = await evaluate(app, "missing-lesson", 1);
    assert.equal(missing.statusCode, 404);
    const again = await evaluate(app, lesson.id, lesson.version);
    assert.equal(again.statusCode, 200);
    const repeat = await evaluate(app, lesson.id, lesson.version);
    assert.equal(repeat.statusCode, 409);
  });
});
