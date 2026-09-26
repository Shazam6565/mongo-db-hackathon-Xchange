import Fastify from "fastify";
import { InMemoryTicketRepository, registerTickets, type TicketRepository } from "./tickets.js";
import {
  CandidateInputSchema, ENGINEER_ID_HEADER, EvaluateRequestSchema, engineerIdFromHeader, type Scope,
} from "@team-memory/contracts";
import { EVALUATOR_VERSION, compareLesson, loadSuite } from "@team-memory/evaluator";
import { RepositoryError, type LessonRepository } from "./repository.js";

export interface AppOptions {
  repository: LessonRepository;
  tickets?: TicketRepository;
  token: string;
  scope: Scope;
  storage: "memory" | "mongodb";
  logger?: boolean;
}

function lessonId(params: unknown): string | null {
  if (typeof params !== "object" || !params || !("id" in params) || typeof params.id !== "string" || params.id.length === 0) return null;
  return params.id;
}

function sendRepositoryError(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): boolean {
  if (!(error instanceof RepositoryError)) return false;
  reply.code(error.status).send({ error: error.message });
  return true;
}

export function buildApp(options: AppOptions) {
  const suite = loadSuite();
  if (options.storage === "mongodb" && !options.tickets) throw new Error("MongoDB mode requires a persistent ticket repository.");
  const tickets = options.tickets ?? new InMemoryTicketRepository();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  app.get("/health", async () => ({
    status: "ok",
    storage: options.storage,
    stage: "evaluation-gate",
    evaluator: EVALUATOR_VERSION,
    suiteVersion: suite.suiteVersion,
  }));

  app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });

    registerTickets(api, tickets, options.scope);

    api.get("/lessons", async () => ({
      scope: options.scope,
      lessons: await options.repository.list(options.scope),
    }));

    api.get("/evaluations", async () => ({
      scope: options.scope,
      evaluations: await options.repository.listEvaluations(options.scope),
    }));

    api.get("/audit", async () => ({
      scope: options.scope,
      events: await options.repository.listAudit(options.scope),
    }));

    api.get("/memory", async (request) => {
      const lessons = (await options.repository.list(options.scope, "published")).slice(0, 10);
      const fetchedAt = new Date().toISOString();
      const engineerId = engineerIdFromHeader(request.headers[ENGINEER_ID_HEADER]);
      await options.repository.recordConsumption(
        options.scope,
        engineerId,
        lessons.map((lesson) => ({ id: lesson.id, version: lesson.version })),
        fetchedAt,
      );
      return { scope: options.scope, lessons, fetchedAt };
    });

    api.post("/lessons", async (request, reply) => {
      const parsed = CandidateInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid lesson candidate", issues: parsed.error.issues });
      }
      const lesson = await options.repository.propose(options.scope, parsed.data);
      return reply.code(201).send(lesson);
    });

    api.post("/lessons/:id/evaluate", async (request, reply) => {
      const id = lessonId(request.params);
      const parsed = EvaluateRequestSchema.safeParse(request.body);
      if (!id || !parsed.success) {
        return reply.code(400).send({ error: "Invalid evaluation request", issues: parsed.success ? [] : parsed.error.issues });
      }
      const lesson = await options.repository.get(options.scope, id);
      if (!lesson) return reply.code(404).send({ error: "Lesson not found" });
      if (lesson.status !== "candidate") return reply.code(409).send({ error: "Only a candidate can be evaluated" });
      if (lesson.version !== parsed.data.expectedVersion) {
        return reply.code(409).send({ error: "Lesson version does not match expectedVersion" });
      }
      const scores = compareLesson(lesson, suite);
      try {
        return await options.repository.commitEvaluation(options.scope, lesson.id, parsed.data.expectedVersion, scores);
      } catch (error) {
        if (sendRepositoryError(error, reply)) return;
        throw error;
      }
    });
  }, { prefix: "/v1" });

  app.addHook("onClose", async () => { await Promise.all([options.repository.close(), tickets.close()]); });
  return app;
}
