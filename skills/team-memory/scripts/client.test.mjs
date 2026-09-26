import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { run } from "./client.mjs";

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
    env: { ...process.env, TEAM_API_TOKEN: "" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Configure TEAM_API_TOKEN privately/);
  assert.equal(result.stdout, "");
});
