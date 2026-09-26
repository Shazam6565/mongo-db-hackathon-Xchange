import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CandidateInput } from "@team-memory/contracts";
import { demoCandidate } from "../../../packages/contracts/src/demo.js";
import { compareLesson, loadSuite } from "./compare.js";

function candidate(input: CandidateInput = demoCandidate): CandidateInput {
  return structuredClone(input);
}

test("the fixed suite loads without exposing answers through compare metadata", () => {
  const suite = loadSuite();
  assert.equal(suite.suiteVersion, "triage-v0-fixtures-only");
  assert.equal(suite.cases.length, 2);
  const result = compareLesson(candidate());
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes("expectedComponent"), false);
  assert.equal(encoded.includes("Compare the API response with rendered UI state"), false);
});

test("the dedup lesson passes the event ticket and leaves the UI ticket untouched", () => {
  const examplePath = fileURLToPath(new URL("../../../examples/lesson-candidate.json", import.meta.url));
  const example = JSON.parse(readFileSync(examplePath, "utf8")) as CandidateInput;
  for (const lesson of [candidate(), example]) {
    const result = compareLesson(lesson);
    assert.equal(result.decision, "publish");
    assert.deepEqual(result.regressions, []);
    assert.ok(result.candidateScore > result.baselineScore);
    const eventCase = result.cases.find((item) => item.ticketKey === "DEMO-202");
    const uiCase = result.cases.find((item) => item.ticketKey === "DEMO-203");
    assert.equal(eventCase?.applied, true);
    assert.equal(eventCase?.component, "event-platform");
    assert.equal(eventCase?.componentCorrect, true);
    assert.equal(eventCase?.checksCovered, eventCase?.checksTotal);
    assert.equal(uiCase?.applied, false);
    assert.equal(uiCase?.component, null);
  }
});

test("the same lesson covering every duplicate UI bug fails the negative control", () => {
  const broadened = candidate();
  broadened.appliesTo = [...broadened.appliesTo, "frontend"];
  const duplicates = candidate();
  duplicates.appliesTo = [...duplicates.appliesTo, "duplicates"];

  for (const lesson of [broadened, duplicates]) {
    const result = compareLesson(lesson);
    assert.equal(result.decision, "reject");
    assert.ok(result.regressions.some((item) => item.includes("DEMO-203") && item.includes("event-platform")));
    const uiCase = result.cases.find((item) => item.ticketKey === "DEMO-203");
    assert.equal(uiCase?.applied, true);
    assert.equal(uiCase?.componentCorrect, false);
  }
});

test("a lesson that omits a required check stays a review, and empty scope does not publish", () => {
  const incomplete = candidate();
  incomplete.lesson = "Look at the consumer before classifying the bug.";
  incomplete.proposedChange = {
    ...incomplete.proposedChange,
    instructions: ["Consider retries in the consumer."],
    verificationSteps: ["Replay the same event twice."],
  };
  const incompleteResult = compareLesson(incomplete);
  assert.equal(incompleteResult.decision, "needs-review");
  assert.deepEqual(incompleteResult.regressions, []);

  const unscoped = candidate();
  unscoped.appliesTo = [];
  const unscopedResult = compareLesson(unscoped);
  assert.equal(unscopedResult.decision, "needs-review");
  assert.equal(unscopedResult.cases.every((item) => item.applied === false), true);
});
