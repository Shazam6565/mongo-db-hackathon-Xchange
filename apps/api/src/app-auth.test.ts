import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { demoCandidate } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { hashTeamToken, type TeamAuthConfig, type TeamRole } from "./auth.js";
import { InMemoryLessonRepository } from "./repository.js";

const scope = { teamId: "team-auth-test", projectId: "project-auth-test" };
const actors = { alice: "writer", bob: "writer", viewer: "reader", reviewer: "evaluator" } satisfies Record<string, TeamRole>;
const token = (actor: keyof typeof actors) => `synthetic-team-access-token-${actor}-000000000001`;
const config: TeamAuthConfig = {
  grants: Object.entries(actors).map(([actorId, role]) => ({ actorId, role, tokenHash: hashTeamToken(token(actorId as keyof typeof actors)) })),
  sessionSecret: "synthetic-session-secret-for-app-test-000001", publicOrigin: "https://team.example.test",
};
function harness() { return buildApp({ repository: new InMemoryLessonRepository(), token: "local-must-not-work", teamAuth: config, scope, storage: "memory" }); }
const headers = (actor: keyof typeof actors) => ({ authorization: `Bearer ${token(actor)}`, "x-engineer-id": "spoofed-owner" });
const observation = { kind: "observation", title: "Team write check", detail: "Synthetic check for authenticated team writes.", evidence: [{ reference: "test:team-access", summary: "This is a synthetic test record." }] };

test("two authenticated writers share scoped records with server-derived attribution", async () => {
  const app = harness();
  try {
    assert.equal((await app.inject({ url: "/v1/activity" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/v1/activity", headers: { authorization: "Bearer local-must-not-work" } })).statusCode, 401);
    for (const actor of ["alice", "bob"] as const) {
      const created = await app.inject({ method: "POST", url: "/v1/activity", headers: { ...headers(actor), "idempotency-key": randomUUID() }, payload: observation });
      assert.equal(created.statusCode, 201); assert.equal(created.json().actorLabel, actor); assert.equal(created.json().teamId, scope.teamId);
    }
    const rows = await app.inject({ url: "/v1/activity", headers: headers("bob") });
    assert.deepEqual(rows.json().records.map((row: { actorLabel: string }) => row.actorLabel).sort(), ["alice", "bob"]);
    assert.equal(rows.headers["cache-control"], "no-store");
    const proposal = await app.inject({ method: "POST", url: "/v1/lessons", headers: headers("alice"), payload: { ...demoCandidate, authorId: "spoofed-owner" } });
    assert.equal(proposal.statusCode, 201); assert.equal(proposal.json().authorId, "alice");
    await app.inject({ url: "/v1/memory", headers: headers("bob") });
    const audit = (await app.inject({ url: "/v1/audit", headers: headers("alice") })).json();
    assert.equal(audit.events.find((event: { kind: string }) => event.kind === "memory.consumed").actorId, "bob");
    assert.equal((await app.inject({ method: "POST", url: "/v1/activity", headers: { ...headers("alice"), "idempotency-key": randomUUID() }, payload: { ...observation, teamId: "foreign-team" } })).statusCode, 400);
  } finally { await app.close(); }
});

test("readers can recall memory; only evaluators can publish through the evaluation gate", async () => {
  const app = harness();
  try {
    assert.equal((await app.inject({ url: "/v1/memory", headers: headers("viewer") })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/v1/activity", headers: { ...headers("viewer"), "idempotency-key": randomUUID() }, payload: observation })).statusCode, 403);
    const proposal = (await app.inject({ method: "POST", url: "/v1/lessons", headers: headers("alice"), payload: demoCandidate })).json();
    for (const actor of ["viewer", "alice"] as const) assert.equal((await app.inject({ method: "POST", url: `/v1/lessons/${proposal.id}/evaluate`, headers: headers(actor), payload: { expectedVersion: 1 } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: `/v1/lessons/${proposal.id}/evaluate`, headers: headers("reviewer"), payload: { expectedVersion: 1 } })).statusCode, 200);
  } finally { await app.close(); }
});

test("browser cookies require exact origin on writes while bearer agents work without Origin", async () => {
  const app = harness();
  try {
    const login = await app.inject({ method: "POST", url: "/session", headers: { origin: config.publicOrigin }, payload: { token: token("alice") } });
    const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
    assert.equal((await app.inject({ url: "/v1/activity", headers: { cookie } })).statusCode, 200);
    for (const origin of [undefined, "https://attacker.example", `${config.publicOrigin}.attacker.example`]) {
      const requestHeaders = { cookie, "idempotency-key": randomUUID(), ...(origin ? { origin } : {}) };
      assert.equal((await app.inject({ method: "POST", url: "/v1/activity", headers: requestHeaders, payload: observation })).statusCode, 403);
    }
    const created = await app.inject({ method: "POST", url: "/v1/activity", headers: { cookie, origin: config.publicOrigin, "x-engineer-id": "spoofed-owner", "idempotency-key": randomUUID() }, payload: observation });
    assert.equal(created.statusCode, 201); assert.equal(created.json().actorLabel, "alice");
    assert.equal((await app.inject({ method: "POST", url: "/v1/activity", headers: { ...headers("bob"), "idempotency-key": randomUUID() }, payload: observation })).statusCode, 201);
  } finally { await app.close(); }
});

test("local owner mode keeps its existing bearer contract and needs no browser sign-in", async () => {
  const app = buildApp({ repository: new InMemoryLessonRepository(), token: "local-test", scope, storage: "memory" });
  try {
    assert.deepEqual((await app.inject({ url: "/session" })).json(), { authenticated: true, mode: "local" });
    assert.equal((await app.inject({ url: "/v1/activity" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/v1/activity", headers: { authorization: "Bearer local-test" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/session", payload: { token: "local-test" } })).statusCode, 404);
  } finally { await app.close(); }
});
