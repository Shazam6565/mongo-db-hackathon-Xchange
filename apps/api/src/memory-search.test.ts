import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { composeMemoryQuery, renderMemory, type Lesson, type Scope } from "@team-memory/contracts";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { hashTeamToken } from "./auth.js";
import { InMemoryLessonRepository, type LessonSearchResult } from "./repository.js";
import { InMemoryTicketRepository } from "./tickets.js";
import { vectorIndexDefinition } from "./vector-setup.js";

const scope = { teamId: "demo-team", projectId: "event-platform" };
const headers = { authorization: "Bearer test-token", "x-engineer-id": "engineer-b" };
const published = demoLessons[0]!;
const frontend: Lesson = { ...published, id: "frontend-lesson", title: "Compare API response with rendered UI", appliesTo: ["frontend"] };

// Stands in for Atlas: records the query text and returns fixed scores.
class ScoredRepository extends InMemoryLessonRepository {
  queries: string[] = [];
  constructor(seed: Lesson[], private readonly result: (text: string) => LessonSearchResult) { super(seed); }
  async search(_scope: Scope, text: string, _limit: number): Promise<LessonSearchResult> {
    this.queries.push(text);
    return this.result(text);
  }
}

async function ticketsWith(key: string, summary: string, description: string) {
  const tickets = new InMemoryTicketRepository();
  await tickets.create(scope, randomUUID(), { key, summary, description, component: null, acceptanceCriteria: [] });
  return tickets;
}

test("without Atlas, search falls back to labelled recent lessons and records consumption", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository([published]), token: "test-token", scope, storage: "memory" });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/v1/memory/search", payload: { query: "x" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/v1/memory/search", headers, payload: { query: "" } })).statusCode, 400);
    const response = await app.inject({ method: "POST", url: "/v1/memory/search", headers, payload: { query: "duplicate notifications", ticketKey: "NOPE-1" } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.lessons.map((lesson: Lesson) => lesson.id), [published.id]);
    assert.equal(body.retrieval.mode, "recent");
    assert.equal(body.retrieval.ticketKey, null);
    assert.match(body.retrieval.note, /requires MongoDB Atlas/);
    assert.match(body.retrieval.note, /NOPE-1 is not in this project/);
    const audit = (await app.inject({ url: "/v1/audit", headers })).json();
    const consumed = audit.events.find((event: { kind: string }) => event.kind === "memory.consumed");
    assert.equal(consumed.actorId, "engineer-b");
    assert.deepEqual(consumed.consumed, [{ id: published.id, version: published.version }]);
  } finally { await app.close(); }
});

test("vector search returns every lesson, most relevant to the ticket first, with scores", async () => {
  const repository = new ScoredRepository([published, frontend], () => ({
    available: true,
    hits: [{ lesson: frontend, score: 0.76 }, { lesson: published, score: 0.62 }],
  }));
  const tickets = await ticketsWith("DEMO-118", "Reconnecting shows old likes again", "Feed replays likes after reconnect.");
  const app = buildApp({ repository, tickets, token: "test-token", scope, storage: "memory", vector: { model: "voyage-4" } });
  try {
    const response = await app.inject({ method: "POST", url: "/v1/memory/search", headers, payload: { query: "where should I look first?", ticketKey: "demo-118" } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.lessons.map((lesson: Lesson) => lesson.id), [frontend.id, published.id]);
    assert.deepEqual(body.retrieval, {
      mode: "vector", model: "voyage-4", ticketKey: "DEMO-118", note: null,
      scores: [{ id: frontend.id, score: 0.76 }, { id: published.id, score: 0.62 }],
    });
    assert.equal(body.lessons[0].searchText, undefined);
    assert.match(repository.queries[0]!, /^DEMO-118: Reconnecting shows old likes again\nFeed replays likes/);
    assert.match(repository.queries[0]!, /where should I look first\?$/);
    const memory = renderMemory(body);
    assert.match(memory, /Order: most relevant first, by Atlas Vector Search \(voyage-4\) for ticket DEMO-118/);
    assert.ok(memory.indexOf(frontend.title) < memory.indexOf(published.title));
    assert.match(memory, /relevance 0\.760/);
  } finally { await app.close(); }
});

test("an Atlas failure such as a rate limit falls back to recent lessons with the reason", async () => {
  const repository = new ScoredRepository([published], () => ({ available: false, reason: "Atlas Vector Search failed: rate limit exceeded" }));
  const app = buildApp({ repository, token: "test-token", scope, storage: "memory", vector: { model: "voyage-4" } });
  try {
    const body = (await app.inject({ method: "POST", url: "/v1/memory/search", headers, payload: { query: "duplicate push" } })).json();
    assert.equal(body.retrieval.mode, "recent");
    assert.match(body.retrieval.note, /rate limit/);
    assert.equal(body.lessons.length, 1);
  } finally { await app.close(); }
});

test("hosted readers may search memory even though search is a POST", async () => {
  const reader = "synthetic-team-access-token-reader-000000000001";
  const app = buildApp({
    repository: new InMemoryLessonRepository([published]), token: "unused", scope, storage: "memory",
    teamAuth: { grants: [{ actorId: "viewer", role: "reader", tokenHash: hashTeamToken(reader) }],
      sessionSecret: "synthetic-session-secret-for-search-test-01", publicOrigin: "https://team.example.test" },
  });
  try {
    const auth = { authorization: `Bearer ${reader}` };
    assert.equal((await app.inject({ method: "POST", url: "/v1/memory/search", headers: auth, payload: { query: "duplicates" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/v1/lessons", headers: auth, payload: {} })).statusCode, 403);
  } finally { await app.close(); }
});

test("query text is bounded and the index pre-filters scope and status", () => {
  const long = composeMemoryQuery("m".repeat(5000), { key: "T-1", summary: "s", description: "d".repeat(5000) });
  assert.ok(long.length <= 2000);
  assert.ok(long.startsWith("T-1: s\n"));
  assert.equal(composeMemoryQuery("  just the message  "), "just the message");
  const fields = vectorIndexDefinition("voyage-4").fields as { type: string; path: string; model?: string }[];
  assert.deepEqual(fields[0], { type: "autoEmbed", modality: "text", path: "searchText", model: "voyage-4" });
  assert.deepEqual(fields.filter((field) => field.type === "filter").map((field) => field.path), ["teamId", "projectId", "status"]);
});
