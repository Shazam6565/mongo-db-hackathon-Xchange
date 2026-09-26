import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolCatalog } from "../apps/mcp/src/tools.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "plugins/xchange/dist");
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root, entryPoints: ["apps/mcp/src/stdio.ts"], outfile: join(output, "stdio.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node22", metafile: true,
  banner: { js: 'import { createRequire as xchangeCreateRequire } from "node:module"; const require = xchangeCreateRequire(import.meta.url);' },
});
const tools = getToolCatalog({ mode: "team", actorId: "catalog", role: "writer", scope: { teamId: "catalog", projectId: "catalog" } });
await writeFile(join(output, "tool-catalog.json"), JSON.stringify({ name: "xchange", version: "0.1.0", tools }, null, 2) + "\n");
const functions = tools.map(tool => {
  const { $schema, ...parameters } = tool.inputSchema;
  return { type: "function", name: tool.name, description: tool.description, parameters, strict: false };
});
await writeFile(join(output, "openai-tools.json"), JSON.stringify(functions, null, 2) + "\n");

// Keep the license notices for dependencies copied into the standalone bundle.
const packageRoots = new Set();
for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes("node_modules/"))) {
  let cursor = dirname(resolve(root, input));
  for (;;) {
    try {
      const info = JSON.parse(await readFile(join(cursor, "package.json"), "utf8"));
      if (info.name && info.version) { packageRoots.add(cursor); break; }
    } catch {}
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
const notices = [];
for (const packageRoot of [...packageRoots].sort()) {
  const info = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const licenses = (await readdir(packageRoot)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  notices.push(`${info.name} ${info.version} (${info.license ?? "see upstream"})`);
  for (const file of licenses) notices.push(await readFile(join(packageRoot, file), "utf8"));
}
await writeFile(join(output, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n") + "\n");
console.log(`Built portable Xchange MCP bundle and ${tools.length} tool contracts.`);
