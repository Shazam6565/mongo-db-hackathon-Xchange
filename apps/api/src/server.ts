import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { InMemoryTicketRepository, MongoTicketRepository } from "./tickets.js";
import { InMemoryLessonRepository, MongoLessonRepository } from "./repository.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const uri = process.env.MONGODB_URI?.trim();
const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  throw new Error("This starter uses local development authentication. Add per-user auth before exposing the API remotely.");
}
const scope = {
  teamId: process.env.TEAM_ID ?? "demo-team",
  projectId: process.env.PROJECT_ID ?? "event-platform",
};
const repository = uri
  ? await MongoLessonRepository.connect(uri, process.env.MONGODB_DATABASE ?? "team_memory_harness")
  : new InMemoryLessonRepository(demoLessons.map((lesson) => ({ ...lesson, ...scope })));

let tickets;
try {
  tickets = uri
    ? await MongoTicketRepository.connect(uri, process.env.MONGODB_DATABASE ?? "team_memory_harness")
    : new InMemoryTicketRepository();
} catch (error) { await repository.close(); throw error; }

const app = buildApp({
  repository,
  tickets,
  scope,
  token: process.env.TEAM_API_TOKEN ?? "local-demo-token",
  storage: uri ? "mongodb" : "memory",
  logger: true,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
await app.listen({ host, port: Number(process.env.PORT ?? 4317) });
