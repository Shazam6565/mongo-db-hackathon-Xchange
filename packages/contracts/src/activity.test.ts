import assert from "node:assert/strict";
import test from "node:test";
import { ActivityInputSchema, ActivityQuerySchema } from "./activity.js";

const base = { kind: "decision", title: "Keep lessons scoped", detail: "Retrieve the current project's published lessons.", evidence: [{ reference: "owner-direction", summary: "Owner requested scoped group memory." }] };
test("activity cannot claim scope, identity, approval or unsupported outcome evidence", () => {
  assert.equal(ActivityInputSchema.safeParse(base).success, true);
  for (const extra of [{ teamId: "foreign" }, { actorLabel: "owner" }, { status: "published" }, { recordedAt: new Date().toISOString() }]) {
    assert.equal(ActivityInputSchema.safeParse({ ...base, ...extra }).success, false);
  }
  assert.equal(ActivityInputSchema.safeParse({ ...base, kind: "application" }).success, false);
  assert.equal(ActivityInputSchema.safeParse({ ...base, kind: "outcome", subject: { kind: "lesson", id: "one", version: 1 }, runId: "run" }).success, false);
  assert.equal(ActivityInputSchema.safeParse({ ...base, evidence: [] }).success, false);
});
test("history queries reject incomplete scope and invalid windows", () => {
  assert.equal(ActivityQuerySchema.safeParse({ rootId: "one" }).success, false);
  assert.equal(ActivityQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(ActivityQuerySchema.safeParse({ since: "2026-09-27T00:00:00.000Z", until: "2026-09-26T00:00:00.000Z" }).success, false);
});
