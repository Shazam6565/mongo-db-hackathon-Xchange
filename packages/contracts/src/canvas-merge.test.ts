import assert from "node:assert/strict";
import test from "node:test";
import { CanvasInputSchema, type CanvasInput } from "./canvas.js";
import { mergeCanvas, sameContent } from "./canvas-merge.js";

const note = (id: string, title: string, x = 0) => ({ id, kind: "note" as const, title, text: "", x, y: 0, color: "neutral" as const });
const base: CanvasInput = { title: "Plan", description: "", nodes: [note("a", "A"), note("b", "B", 300)], edges: [{ id: "ab", from: "a", to: "b", label: "then" }] };

test("changes from both sides combine when they touch different items", () => {
  const mine = { ...base, nodes: [{ ...base.nodes[0]!, x: 40 }, base.nodes[1]!, note("c", "Mine")] };
  const theirs = { ...base, description: "Agent summary", nodes: [base.nodes[0]!, { ...base.nodes[1]!, title: "B renamed" }] };
  const merged = mergeCanvas(base, mine, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.theirs, 2);
  assert.equal(merged.canvas.description, "Agent summary");
  assert.deepEqual(merged.canvas.nodes.map(node => [node.id, node.x, node.kind === "note" ? node.title : ""]), [["a", 40, "A"], ["b", 300, "B renamed"], ["c", 0, "Mine"]]);
  assert.equal(CanvasInputSchema.safeParse(merged.canvas).success, true);
});

test("the draft wins a same-item conflict and the conflict is reported", () => {
  const mine = { ...base, title: "Mine", nodes: [{ ...base.nodes[0]!, title: "A mine" }, base.nodes[1]!] };
  const theirs = { ...base, title: "Theirs", nodes: [{ ...base.nodes[0]!, title: "A theirs" }, base.nodes[1]!] };
  const merged = mergeCanvas(base, mine, theirs, id => `note ${id}`);
  assert.equal(merged.canvas.title, "Mine");
  assert.equal(merged.canvas.nodes[0]!.kind === "note" && merged.canvas.nodes[0]!.title, "A mine");
  assert.deepEqual(merged.conflicts, ["canvas title", "note a"]);
});

test("an edit survives the other side's removal, and dangling connections are dropped", () => {
  const mine = { ...base, nodes: [base.nodes[0]!], edges: [] };
  const theirs = { ...base, nodes: [base.nodes[0]!, { ...base.nodes[1]!, text: "Agent evidence" }] };
  const kept = mergeCanvas(base, mine, theirs);
  assert.equal(kept.canvas.nodes.length, 2);
  assert.match(kept.conflicts[0]!, /edited by another writer after you removed it/);
  const removedByThem = mergeCanvas(base, base, { ...base, nodes: [base.nodes[0]!], edges: [] });
  assert.deepEqual(removedByThem.canvas.nodes.map(node => node.id), ["a"]);
  assert.deepEqual(removedByThem.canvas.edges, []);
  const orphan = mergeCanvas(base, { ...base, edges: [...base.edges, { id: "ba", from: "b", to: "a", label: "" }] }, { ...base, nodes: [base.nodes[0]!], edges: [] });
  assert.deepEqual(orphan.canvas.edges, []);
});

test("content comparison ignores key order and absent optional fields", () => {
  assert.equal(sameContent({ a: 1, b: { c: 2, d: undefined } }, { b: { c: 2 }, a: 1 }), true);
  assert.equal(sameContent(base, { ...base, kind: undefined }), true);
  assert.equal(sameContent(base, { ...base, kind: "guide" }), false);
});
