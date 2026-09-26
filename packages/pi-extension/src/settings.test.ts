import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSettings, repairFlattenedArguments, resolveApiUrl } from "./index.js";

test("settings come from the environment first, then only the allowed keys of the credential file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "team-memory-settings-"));
  const file = join(directory, "credential.env");
  try {
    await writeFile(file, [
      "# issued credential",
      "TEAM_API_URL=https://team.example.test",
      "TEAM_API_TOKEN='file-token'",
      "MONGODB_URI=mongodb+srv://must-not-be-read",
      "export TEAM_TICKET=\"XCH-4\"",
    ].join("\n"));
    const { settings, source } = loadSettings({ TEAM_MEMORY_ENV: file, TEAM_TICKET: "DEMO-118" });
    assert.equal(source, file);
    assert.deepEqual(settings, { TEAM_API_URL: "https://team.example.test", TEAM_API_TOKEN: "file-token", TEAM_TICKET: "DEMO-118" });
    assert.deepEqual(loadSettings({ TEAM_MEMORY_ENV: join(directory, "missing.env") }), { settings: {}, source: null });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("arguments a model flattens into one list are recovered", () => {
  const repaired = repairFlattenedArguments({
    title: "t", lesson: "l",
    verificationSteps: ["Run the replay test", "Confirm with the Relay team", "appliesTo", "notifications", "evidence", "Replay test passed", "replaces", "old-id"],
  });
  assert.deepEqual(repaired.verificationSteps, ["Run the replay test", "Confirm with the Relay team"]);
  assert.deepEqual(repaired.appliesTo, ["notifications"]);
  assert.equal(repaired.evidence, "Replay test passed");
  assert.deepEqual(repaired.replaces, ["old-id"]);
  const clean = { title: "t", lesson: "l", verificationSteps: ["a", "b"], replaces: ["x"] };
  assert.deepEqual(repairFlattenedArguments(clean), clean);
});

test("tokens are only sent to HTTPS origins or the local owner API", () => {
  assert.equal(resolveApiUrl("https://team.example.test/"), "https://team.example.test");
  assert.equal(resolveApiUrl("http://127.0.0.1:4317/"), "http://127.0.0.1:4317");
  for (const bad of ["http://team.example.test", "https://user:pass@team.example.test", "https://team.example.test/v1", "https://team.example.test?x=1"]) {
    assert.throws(() => resolveApiUrl(bad));
  }
});
