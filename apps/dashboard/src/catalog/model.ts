import type { Lesson } from "@team-memory/contracts";
import type { TicketRecord } from "../../../../packages/contracts/src/tickets.js";

export type CatalogItem = {
  id: string; kind: "lesson" | "ticket"; title: string; description: string;
  status: string; reference: string; appliesTo: string[]; author: string; updatedAt: string;
  record: { kind: "lesson"; value: Lesson } | { kind: "ticket"; value: TicketRecord };
};
export function projectItems(lessons: Lesson[], tickets: TicketRecord[]): CatalogItem[] {
  return [
    ...lessons.map((value): CatalogItem => ({ id: value.id, kind: "lesson", title: value.title, description: value.lesson,
      status: value.status, reference: value.id, appliesTo: value.appliesTo, author: value.authorId,
      updatedAt: value.updatedAt, record: { kind: "lesson", value } })),
    ...tickets.map((value): CatalogItem => ({ id: value.id, kind: "ticket", title: value.summary, description: value.description,
      status: value.status, reference: value.key, appliesTo: value.component ? [value.component] : [], author: "",
      updatedAt: value.updatedAt, record: { kind: "ticket", value } })),
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
export type TableView = { order: ColumnId[]; hidden: ColumnId[]; widths: Partial<Record<ColumnId, number>>; wrap: boolean };
export const defaultView: TableView = { order: columns.map(c => c.id), hidden: columns.filter(c => !c.visible).map(c => c.id), widths: {}, wrap: true };
export function readView(raw: unknown): TableView {
  if (!raw || typeof raw !== "object") return defaultView;
  const v = raw as Record<string, unknown>;
  const known = (id: unknown): id is ColumnId => columns.some(c => c.id === id);
  const order = [...new Set(Array.isArray(v.order) ? v.order.filter(known) : [])];
  return { order: [...order, ...columns.map(c => c.id).filter(id => !order.includes(id))],
    hidden: (Array.isArray(v.hidden) ? v.hidden.filter(known) : defaultView.hidden).filter(id => id !== "title"),
    widths: Object.fromEntries(Object.entries(v.widths && typeof v.widths === "object" ? v.widths : {})
      .filter(([id, width]) => known(id) && typeof width === "number" && Number.isFinite(width) && width >= 100 && width <= 600)), wrap: v.wrap !== false };
}
export const statuses = ["open", "candidate", "published", "rejected", "superseded"];
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
      ...(item.record.kind === "lesson" ? item.record.value.evidence.flatMap(e => [e.reference, e.summary]) : [])]
      .join(" ").toLocaleLowerCase().includes(term)))
    .sort((a, b) => String(a[sort]).localeCompare(String(b[sort]), undefined, { numeric: true }) * direction || itemKey(a).localeCompare(itemKey(b)));
}
