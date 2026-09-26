import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
try {
  const settings = loadConfig(process.env);
  const app = await createRuntime(settings);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close(); });
  try { await app.listen({ host: settings.host, port: settings.port }); }
  catch (error) { await app.close(); throw error; }
} catch {
  console.error("API startup failed. Check server-only MongoDB settings, network access, database permissions and the local port. No demo fallback was started.");
  process.exitCode = 1;
}
