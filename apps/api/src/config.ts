export function loadConfig(env: NodeJS.ProcessEnv) {
  const uri = env.MONGODB_URI?.trim();
  const mode = env.STORAGE_MODE ?? (uri ? "mongodb" : "memory");
  if (mode !== "mongodb" && mode !== "memory") throw new Error("STORAGE_MODE must be memory or mongodb.");
  if (mode === "mongodb" && (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri))) throw new Error("MongoDB mode requires a valid server-only MONGODB_URI.");
  const database = env.MONGODB_DATABASE ?? "team_memory_harness";
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw new Error("MONGODB_DATABASE must be a valid application database name.");
  const host = env.HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("The local owner API must bind to loopback.");
  const port = Number(env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port number.");
  const label = env.MONGODB_LABEL ?? "MongoDB";
  if (label.length > 60 || /[:/@]/.test(label)) throw new Error("MONGODB_LABEL must be a short display label, not a connection string.");
  return { mode: mode as "memory" | "mongodb", uri, database, host, port, label, token: env.TEAM_API_TOKEN ?? "local-demo-token",
    scope: { teamId: env.TEAM_ID ?? "demo-team", projectId: env.PROJECT_ID ?? "event-platform" } };
}
