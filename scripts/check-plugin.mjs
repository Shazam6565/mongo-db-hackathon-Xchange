import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "plugins/xchange");
const json = async path => JSON.parse(await readFile(join(source, path), "utf8"));
const [portable, legacy, canonicalMcp, legacyMcp, catalog, functions] = await Promise.all([
  json("plugin.json"), json(".codex-plugin/plugin.json"), json("mcp.json"), json(".mcp.json"),
  json("dist/tool-catalog.json"), json("dist/openai-tools.json"),
]);
assert.equal(portable.name, "xchange");
assert.equal(legacy.name, portable.name);
assert.equal(legacy.version, portable.version);
assert.equal(catalog.version, portable.version);
assert.equal(catalog.tools.length, 14);
assert.deepEqual(functions.map(tool => tool.name), catalog.tools.map(tool => tool.name));
assert.equal(canonicalMcp.mcpServers.xchange.args[0], "${PLUGIN_ROOT}/dist/stdio.mjs");
assert.equal(legacyMcp.mcpServers.xchange.cwd, ".");
assert.equal(legacyMcp.mcpServers.xchange.args[0], "./dist/stdio.mjs");
assert.match(await readFile(join(source, "skills/xchange-workspace/SKILL.md"), "utf8"), /^---\nname: xchange-workspace/m);

// Exercise the actual distributed bundle outside the checkout, with no node_modules
// and only synthetic credentials/data. This catches unresolved runtime imports.
const directory = await mkdtemp(join(tmpdir(), "xchange-plugin-check-"));
const installed = join(directory, "xchange");
await cp(source, installed, { recursive: true });
const token = "synthetic-plugin-check-token-0000000001";
const scope = { teamId: "plugin-check", projectId: "isolated" };
const upstream = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401); response.end("{}"); return; }
  const data = request.url === "/v1/access" ? { mode: "team", actorId: "plugin-check-agent", role: "writer", scope }
    : request.url === "/v1/tickets" ? { scope, tickets: [] }
    : request.url === "/v1/lessons" ? { scope, lessons: [] } : null;
  response.writeHead(data ? 200 : 404); response.end(JSON.stringify(data ?? {}));
});
const client = new Client({ name: "xchange-package-check", version: "1.0.0" });
try {
  await new Promise((resolve, reject) => { upstream.once("error", reject); upstream.listen(0, "127.0.0.1", resolve); });
  const address = upstream.address();
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installed, "dist/stdio.mjs")], cwd: installed,
    env: { TEAM_API_URL: `http://127.0.0.1:${address.port}`, TEAM_API_TOKEN: token, TEAM_EXPECTED_TEAM_ID: scope.teamId, TEAM_EXPECTED_PROJECT_ID: scope.projectId }, stderr: "pipe" });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), catalog.tools.map(tool => tool.name));
  assert.equal((await client.callTool({ name: "xchange_access", arguments: {} })).structuredContent.actorId, "plugin-check-agent");
  assert.deepEqual((await client.callTool({ name: "xchange_catalog", arguments: {} })).structuredContent, { scope, tickets: [], lessons: [] });
  console.log("Plugin metadata, 14 tool contracts and isolated bundled stdio discovery/read checks passed.");
} finally {
  await client.close();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
