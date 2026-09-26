import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createTeamAuthentication, hashTeamToken, validateTeamAuthConfig, type TeamAuthConfig } from "./auth.js";

const token = "synthetic-writer-token-for-tests-00000001";
const config: TeamAuthConfig = {
  grants: [{ actorId: "engineer-a", tokenHash: hashTeamToken(token), role: "writer" }],
  sessionSecret: "synthetic-session-secret-for-tests-00000001", publicOrigin: "https://team.example.test",
};
function harness(settings = config, now = Date.now) {
  const app = Fastify(); const auth = createTeamAuthentication(settings, now); auth.registerSessions(app); return app;
}
function cookieFrom(headers: { "set-cookie"?: string | string[] }) {
  const value = headers["set-cookie"]; assert.equal(typeof value, "string"); return (value as string).split(";")[0]!;
}
test("team configuration validates origins, identities, grant hashes and session secrets without echoing secrets", () => {
  assert.deepEqual(validateTeamAuthConfig(config), config);
  for (const invalid of [
    { ...config, publicOrigin: "http://team.example.test" },
    { ...config, publicOrigin: "https://team.example.test/path" },
    { ...config, publicOrigin: "https://private:secret@team.example.test" },
    { ...config, sessionSecret: "private-secret" },
    { ...config, grants: [] },
    { ...config, grants: [...config.grants, ...config.grants] },
    { ...config, grants: [{ ...config.grants[0], actorId: "spoof\nheader" }] },
    { ...config, grants: [{ ...config.grants[0], tokenHash: token }] },
  ]) assert.throws(() => validateTeamAuthConfig(invalid), error => error instanceof Error && !error.message.includes("private-secret") && !error.message.includes(token));
});

test("sessions require same-origin login, expire, reject tampering, and clear securely", async () => {
  let now = Date.now(); const app = harness(config, () => now);
  try {
    assert.deepEqual((await app.inject({ url: "/session" })).json(), { authenticated: false, mode: "team" });
    assert.equal((await app.inject({ method: "POST", url: "/session", payload: { token } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/session", headers: { origin: "https://attacker.example" }, payload: { token } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/session", headers: { origin: config.publicOrigin }, payload: { token: "invalid-long-team-access-token-000000000" } })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/session", headers: { origin: config.publicOrigin }, payload: { token } });
    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.json(), { authenticated: true, mode: "team", actorId: "engineer-a", role: "writer" });
    assert.ok(!login.body.includes(token));
    const setCookie = login.headers["set-cookie"] as string;
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=28800"]) assert.ok(setCookie.includes(flag));
    const cookie = cookieFrom(login.headers);
    assert.equal((await app.inject({ url: "/session", headers: { cookie } })).json().actorId, "engineer-a");
    assert.equal((await app.inject({ url: "/session", headers: { cookie, authorization: "Bearer invalid" } })).json().authenticated, false);
    assert.equal((await app.inject({ url: "/session", headers: { cookie: `${cookie}corrupt` } })).json().authenticated, false);
    assert.equal((await app.inject({ url: "/session", headers: { cookie: `${cookie}; ${cookie}` } })).json().authenticated, false);
    now += 8 * 60 * 60 * 1000;
    assert.equal((await app.inject({ url: "/session", headers: { cookie } })).json().authenticated, false);
    assert.equal((await app.inject({ method: "DELETE", url: "/session", headers: { cookie } })).statusCode, 403);
    const logout = await app.inject({ method: "DELETE", url: "/session", headers: { cookie, origin: config.publicOrigin } });
    assert.equal(logout.statusCode, 200); assert.ok((logout.headers["set-cookie"] as string).includes("Max-Age=0"));
  } finally { await app.close(); }
});

test("removing a grant invalidates both its bearer token and an existing signed session", async () => {
  const first = harness(); const revoked = harness({ ...config, grants: [{ actorId: "engineer-b", tokenHash: hashTeamToken("another-synthetic-team-token-000000002"), role: "reader" }] });
  try {
    const login = await first.inject({ method: "POST", url: "/session", headers: { origin: config.publicOrigin }, payload: { token } });
    const cookie = cookieFrom(login.headers);
    assert.equal((await revoked.inject({ url: "/session", headers: { cookie } })).json().authenticated, false);
    assert.equal((await revoked.inject({ url: "/session", headers: { authorization: `Bearer ${token}` } })).json().authenticated, false);
  } finally { await Promise.all([first.close(), revoked.close()]); }
});
