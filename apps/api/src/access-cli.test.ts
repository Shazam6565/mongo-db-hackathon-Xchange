import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { issueCredential } from "./access-cli.js";
import { hashTeamToken } from "./auth.js";
import { buildApp } from "./app.js";
import { InMemoryLessonRepository } from "./repository.js";

test("issued credentials enroll as distinct identities, work through bearer and browser access, and have private permissions", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "team-access-test-"));
  const origin = "https://team.example.test";
  try {
    const tokens: string[] = []; const grants = [];
    for (const actor of ["teammate.alex", "agent.alex.pi"]) {
      const result = await issueCredential({ actor, role: "writer", origin, out: join(temporary, actor) });
      const env = await readFile(join(result.directory, "credential.env"), "utf8");
      const token = /^TEAM_API_TOKEN=(.+)$/m.exec(env)![1]!;
      const grant = JSON.parse(await readFile(join(result.directory, "grant.json"), "utf8"));
      assert.match(env, /^TEAM_API_URL=https:\/\/team.example.test\n/);
      assert.equal(grant.tokenHash, hashTeamToken(token));
      assert.ok(!JSON.stringify(result).includes(token));
      assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
      for (const file of ["credential.env", "grant.json"]) assert.equal((await stat(join(result.directory, file))).mode & 0o777, 0o600);
      tokens.push(token); grants.push(grant);
    }
    assert.notEqual(tokens[0], tokens[1]);
    const scope = { teamId: "test-team", projectId: "test-project" };
    const app = buildApp({ repository: new InMemoryLessonRepository(), storage: "memory", token: "unused-local", scope,
      teamAuth: { grants, publicOrigin: origin, sessionSecret: "synthetic-test-session-secret-000000000001" } });
    try {
      assert.equal((await app.inject({ url: "/v1/access" })).statusCode, 401);
      assert.equal((await app.inject({ url: "/v1/access", headers: { authorization: "Bearer invalid" } })).statusCode, 401);
      for (let i = 0; i < tokens.length; i++) {
        const reply = await app.inject({ url: "/v1/access", headers: { authorization: `Bearer ${tokens[i]}`, "x-engineer-id": "spoofed" } });
        assert.equal(reply.statusCode, 200);
        assert.deepEqual(reply.json(), { mode: "team", actorId: grants[i].actorId, role: "writer", scope });
        assert.equal(reply.headers["cache-control"], "no-store");
        assert.ok(!reply.body.includes(tokens[i]!) && !reply.body.includes(grants[i].tokenHash));
      }
      const login = await app.inject({ method: "POST", url: "/session", headers: { origin }, payload: { token: tokens[0] } });
      const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
      assert.equal((await app.inject({ url: "/v1/access", headers: { cookie } })).json().actorId, "teammate.alex");
    } finally { await app.close(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("issuance refuses overwrites, repository destinations, invalid roles and unsafe origins", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "team-access-test-"));
  const input = { actor: "agent.alex.pi", role: "reader", origin: "https://team.example.test", out: join(temporary, "credential") };
  try {
    await issueCredential(input);
    const original = await readFile(join(input.out, "credential.env"), "utf8");
    await assert.rejects(issueCredential(input));
    assert.equal(await readFile(join(input.out, "credential.env"), "utf8"), original);
    await symlink(process.cwd(), join(temporary, "repo"));
    for (const invalid of [
      { out: join(process.cwd(), "credential-test-must-not-exist") },
      { out: join(temporary, "repo", "credential-test-must-not-exist") },
      { out: "relative" }, { role: "admin" }, { actor: "line\nbreak" },
      { origin: "http://team.example.test" }, { origin: "https://name:secret@team.example.test" },
    ]) await assert.rejects(issueCredential({ ...input, ...invalid }));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
