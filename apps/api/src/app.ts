import Fastify from "fastify";
import { CandidateInputSchema, type Scope } from "@team-memory/contracts";
import type { LessonRepository } from "./repository.js";

export interface AppOptions {
  repository: LessonRepository;
  token: string;
  scope: Scope;
  storage: "memory" | "mongodb";
  logger?: boolean;
}

export function buildApp(options: AppOptions) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  app.get("/health", async () => ({ status: "ok", storage: options.storage, stage: "skeleton" }));

  app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });

    api.get("/lessons", async () => ({
      scope: options.scope,
      lessons: await options.repository.list(options.scope),
    }));

    api.get("/memory", async () => ({
      scope: options.scope,
      lessons: (await options.repository.list(options.scope, "published")).slice(0, 10),
      fetchedAt: new Date().toISOString(),
    }));

    api.post("/lessons", async (request, reply) => {
      const parsed = CandidateInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid lesson candidate", issues: parsed.error.issues });
      }
      // Scope is assigned by the API, never accepted from a request body.
      const lesson = await options.repository.propose(options.scope, parsed.data);
      return reply.code(201).send(lesson);
    });
  }, { prefix: "/v1" });

  app.addHook("onClose", async () => { await options.repository.close(); });
  return app;
}
