import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import Fastify from "fastify";
import { githubUrl, parseLog, registerGitHistory } from "./git-history.js";

test("git history parses commits and exposes only a public GitHub URL", () => {
  const hash = "a".repeat(40);
  assert.deepEqual(parseLog(`${hash}\x1fAda\x1f2026-09-26T10:30:00-04:00\x1fInitial commit\x1e\nnot-a-hash\x1fx\x1fy\x1fz\x1e`),
    [{ hash, author: "Ada", at: "2026-09-26T14:30:00.000Z", subject: "Initial commit" }]);
  assert.equal(githubUrl("git@github.com:team/repo.git"), "https://github.com/team/repo");
  assert.equal(githubUrl("https://user:secret@github.com/team/repo.git"), "https://github.com/team/repo");
  assert.equal(githubUrl("https://gitlab.example/team/repo.git"), null);
});

test("git history reads this checkout and reports a missing repository as unavailable", async () => {
  for (const [root, available] of [[process.cwd(), true], [tmpdir(), false]] as const) {
    const app = Fastify(); registerGitHistory(app, root);
    try {
      const body = (await app.inject({ url: "/git" })).json();
      assert.equal(body.available, available, root);
      if (available) assert.ok(body.commits.length > 0 && /^[0-9a-f]{40}$/.test(body.commits[0].hash));
      else assert.deepEqual(body.commits, []);
    } finally { await app.close(); }
  }
});
