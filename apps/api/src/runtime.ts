import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { buildApp } from "./app.js";
import { InMemoryActivityRepository, MongoActivityRepository } from "./activity.js";
import { InMemoryCanvasRepository, MongoCanvasRepository } from "./canvases.js";
import { InMemoryLessonRepository, MongoLessonRepository } from "./repository.js";
import { InMemoryTicketRepository, MongoTicketRepository } from "./tickets.js";
import type { loadConfig } from "./config.js";
import type { TeamAuthConfig } from "./auth.js";

export async function createRuntime(settings: ReturnType<typeof loadConfig>, teamAuth?: TeamAuthConfig) {
  const opened: { close(): Promise<void> }[] = [];
  try {
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
    const app = buildApp({ repository, tickets, canvases, activity, scope: settings.scope, token: settings.token, teamAuth,
      storage: settings.mode, storageLabel: settings.mode === "mongodb" ? settings.label : "Temporary storage" });
    await app.ready();
    return app;
  } catch (error) {
    await Promise.allSettled(opened.map(resource => resource.close()));
    throw error;
  }
}
