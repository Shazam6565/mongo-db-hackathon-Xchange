import { InMemoryActivityRepository, MongoActivityRepository } from "./activity.js";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { InMemoryTicketRepository, MongoTicketRepository } from "./tickets.js";
import { InMemoryLessonRepository, MongoLessonRepository } from "./repository.js";
import { InMemoryCanvasRepository, MongoCanvasRepository } from "./canvases.js";
import { loadConfig } from "./config.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const opened: { close(): Promise<void> }[] = [];
try {
  const settings = loadConfig(process.env);
  const repository = settings.mode === "mongodb"
    ? await MongoLessonRepository.connect(settings.uri!, settings.database)
    : new InMemoryLessonRepository(demoLessons.map(lesson => ({ ...lesson, ...settings.scope })));
  opened.push(repository);
  const tickets = settings.mode === "mongodb" ? await MongoTicketRepository.connect(settings.uri!, settings.database) : new InMemoryTicketRepository();
  opened.push(tickets);
  const canvases = settings.mode === "mongodb" ? await MongoCanvasRepository.connect(settings.uri!, settings.database) : new InMemoryCanvasRepository();
  opened.push(canvases);
  const activity = settings.mode === "mongodb" ? await MongoActivityRepository.connect(settings.uri!, settings.database) : new InMemoryActivityRepository();
  opened.push(activity);
  const app = buildApp({ repository, tickets, canvases, activity, scope: settings.scope, token: settings.token,
    storage: settings.mode, storageLabel: settings.mode === "mongodb" ? settings.label : "Temporary storage", logger: true });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close(); });
  await app.listen({ host: settings.host, port: settings.port });
} catch {
  await Promise.allSettled(opened.map(resource => resource.close()));
  console.error("API startup failed. Check server-only MongoDB settings, network access, database permissions and the local port. No demo fallback was started.");
  process.exitCode = 1;
}
