import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const dashboard = dirname(fileURLToPath(import.meta.url));
const liveApi = resolve(dashboard, "src/catalog/api.js");

export default defineConfig({
  root: resolve(dashboard, "preview"),
  publicDir: false,
  envDir: false,
  plugins: [{
    name: "sample-preview-api",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer && source.startsWith(".") && resolve(dirname(importer), source) === liveApi) {
        return resolve(dashboard, "preview/api.ts");
      }
    },
  }],
  build: { outDir: resolve(dashboard, "dist-preview"), emptyOutDir: true },
});
