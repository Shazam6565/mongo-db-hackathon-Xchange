import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const importPattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g;

// The workspace packages export raw .ts files, which Vercel's function runtime cannot load;
// a runtime import of one crashes every request with FUNCTION_INVOCATION_FAILED.
test("everything the Vercel function reaches imports workspace code by relative path", () => {
  const seen = new Set<string>();
  const queue = [resolve(root, "api/index.ts")];
  const offenders: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(importPattern)) {
      const typeOnly = Boolean(match[1]);
      const specifier = match[2] ?? match[3]!;
      if (typeOnly) continue;
      if (specifier.startsWith("@team-memory/")) offenders.push(`${file.slice(root.length)} imports ${specifier}`);
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
        if (existsSync(target)) queue.push(target);
      }
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok([...seen].some((file) => file.endsWith("apps/api/src/app.ts")), "the walk should reach the API app");
});
