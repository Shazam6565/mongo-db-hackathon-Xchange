import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { buildApp } from "./app.js";
import { hashTeamToken, type TeamAuthConfig } from "./auth.js";
import { loadHostedConfig } from "./hosted-config.js";
import { createHostedHandler } from "./hosted.js";
import { InMemoryLessonRepository } from "./repository.js";
import { createRuntime } from "./runtime.js";
import { loadConfig } from "./config.js";

const origin = "https://team.example.test";
const tokens = { alice: "synthetic-alice-token-for-hosted-test-00001", bob: "synthetic-bob-token-for-hosted-test-00002" };
const teamAuth: TeamAuthConfig = { grants: Object.entries(tokens).map(([actorId, token]) => ({ actorId, tokenHash: hashTeamToken(token), role: "writer" })), sessionSecret: "synthetic-session-secret-for-hosted-test-00001", publicOrigin: origin };
const scope = { teamId: "hosted-test-team", projectId: "hosted-test-project" };
const observation = { kind: "observation", title: "Connection check", detail: "Synthetic authenticated write/read check.", evidence: [{ reference: "test:hosted-team", summary: "Two independent team credentials and a fresh application instance." }] };
function request(path: string, actor?: keyof typeof tokens, body?: unknown, method = body ? "POST" : "GET", operation = randomUUID()) {
  return new Request(`${origin}${path}`, { method, headers: { ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}), "content-type": "application/json", "idempotency-key": operation }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("hosted configuration fails closed without explicit MongoDB, scope and team access", () => {
  const configured = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_DATABASE: "hosted_test", TEAM_ID: scope.teamId, PROJECT_ID: scope.projectId, TEAM_ACCESS_GRANTS: JSON.stringify(teamAuth.grants), TEAM_SESSION_SECRET: teamAuth.sessionSecret, TEAM_PUBLIC_ORIGIN: origin };
  assert.throws(() => loadHostedConfig({}));
  for (const key of Object.keys(configured)) { const env: NodeJS.ProcessEnv = { ...configured }; delete env[key]; assert.throws(() => loadHostedConfig(env), key); }
  assert.throws(() => loadHostedConfig({ ...configured, STORAGE_MODE: "memory" }));
  assert.throws(() => loadHostedConfig({ ...configured, TEAM_PUBLIC_ORIGIN: "http://team.example.test" }));
  assert.equal(loadHostedConfig(configured).settings.token, "");
  // Guest reading is opt-in; only the exact value "true" enables it.
  assert.equal(loadHostedConfig(configured).teamAuth.guestRead, false);
  assert.equal(loadHostedConfig({ ...configured, TEAM_GUEST_READ: "yes" }).teamAuth.guestRead, false);
  assert.equal(loadHostedConfig({ ...configured, TEAM_GUEST_READ: "true" }).teamAuth.guestRead, true);
});

