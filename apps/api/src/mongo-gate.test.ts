import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { demoCandidate } from "../../../packages/contracts/src/demo.js";
import { compareLesson } from "../../evaluator/src/compare.js";
import { MongoLessonRepository, RepositoryError } from "./repository.js";

const uri = process.env.MONGODB_GATE_URI?.trim();

test("mongo publication writes the lesson, score, and audit in one transaction", { skip: uri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_memory_gate_${randomUUID().slice(0, 8)}`;
  const scope = { teamId: "demo-team", projectId: "event-platform" };
  const repository = await MongoLessonRepository.connect(uri!, database);
  const admin = new MongoClient(uri!);
  try {
    await admin.connect();
    const narrow = await repository.propose(scope, { ...demoCandidate, title: "Check event deduplication" });
    const published = await repository.commitEvaluation(scope, narrow.id, narrow.version, compareLesson(narrow));
    assert.equal(published.lesson.status, "published");
    assert.equal(published.evaluation.decision, "publish");

    const broad = await repository.propose(scope, {
      ...demoCandidate,
      title: "Send every duplicate UI bug to event deduplication",
      appliesTo: [...demoCandidate.appliesTo, "frontend"],
    });
    const rejected = await repository.commitEvaluation(scope, broad.id, broad.version, compareLesson(broad));
    assert.equal(rejected.lesson.status, "rejected");
    assert.equal(rejected.evaluation.decision, "reject");

    const publishedLessons = await repository.list(scope, "published");
    assert.deepEqual(publishedLessons.map((lesson) => lesson.id), [narrow.id]);
    await repository.recordConsumption(scope, "engineer-b", [{ id: narrow.id, version: narrow.version }], new Date().toISOString());
    const audit = (await repository.listAudit(scope)).events;
    assert.equal(audit.some((event) => event.kind === "lesson.published" && event.lessonId === narrow.id), true);
    assert.equal(audit.some((event) => event.kind === "lesson.rejected" && event.lessonId === broad.id), true);
    assert.deepEqual(
      audit.find((event) => event.kind === "memory.consumed" && event.actorId === "engineer-b")?.consumed,
      [{ id: narrow.id, version: narrow.version }],
    );

    const fresh = await repository.propose(scope, { ...demoCandidate, title: "Stale version" });
    await assert.rejects(
      repository.commitEvaluation(scope, fresh.id, fresh.version + 1, compareLesson(fresh)),
      (error: unknown) => error instanceof RepositoryError && error.status === 409,
    );
    assert.equal((await repository.get(scope, fresh.id))?.status, "candidate");
    const scores = await repository.listEvaluations(scope);
    assert.equal(scores.some((item) => item.lessonId === fresh.id), false);
  } finally {
    await admin.db(database).dropDatabase();
    await admin.close();
    await repository.close();
  }
});
