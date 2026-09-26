import assert from "node:assert/strict";
import test from "node:test";
import { loadStdioConfig } from "./config.js";

const env = { TEAM_API_URL: "https://xchange.example.test", TEAM_API_TOKEN: "synthetic-private-token", TEAM_EXPECTED_TEAM_ID: "test-team", TEAM_EXPECTED_PROJECT_ID: "test-project" };
test("stdio requires explicit identity scope and opts into local owner mode only on loopback", () => {
  for (const key of Object.keys(env)) { const incomplete: NodeJS.ProcessEnv = { ...env }; delete incomplete[key]; assert.throws(() => loadStdioConfig(incomplete)); }
  assert.equal(loadStdioConfig(env).expectedMode, "team");
  assert.throws(() => loadStdioConfig({ ...env, XCHANGE_ALLOW_LOCAL_OWNER: "1" }));
  assert.equal(loadStdioConfig({ ...env, TEAM_API_URL: "http://127.0.0.1:4317", XCHANGE_ALLOW_LOCAL_OWNER: "1" }).expectedMode, "local");
  assert.throws(() => loadStdioConfig({ ...env, TEAM_API_URL: "https://user:password@xchange.example.test" }));
  assert.throws(() => loadStdioConfig({ ...env, TEAM_API_URL: "http://untrusted.example.test" }));
});
