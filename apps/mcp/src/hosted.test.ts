import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import handler from "../../../api/index.js";

test("the Vercel entry routes /mcp and its rewrite to bearer authentication before API startup", async () => {
  const configured = { TEAM_ID: "mcp-route-test", PROJECT_ID: "synthetic", TEAM_PUBLIC_ORIGIN: "https://xchange.example.test" };
  const previous = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]));
  Object.assign(process.env, configured);
  try {
    for (const path of ["/mcp", "/api/index?route=mcp"]) {
      const response = await handler.fetch(new Request(`${configured.TEAM_PUBLIC_ORIGIN}${path}`, { method: "POST" }));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.message, "An individual Xchange bearer credential is required.");
    }
    const config = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8"));
    const rewrite = config.rewrites.findIndex((item: { source: string }) => item.source === "/mcp");
    assert.ok(rewrite >= 0 && rewrite < config.rewrites.length - 1);
    assert.equal(config.rewrites[rewrite].destination, "/api/index?route=mcp");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
