import type { Lesson } from "@team-memory/contracts";
import type { TicketRecord } from "../../../../packages/contracts/src/tickets.js";
import type { ActivityRecord } from "../../../../packages/contracts/src/activity.js";

export type CatalogItem = {
  id: string; kind: "lesson" | "ticket" | ActivityRecord["kind"]; title: string; description: string;
  status: string; reference: string; appliesTo: string[]; author: string; updatedAt: string;
  record: { kind: "lesson"; value: Lesson } | { kind: "ticket"; value: TicketRecord } | { kind: "activity"; value: ActivityRecord };
};
export function projectItems(lessons: Lesson[], tickets: TicketRecord[], activity: ActivityRecord[] = []): CatalogItem[] {
  return [
    ...lessons.map((value): CatalogItem => ({ id: value.id, kind: "lesson", title: value.title, description: value.lesson,
      status: value.status, reference: value.id, appliesTo: value.appliesTo, author: value.authorId,
      updatedAt: value.updatedAt, record: { kind: "lesson", value } })),
    ...tickets.map((value): CatalogItem => ({ id: value.id, kind: "ticket", title: value.summary, description: value.description,
      status: value.status, reference: value.key, appliesTo: value.component ? [value.component] : [], author: "",
      updatedAt: value.updatedAt, record: { kind: "ticket", value } })),
    ...activity.map((value): CatalogItem => ({ id: value.id, kind: value.kind, title: value.title, description: value.detail,
      status: value.correctedBy.length ? "correction_recorded" : value.kind === "outcome" ? "reported" : "recorded", reference: value.runId ?? value.id,
      appliesTo: [], author: value.actorLabel, updatedAt: value.recordedAt, record: { kind: "activity", value } })),
  ];
}
export const columns = [
  { id: "title", label: "Name", width: 360, visible: true },
  { id: "kind", label: "Type", width: 100, visible: true },
  { id: "status", label: "Status", width: 130, visible: true },
  { id: "appliesTo", label: "Applies to", width: 210, visible: true },
  { id: "updatedAt", label: "Updated", width: 170, visible: true },
  { id: "description", label: "Description", width: 360, visible: false },
  { id: "reference", label: "Reference", width: 230, visible: false },
  { id: "author", label: "Author", width: 150, visible: false },
] as const;
export type ColumnId = typeof columns[number]["id"];
// Column preferences shared by every record table: order, hidden columns, widths and wrapping.
export type ColumnDef<Id extends string> = { readonly id: Id; readonly label: string; readonly width: number; readonly visible: boolean };
export type TableView<Id extends string = ColumnId> = { order: Id[]; hidden: Id[]; widths: Partial<Record<Id, number>>; wrap: boolean };
export function defaultViewFor<Id extends string>(defs: readonly ColumnDef<Id>[]): TableView<Id> {
  return { order: defs.map(c => c.id), hidden: defs.filter(c => !c.visible).map(c => c.id), widths: {}, wrap: true };
}
// Restores a saved view, dropping unknown columns; the `locked` column always stays visible.
export function readViewFor<Id extends string>(defs: readonly ColumnDef<Id>[], locked: Id, raw: unknown): TableView<Id> {
  const fallback = defaultViewFor(defs);
  if (!raw || typeof raw !== "object") return fallback;
  const v = raw as Record<string, unknown>;
  const known = (id: unknown): id is Id => defs.some(c => c.id === id);
  const order = [...new Set(Array.isArray(v.order) ? v.order.filter(known) : [])];
  return { order: [...order, ...defs.map(c => c.id).filter(id => !order.includes(id))],
    hidden: (Array.isArray(v.hidden) ? v.hidden.filter(known) : fallback.hidden).filter(id => id !== locked),
    widths: Object.fromEntries(Object.entries(v.widths && typeof v.widths === "object" ? v.widths : {})
      .filter(([id, width]) => known(id) && typeof width === "number" && Number.isFinite(width) && width >= 100 && width <= 600)) as Partial<Record<Id, number>>, wrap: v.wrap !== false };
}
export const defaultView: TableView = defaultViewFor(columns);
export function readView(raw: unknown): TableView { return readViewFor(columns, "title", raw); }
export const statuses = ["open", "candidate", "published", "rejected", "superseded", "recorded", "reported", "correction_recorded"];
export function label(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "); }
export function itemKey(item: CatalogItem) { return `${item.kind}:${item.id}`; }
export function filterItems(items: CatalogItem[], query: URLSearchParams) {
  const term = (query.get("q") ?? "").trim().toLocaleLowerCase();
  const kinds = query.getAll("type");
  const selectedStatuses = query.getAll("status");
  const sort = columns.find(c => c.id === query.get("sort"))?.id ?? "updatedAt";
  const direction = query.get("order") === "asc" ? 1 : -1;
  return items.filter(item => (!kinds.length || kinds.includes(item.kind)) && (!selectedStatuses.length || selectedStatuses.includes(item.status)) &&
    (!term || [item.title, item.description, item.reference, item.author, ...item.appliesTo,
      ...(item.record.kind !== "ticket" ? item.record.value.evidence.flatMap(e => [e.reference, e.summary]) : [])]
      .join(" ").toLocaleLowerCase().includes(term)))
    .sort((a, b) => String(a[sort]).localeCompare(String(b[sort]), undefined, { numeric: true }) * direction || itemKey(a).localeCompare(itemKey(b)));
}
