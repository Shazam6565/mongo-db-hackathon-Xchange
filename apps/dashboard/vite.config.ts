import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const env = { ...loadEnv(mode, root, ""), ...process.env };
  const target = env.TEAM_API_URL || "http://127.0.0.1:4317";
  // The hosted deployment serves /api/* itself and routes by host name; the local API has no /api prefix.
  // Without a personal token the hosted workspace opens read-only, as it does for guests.
  const hosted = new URL(target).protocol === "https:";
  const token = env.TEAM_API_TOKEN || (hosted ? "" : "local-demo-token");
  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target,
          changeOrigin: hosted,
          ...(hosted ? {} : { rewrite: (path: string) => path.replace(/^\/api/, "") }),
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
  };
});