test("Vercel transport preserves routing, filters, cookies and API errors", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository(), teamAuth, scope, storage: "memory", token: "disabled" });
  const fetch = createHostedHandler(async () => app);
  try {
    assert.equal((await fetch(request("/api/v1/activity"))).status, 401);
    const record = await fetch(request("/api/index?route=v1/activity", "alice", observation));
    assert.equal(record.status, 201); const saved = await record.json();
    assert.equal(saved.actorLabel, "alice");
    const response = await fetch(request("/api/index?route=v1/activity&kind=decision&limit=1", "bob"));
    assert.deepEqual((await response.json()).records, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
    // Vercel appends the rewrite source's named segment to the query as `path`.
    const rewritten = await fetch(request("/api/index?route=v1/activity&limit=100&path=v1/activity", "bob"));
    assert.equal(rewritten.status, 200);
    assert.equal((await rewritten.json()).records.length, 1);
    const read = await fetch(request(`/v1/activity/${saved.id}`, "bob"));
    assert.equal((await read.json()).id, saved.id);
    const largeCanvas = { expectedRevision: 0, canvas: { title: "Large valid canvas", description: "", nodes: Array.from({ length: 40 }, (_, i) => ({ kind: "note", id: `note-${i}`, title: "Note", text: "x".repeat(2000), x: i, y: 0, color: "neutral" })), edges: [] } };
    assert.equal((await fetch(request(`/api/v1/canvases/${randomUUID()}`, "alice", largeCanvas, "PUT"))).status, 200, "hosted transport retains the canvas route's 512 KiB allowance");
    const login = await fetch(new Request(`${origin}/api/index?route=session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: tokens.bob }) }));
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
    const session = await fetch(new Request(`${origin}/api/session`, { headers: { cookie: cookie.split(";")[0]! } }));
    assert.equal((await session.json()).actorId, "bob");
    const oversized = new Request(`${origin}/api/v1/activity`, { method: "POST", body: "x".repeat(512 * 1024 + 1) });
    assert.equal((await fetch(oversized)).status, 413);
    assert.equal((await fetch(request("/api/unknown"))).status, 404);
    assert.equal((await fetch(request("/health", undefined, undefined, "HEAD"))).status, 200);
  } finally { await app.close(); }
  const unavailable = createHostedHandler(async () => { throw new Error("mongodb://private:secret@cluster"); });
  const failed = await unavailable(request("/api/session"));
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("secret"));
});

const uri = process.env.MONGODB_GATE_URI?.trim();
test("two hosted team clients persist shared tickets, activity and canvas across a fresh Mongo runtime", { skip: uri ? false : "MONGODB_GATE_URI is not set" }, async () => {
  const database = `team_hosted_test_${randomUUID().replaceAll("-", "")}`;
  const settings = loadConfig({ MONGODB_URI: uri, MONGODB_DATABASE: database, TEAM_ID: scope.teamId, PROJECT_ID: scope.projectId });
  let app = await createRuntime(settings, teamAuth);
  let fetch = createHostedHandler(async () => app);
  const cleanup = new MongoClient(uri!);
  try {
    const ticketResponse = await fetch(request("/api/v1/tickets", "alice", { summary: "Synthetic team connection check", description: "Disposable integration test", component: null, acceptanceCriteria: [] }));
    assert.equal(ticketResponse.status, 201); const ticket = await ticketResponse.json();
    const eventResponse = await fetch(request("/api/v1/activity", "bob", observation));
    assert.equal(eventResponse.status, 201); const event = await eventResponse.json();
    const id = randomUUID(), operation = randomUUID();
    const canvas = { title: "Synthetic shared check", description: "", nodes: [{ kind: "record", id: "ticket", x: 0, y: 0, color: "neutral", ref: { kind: "ticket", id: ticket.id } }], edges: [] };
    const save = () => fetch(request(`/api/v1/canvases/${id}`, "alice", { expectedRevision: 0, canvas }, "PUT", operation));
    assert.equal((await save()).status, 200); assert.equal((await save()).status, 200);
    const race = await Promise.all((["alice", "bob"] as const).map(actor => fetch(request(`/v1/canvases/${id}`, actor, { expectedRevision: 1, canvas: { ...canvas, title: `Written by ${actor}` } }, "PUT"))));
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    await app.close(); app = await createRuntime(settings, teamAuth); fetch = createHostedHandler(async () => app);
    assert.equal((await (await fetch(request(`/v1/tickets/${ticket.id}`, "bob"))).json()).id, ticket.id);
    assert.equal((await (await fetch(request(`/v1/activity/${event.id}`, "alice"))).json()).actorLabel, "bob");
    const persisted = await (await fetch(request(`/v1/canvases/${id}`, "bob"))).json();
    assert.equal(persisted.record.revision, 2);
    assert.equal((await fetch(request(`/v1/canvases/${id}`))).status, 401);
    const foreignApp = await createRuntime({ ...settings, scope: { ...scope, projectId: "other-project" } }, teamAuth);
    try { assert.equal((await createHostedHandler(async () => foreignApp)(request(`/v1/canvases/${id}`, "alice"))).status, 404); }
    finally { await foreignApp.close(); }
  } finally { await app.close(); await cleanup.connect(); await cleanup.db(database).dropDatabase(); await cleanup.close(); }
});
