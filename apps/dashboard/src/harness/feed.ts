import { AuditKindSchema, type AuditEventRecord, type AuditKind } from "../../../../packages/contracts/src/harness.js";
import type { ColumnDef } from "../catalog/model.js";

// The harness activity feed is the audit_events collection projected into table rows: what each
// Pi agent loaded and from which harness version, and every lesson or version change around it.
export const feedKinds = AuditKindSchema.options;
const kindLabels: Record<AuditKind, string> = {
  "memory.consumed": "Memory read", "harness.updated": "Harness updated", "harness.rollback": "Rollback",
  "lesson.proposed": "Proposed", "lesson.evaluated": "Evaluated", "lesson.published": "Published", "lesson.rejected": "Rejected",
};
// Chip tone per kind; the classes sit next to the catalog status chips in catalog.css.
const kindTones: Record<AuditKind, string> = {
  "memory.consumed": "memory", "harness.updated": "harness", "harness.rollback": "rollback",
  "lesson.proposed": "candidate", "lesson.evaluated": "evaluated", "lesson.published": "published", "lesson.rejected": "rejected",
};
export const kindLabel = (kind: AuditKind) => kindLabels[kind];
export const kindTone = (kind: AuditKind) => kindTones[kind];

export type FeedItem = {
  id: string; kind: AuditKind; type: string; summary: string; actor: string; at: string;
  harnessVersion: number | null; harness: string; lessonId: string | null; lessonVersion: number | null; lesson: string;
  loaded: number | null; event: AuditEventRecord;
};
export const feedColumns = [
  { id: "summary", label: "Event", width: 380, visible: true },
  { id: "type", label: "Type", width: 140, visible: true },
  { id: "actor", label: "Actor", width: 200, visible: true },
  { id: "harness", label: "Harness", width: 100, visible: true },
  { id: "lesson", label: "Lesson", width: 260, visible: true },
  { id: "at", label: "When", width: 190, visible: true },
  { id: "loaded", label: "Lessons loaded", width: 140, visible: false },
  { id: "id", label: "Event ID", width: 330, visible: false },
] as const satisfies readonly ColumnDef<string>[];
export type FeedColumnId = typeof feedColumns[number]["id"];

export function projectEvents(events: AuditEventRecord[], titles: Map<string, string>): FeedItem[] {
  return events.map(event => ({
    id: event.id, kind: event.kind, type: kindLabel(event.kind), summary: event.summary, actor: event.actorId, at: event.at,
    harnessVersion: event.harnessVersion ?? null, harness: event.harnessVersion === undefined ? "" : `v${event.harnessVersion}`,
    lessonId: event.lessonId, lessonVersion: event.lessonVersion, lesson: event.lessonId ? titles.get(event.lessonId) ?? event.lessonId : "",
    loaded: event.consumed ? event.consumed.length : null, event,
  }));
}
export function filterFeed(items: FeedItem[], query: URLSearchParams): FeedItem[] {
  const term = (query.get("q") ?? "").trim().toLocaleLowerCase();
  const kinds = query.getAll("type"), actors = query.getAll("actor");
  const sort = feedColumns.find(c => c.id === query.get("sort"))?.id ?? "at";
  const direction = query.get("order") === "asc" ? 1 : -1;
  const value = (item: FeedItem): string | number => sort === "harness" ? item.harnessVersion ?? -1 : sort === "loaded" ? item.loaded ?? -1 : item[sort];
  return items.filter(item => (!kinds.length || kinds.includes(item.kind)) && (!actors.length || actors.includes(item.actor))
    && (!term || [item.summary, item.type, item.actor, item.harness, item.lesson, item.lessonId ?? "", item.id, ...(item.event.consumed ?? []).map(ref => ref.id)]
      .join(" ").toLocaleLowerCase().includes(term)))
    .sort((a, b) => {
      const left = value(a), right = value(b);
      const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
      return order * direction || b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
    });
}
