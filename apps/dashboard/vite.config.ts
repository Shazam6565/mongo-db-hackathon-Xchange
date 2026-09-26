import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const env = { ...loadEnv(mode, root, ""), ...process.env };
  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.TEAM_API_URL || "http://127.0.0.1:4317",
          rewrite: (path) => path.replace(/^\/api/, ""),
          headers: { authorization: `Bearer ${env.TEAM_API_TOKEN || "local-demo-token"}` },
        },
      },
    },
  };
});
