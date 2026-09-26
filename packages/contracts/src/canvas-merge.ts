import type { CanvasInput } from "./canvas.js";

// Three-way merge of canvas revisions, keyed by node and edge ID. `base` is the revision a draft
// started from, `mine` the draft and `theirs` the latest saved revision. Changes on one side win;
// when both sides changed the same item differently, the draft wins, except that an item one side
// removed and the other edited is kept, so no one's edit disappears. Every such case is reported.
export interface CanvasMerge { canvas: CanvasInput; conflicts: string[]; theirs: number }

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  : value;
export const sameContent = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

type Item = { id: string };
function mergeItems<T extends Item>(base: T[], mine: T[], theirs: T[], name: (item: T) => string, conflicts: string[]) {
  const index = (items: T[]) => new Map(items.map(item => [item.id, item]));
  const b = index(base), m = index(mine), t = index(theirs);
  const merged = new Map<string, T>(); let fromTheirs = 0;
  // Theirs' order first, then items only the draft added, in draft order.
  for (const id of [...new Set([...t.keys(), ...m.keys(), ...b.keys()])]) {
    const was = b.get(id), draft = m.get(id), saved = t.get(id);
    let result: T | undefined;
    if (sameContent(draft, was)) { result = saved; if (!sameContent(saved, was)) fromTheirs++; }
    else if (sameContent(saved, was) || sameContent(draft, saved)) result = draft;
    else {
      result = draft ?? saved;
      const label = name((draft ?? saved ?? was)!);
      conflicts.push(!draft ? `${label} (kept: edited by another writer after you removed it)` : !saved ? `${label} (kept: removed by another writer after you edited it)` : label);
    }
    if (result) merged.set(id, result);
  }
  return { items: [...merged.values()], fromTheirs };
}

export function mergeCanvas(base: CanvasInput, mine: CanvasInput, theirs: CanvasInput, name: (id: string, canvas: CanvasInput) => string = id => id): CanvasMerge {
  const conflicts: string[] = []; let fromTheirs = 0;
  const field = <K extends "title" | "description" | "kind" | "order">(key: K): CanvasInput[K] => {
    if (sameContent(mine[key], base[key])) { if (!sameContent(theirs[key], base[key])) fromTheirs++; return theirs[key]; }
    if (!sameContent(theirs[key], base[key]) && !sameContent(theirs[key], mine[key])) conflicts.push(`canvas ${key}`);
    return mine[key];
  };
  const title = field("title"), description = field("description"), kind = field("kind"), order = field("order");
  const nodeName = (node: { id: string }) => name(node.id, mine.nodes.some(item => item.id === node.id) ? mine : theirs);
  const nodes = mergeItems(base.nodes, mine.nodes, theirs.nodes, nodeName, conflicts);
  const ids = new Set(nodes.items.map(node => node.id));
  const edges = mergeItems(base.edges, mine.edges, theirs.edges, edge => `connection "${edge.label || edge.id}"`, conflicts);
  // A connection survives only while both of its placements do.
  const kept = edges.items.filter(edge => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  fromTheirs += nodes.fromTheirs + edges.fromTheirs;
  const canvas: CanvasInput = { title, description, nodes: nodes.items, edges: kept };
  if (kind !== undefined) canvas.kind = kind;
  if (order !== undefined) canvas.order = order;
  return { canvas, conflicts, theirs: fromTheirs };
}
