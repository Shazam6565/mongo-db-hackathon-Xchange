import assert from "node:assert/strict";
import test from "node:test";
import { CandidateInputSchema, renderMemory } from "./index.js";
import { demoCandidate, demoLessons } from "./demo.js";

test("candidate input cannot self-publish or set its server-side scope", () => {
  assert.equal(CandidateInputSchema.safeParse({ ...demoCandidate, status: "published" }).success, false);
  assert.equal(CandidateInputSchema.safeParse({ ...demoCandidate, teamId: "another-team" }).success, false);
});

test("generated memory excludes unpublished lessons", () => {
  const lesson = demoLessons[0]!;
  const output = renderMemory({
    scope: { teamId: lesson.teamId, projectId: lesson.projectId },
    lessons: [lesson, { ...lesson, id: "candidate-only", title: "Do not distribute", status: "candidate" }],
    fetchedAt: lesson.updatedAt,
  });
  assert.match(output, /demo-lesson-001/);
  assert.doesNotMatch(output, /Do not distribute/);
});
