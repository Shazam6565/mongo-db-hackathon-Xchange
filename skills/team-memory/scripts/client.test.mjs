import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { credentialSettings, HOSTED_API_URL, run } from "./client.mjs";

const env = { TEAM_API_URL: "https://team.example.test", TEAM_API_TOKEN: "synthetic-agent-token-00000000000000001" };
const access = { mode: "team", actorId: "agent.alex.pi", role: "writer", scope: { teamId: "team-test", projectId: "project-test" } };
test("agent access check uses authenticated scoped API and rejects preview, local, and revoked access", async () => {
  assert.deepEqual(await run(["access"], env, async (url, options) => {
    assert.equal(url.href, "https://team.example.test/v1/access");
    assert.equal(options.headers.authorization, `Bearer ${env.TEAM_API_TOKEN}`);
    assert.equal(options.redirect, "error");
    return Response.json(access);
  }), access);
  for (const response of [Response.json({ ...access, mode: "local" }), Response.json({ sample: true }), new Response("<html>Preview</html>"), new Response("", { status: 401 })]) {
    await assert.rejects(run(["access"], env, async () => response));
  }
});

test("ticket and proposal writes preserve operation IDs for identical retries", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "team-client-test-"));
  const file = join(temporary, "record.json");
  const body = { title: "Synthetic onboarding write" };
  await writeFile(file, JSON.stringify(body));
  try {
    for (const [command, route] of [["create-ticket", "tickets"], ["propose", "lessons"]]) {
      const operation = randomUUID();
      const request = async (url, options) => {
        assert.equal(url.pathname, `/v1/${route}`);
        assert.equal(options.method, "POST");
        assert.equal(options.headers["idempotency-key"], operation);
        assert.deepEqual(JSON.parse(options.body), body);
        return Response.json({ id: operation });
      };
      assert.deepEqual(await run([command, file, operation], env, request), { id: operation });
      assert.deepEqual(await run([command, file, operation], env, request), { id: operation });
      await assert.rejects(run([command, file, "bad-operation"], env, () => assert.fail("Invalid operation must not reach network")));
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("credentials are never sent to a remote HTTP origin or embedded-credential URL", async () => {
  for (const TEAM_API_URL of ["http://team.example.test", "https://user:secret@team.example.test", "https://team.example.test/path"]) {
    await assert.rejects(run(["access"], { ...env, TEAM_API_URL }, () => assert.fail("Unsafe URL must not reach network")));
  }
});

test("the discoverable skill symlink still executes the client and fails closed without a token", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../.agents/skills/team-memory/scripts/client.mjs", import.meta.url)), "access"], {
    // Keep a developer's own ~/.team-memory/credential.env out of the test.
    env: { ...process.env, TEAM_API_TOKEN: "", TEAM_MEMORY_ENV: join(tmpdir(), "team-client-test-missing", "credential.env") }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Configure TEAM_API_TOKEN privately/);
  assert.equal(result.stdout, "");
});

test("the hosted workspace is the default, and the credential file fills only unset keys", async () => {
  assert.equal(HOSTED_API_URL, "https://mongo-db-hackathon-xchange.vercel.app");
  await run(["access"], { TEAM_API_TOKEN: env.TEAM_API_TOKEN }, async (url) => {
    assert.equal(url.href, `${HOSTED_API_URL}/v1/access`);
    return Response.json(access);
  });
  const temporary = await mkdtemp(join(tmpdir(), "team-client-credential-"));
  const file = join(temporary, "credential.env");
  try {
    await writeFile(file, ["# issued credential", "TEAM_API_URL=https://team.example.test", "export TEAM_API_TOKEN='file-token'", "MONGODB_URI=mongodb+srv://must-not-be-read"].join("\n"));
    assert.deepEqual(credentialSettings({ TEAM_MEMORY_ENV: file }), { TEAM_API_URL: "https://team.example.test", TEAM_API_TOKEN: "file-token" });
    assert.deepEqual(credentialSettings({ TEAM_MEMORY_ENV: file, TEAM_API_TOKEN: "env-token" }), { TEAM_API_URL: "https://team.example.test" });
    assert.deepEqual(credentialSettings({ TEAM_MEMORY_ENV: join(temporary, "missing.env") }), {});
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("operator commands preserve explicit versions, stay on scoped routes, and never retry denied writes", async () => {
  for (const [args, route, method, body] of [
    [["lesson", "lesson-1"], "/v1/lessons/lesson-1", "GET", undefined],
    [["ticket", "ticket-1"], "/v1/tickets/ticket-1", "GET", undefined],
    [["evaluations"], "/v1/evaluations", "GET", undefined],
    [["audit"], "/v1/audit", "GET", undefined],
    [["evaluate", "lesson-1", "2"], "/v1/lessons/lesson-1/evaluate", "POST", { expectedVersion: 2 }],
    [["rollback", "lesson-1", "0"], "/v1/harness/rollback", "POST", { lessonId: "lesson-1", expectedVersion: 0 }],
  ]) {
    let calls = 0;
    await run(args, env, async (url, options) => {
      calls++;
      assert.equal(url.pathname, route); assert.equal(options.method, method);
      assert.equal(options.headers.authorization, `Bearer ${env.TEAM_API_TOKEN}`);
      assert.deepEqual(options.body ? JSON.parse(options.body) : undefined, body);
      return Response.json({ ok: true });
    });
    assert.equal(calls, 1);
  }
  for (const args of [["evaluate", "lesson-1", "0"], ["evaluate", "lesson-1"], ["rollback", "lesson-1", "-1"], ["rollback", "lesson-1", "1.5"], ["rollback", "lesson-1", "9007199254740992"], ["lesson", "../audit"], ["ticket", ".."]]) {
    await assert.rejects(run(args, env, () => assert.fail("Invalid input must not reach the API")));
  }
  for (const status of [401, 403, 409, 503]) {
    let calls = 0;
    await assert.rejects(run(["evaluate", "lesson-1", "2"], env, async () => {
      calls++; return Response.json({ error: "rejected" }, { status });
    }));
    assert.equal(calls, 1);
  }
});
