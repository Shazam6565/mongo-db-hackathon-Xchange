import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSuite } from "@team-memory/evaluator";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository } from "./repository.js";
import { CorpusSchema, seedCorpus, type Corpus, type SeedLine } from "./seed.js";

const token = "test-token";
const headers = { authorization: `Bearer ${token}` };
const files = ["corpus/event-platform.json", "corpus/xchange.json"];
const raw = (file: string) => readFile(new URL(`../../../${file}`, import.meta.url), "utf8");

async function seeded(file: string, run: (lines: SeedLine[], corpus: Corpus, reseed: () => Promise<SeedLine[]>, snapshot: () => Promise<unknown>) => Promise<void>) {
  const corpus = CorpusSchema.parse(JSON.parse(await raw(file)));
  const app = buildApp({ repository: new InMemoryLessonRepository(), token, scope: corpus.scope, storage: "memory" });
  const snapshot = () => Promise.all(["/v1/tickets", "/v1/lessons", "/v1/evaluations", "/v1/audit", "/v1/activity?limit=100", "/v1/canvases"]
    .map(async (url) => (await app.inject({ url, headers })).json()));
  try { await run(await seedCorpus(app, corpus, token), corpus, () => seedCorpus(app, corpus, token), snapshot); }
  finally { await app.close(); }
}

test("each corpus seeds through the API without failures, and a second run changes nothing", async () => {
  for (const file of files) {
    await seeded(file, async (lines, _corpus, reseed, snapshot) => {
      assert.deepEqual(lines.filter((line) => line.outcome === "failed"), [], file);
      const before = await snapshot();
      const again = await reseed();
      assert.deepEqual(again.filter((line) => !["exists", "evaluated"].includes(line.outcome)), [], file);
      assert.deepEqual(await snapshot(), before, file);
    });
  }
});

test("only the gate publishes seeded lessons", async () => {
  const decisions = (lines: SeedLine[]) => Object.fromEntries(lines.filter((line) => line.kind === "evaluation").map((line) => [line.key, line.outcome]));
  await seeded("corpus/event-platform.json", async (lines) => {
    assert.deepEqual(decisions(lines), {
      "compare-api-with-rendered-state": "published",
      "all-duplicates-are-redelivery": "rejected",
      "dual-emit-schema-changes": "needs-review",
      "digest-recipient-timezone": "needs-review",
    });
  });
  await seeded("corpus/xchange.json", async (lines) => {
    assert.equal(lines.some((line) => line.outcome === "published"), false);
  });
});

test("corpora never contain the evaluator's held-out cases", async () => {
  const suite = loadSuite();
  for (const file of files) {
    const text = await raw(file);
    for (const item of suite.cases) {
      assert.equal(text.includes(item.ticket.key), false, `${file} contains held-out ticket ${item.ticket.key}`);
      assert.equal(text.includes(item.ticket.summary), false, `${file} contains the summary of ${item.ticket.key}`);
    }
  }
});
