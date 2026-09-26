import assert from "node:assert/strict";
import test from "node:test";
import { CanvasResponseSchema } from "../../../packages/contracts/src/canvas.js";
import * as live from "../src/catalog/api.js";
import * as preview from "./api.js";
import { canvasId, HealthResponse, loadCatalog, request } from "./api.js";

// vite.preview.config.ts swaps the live module for this one; a missing export stops every view from loading.
test("the preview provides every export of the live API module", () => {
  const provided = new Map(Object.entries(preview));
  assert.deepEqual(Object.entries(live).filter(([name, value]) => typeof provided.get(name) !== typeof value).map(([name]) => name), []);
});

test("preview records and canvas resolve without network access", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Preview must not access the network"); };
  try {
    const catalog = await loadCatalog(new AbortController().signal);
    assert.equal(HealthResponse.parse(await request("/health")).storageLabel, "Sample preview");
    const canvas = CanvasResponseSchema.parse(await request(`/v1/canvases/${canvasId}`));
    assert.deepEqual(canvas.record.teamId, catalog.scope.teamId);
    for (const ref of canvas.references) {
      const record = await request(`/v1/${ref.kind === "ticket" ? "tickets" : "lessons"}/${ref.id}`);
      assert.equal(record.id, ref.id);
      assert.equal(record.projectId, catalog.scope.projectId);
    }
    assert.deepEqual((await request("/v1/evaluations")).evaluations, []);
    assert.deepEqual(catalog.activity, []);
    assert.deepEqual(await request("/v1/activity?limit=100&rootKind=ticket&rootId=sample"), { scope: catalog.scope, records: [], nextCursor: null });
  } finally { globalThis.fetch = original; }
});

test("writes and unknown records cannot fall through to a live API", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(request("/v1/tickets", { method }), /read-only/);
  }
  await assert.rejects(request("/v1/tickets/unknown"), /not part of/);
  await assert.rejects(request("/__proto__"), /not part of/);
});

test("unsaved layout changes do not mutate shared sample data", async () => {
  const first = await request(`/v1/canvases/${canvasId}`);
  first.record.canvas.title = "Unsaved edit";
  assert.notEqual((await request(`/v1/canvases/${canvasId}`)).record.canvas.title, first.record.canvas.title);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(loadCatalog(abort.signal), { name: "AbortError" });
});
