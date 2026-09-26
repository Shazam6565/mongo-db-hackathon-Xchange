import type { Scope } from "@team-memory/contracts";
import { AuditPageSchema, HarnessStateSchema, type AuditEventRecord } from "../../../../packages/contracts/src/harness.js";
import { HealthResponse, LessonsResponse, request } from "../catalog/api.js";

// Reads the whole feed from MongoDB in pages of 100, so the table can sort and filter locally.
// Beyond this many pages the footer says older events were left out.
export const FEED_PAGE_LIMIT = 10;
async function auditPages(signal: AbortSignal): Promise<{ scope: Scope; events: AuditEventRecord[]; truncated: boolean }> {
  const page = (cursor: string | null) => request(`/v1/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }).then(value => AuditPageSchema.parse(value));
  const first = await page(null);
  const events = [...first.events];
  let cursor = first.nextCursor;
  for (let count = 1; cursor && count < FEED_PAGE_LIMIT; count++) {
    const next = await page(cursor);
    events.push(...next.events); cursor = next.nextCursor;
  }
  return { scope: first.scope, events, truncated: Boolean(cursor) };
}
export async function loadFeed(signal: AbortSignal) {
  const [health, harness, catalog, audit] = await Promise.all([
    request("/health", { signal }).then(value => HealthResponse.parse(value)),
    request("/v1/harness", { signal }).then(value => HarnessStateSchema.parse(value)),
    request("/v1/lessons", { signal }).then(value => LessonsResponse.parse(value)),
    auditPages(signal),
  ]);
  if (audit.scope.teamId !== harness.scope.teamId || audit.scope.projectId !== harness.scope.projectId) throw new Error("The audit feed returned a different project. Refresh before continuing.");
  return { health, harness, lessons: new Map(catalog.lessons.map(lesson => [lesson.id, lesson])), events: audit.events, truncated: audit.truncated };
}
