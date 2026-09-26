import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient } from "mongodb";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { TicketInputSchema } from "../../../packages/contracts/src/tickets.js";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository } from "./repository.js";
import { InMemoryTicketRepository, MongoTicketRepository } from "./tickets.js";

const scope = { teamId: "catalog-test-team", projectId: "catalog-test-project" };
const input = { summary: "Check duplicate feed entries", description: "  Synthetic human description.\nKeep whitespace and <script> as text.  ", component: "activity-feed" };

test("ticket creation is authenticated, strictly validated, scoped and retry safe", async () => {
  const tickets = new InMemoryTicketRepository();
  const app = buildApp({ repository: new InMemoryLessonRepository(), tickets, token: "catalog-test-token", scope, storage: "memory" });
  const id = randomUUID();
  const headers = { authorization: "Bearer catalog-test-token", "idempotency-key": id };
  try {
    assert.equal((await app.inject({ method: "POST", url: "/v1/tickets", payload: input })).statusCode, 401);
    assert.equal((await app.inject({ url: "/v1/tickets" })).statusCode, 401);
    for (const bad of [{ ...input, summary: "  " }, { ...input, status: "published" }, { ...input, teamId: "other-team" }, { ...input, userDescription: "overwrite" }]) {
      assert.equal((await app.inject({ method: "POST", url: "/v1/tickets", headers, payload: bad })).statusCode, 400);
    }
    const created = await app.inject({ method: "POST", url: "/v1/tickets", headers, payload: input });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().id, id);
    assert.equal(created.json().teamId, scope.teamId);
    assert.equal(created.json().status, "open");
    assert.equal(created.json().description, input.description);
    const retry = await app.inject({ method: "POST", url: "/v1/tickets", headers, payload: input });
    assert.deepEqual(retry.json(), created.json());
    assert.equal((await app.inject({ method: "POST", url: "/v1/tickets", headers, payload: { ...input, summary: "Changed request" } })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: "/v1/tickets", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { ...input, key: created.json().key } })).statusCode, 409);
    assert.equal((await app.inject({ url: "/v1/tickets", headers })).json().tickets.length, 1);
    assert.deepEqual((await app.inject({ url: `/v1/tickets/${id}`, headers })).json(), created.json());
    assert.equal((await app.inject({ url: `/v1/tickets/${randomUUID()}`, headers })).statusCode, 404);
    assert.deepEqual(await tickets.list({ ...scope, teamId: "other-team" }), []);
    assert.equal(await tickets.get({ ...scope, projectId: "other-project" }, id), null);
    assert.equal((await app.inject({ url: "/v1/memory", headers })).json().lessons.length, 0);
  } finally { await app.close(); }
});

test("catalog filters apply across the loaded window with stable identities and bounded preferences", async () => {
  const { projectItems, filterItems, readView, defaultView } = await import("../../dashboard/src/catalog/model.js");
  const tickets = new InMemoryTicketRepository();
  for (let index = 0; index < 25; index++) await tickets.create(scope, randomUUID(), TicketInputSchema.parse({ summary: `Ticket ${index}`, component: index === 24 ? "rare-component" : "common" }));
  const records = projectItems(demoLessons, await tickets.list(scope));
  assert.equal(records.length, 26);
  assert.equal(filterItems(records, new URLSearchParams("type=ticket&q=rare-component")).length, 1);
  assert.equal(filterItems(records, new URLSearchParams("type=ticket&type=lesson&status=open&status=published")).length, 26);
  assert.equal(filterItems(records, new URLSearchParams("type=lesson&status=open")).length, 0);
  assert.equal(filterItems(records, new URLSearchParams("type=lesson&q=DEMO-101")).length, 1);
  const before = JSON.stringify(records);
  const result = filterItems(records, new URLSearchParams("sort=title&order=asc"));
  assert.equal(result.length, records.length);
  assert.equal(JSON.stringify(records), before);
  const malformed = readView({ order: ["title", "unknown", "title"], hidden: ["title", "description", "unknown"], widths: { title: -10, description: 440, reference: Infinity }, wrap: false });
  assert.equal(malformed.order.length, defaultView.order.length);
  assert.deepEqual(malformed.hidden, ["description"]);
  assert.deepEqual(malformed.widths, { description: 440 });
  assert.equal(malformed.wrap, false);
});

const mongoUri = process.env.MONGODB_GATE_URI?.trim();
test("Mongo tickets survive reconnection and concurrent retries without duplication", { skip: mongoUri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_catalog_test_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(mongoUri!);
  let repository = await MongoTicketRepository.connect(mongoUri!, database);
  try {
    const id = randomUUID();
    const data = TicketInputSchema.parse(input);
    const results = await Promise.all(Array.from({ length: 4 }, () => repository.create(scope, id, data)));
    assert.ok(results.every(item => item.id === id));
    await repository.close();
    repository = await MongoTicketRepository.connect(mongoUri!, database);
    const loaded = await repository.get(scope, id);
    assert.equal(loaded?.description, input.description);
    assert.equal((await repository.list(scope)).length, 1);
    assert.equal(await repository.get({ ...scope, projectId: "other-project" }, id), null);
    await assert.rejects(repository.create(scope, randomUUID(), { ...data, key: loaded!.key }), /reference already exists/);
  } finally {
    await repository.close(); await client.connect(); await client.db(database).dropDatabase(); await client.close();
  }
});
