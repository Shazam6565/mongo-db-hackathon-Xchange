import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEventRecord } from "../../../../packages/contracts/src/harness.js";
import { filterFeed, projectEvents } from "./feed.js";

const scope = { teamId: "xchange-team", projectId: "event-platform" };
const events: AuditEventRecord[] = [
  { ...scope, id: "a", kind: "memory.consumed", lessonId: null, lessonVersion: null, actorId: "agent.one", at: "2026-09-26T10:00:00.000Z",
    summary: "Fetched 2 published lessons (harness v3)", consumed: [{ id: "L1", version: 1 }, { id: "L2", version: 2 }], harnessVersion: 3 },
  { ...scope, id: "b", kind: "harness.rollback", lessonId: "L2", lessonVersion: 2, actorId: "reviewer", at: "2026-09-26T11:00:00.000Z",
    summary: "Harness v4: rolled back Retry safely", harnessVersion: 4 },
  { ...scope, id: "c", kind: "lesson.proposed", lessonId: "L3", lessonVersion: 1, actorId: "agent.two", at: "2026-09-26T09:00:00.000Z",
    summary: "Proposed Check idempotency" },
];

test("feed rows resolve lesson titles, harness versions and loaded counts", () => {
  const items = projectEvents(events, new Map([["L2", "Retry safely"]]));
  assert.deepEqual(items.map(item => [item.type, item.harness, item.lesson, item.loaded]),
    [["Memory read", "v3", "", 2], ["Rollback", "v4", "Retry safely", null], ["Proposed", "", "L3", null]]);
});

test("the feed filters by type, actor and text, and sorts newest first by default", () => {
  const items = projectEvents(events, new Map());
  const ids = (search: string) => filterFeed(items, new URLSearchParams(search)).map(item => item.id);
  assert.deepEqual(ids(""), ["b", "a", "c"]);
  assert.deepEqual(ids("type=memory.consumed"), ["a"]);
  assert.deepEqual(ids("actor=agent.two&actor=reviewer"), ["b", "c"]);
  // Text search reaches the IDs of the lessons an agent loaded.
  assert.deepEqual(ids("q=l1"), ["a"]);
  assert.deepEqual(ids("sort=harness&order=asc"), ["c", "a", "b"]);
  assert.deepEqual(ids("sort=actor&order=asc"), ["a", "c", "b"]);
  assert.deepEqual(ids("sort=loaded"), ["a", "b", "c"]);
});
