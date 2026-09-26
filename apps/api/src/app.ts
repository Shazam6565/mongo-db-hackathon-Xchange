import { InMemoryActivityRepository, registerActivity, type ActivityRepository } from "./activity.js";
import Fastify from "fastify";
import { z } from "zod";
import { InMemoryCanvasRepository, registerCanvases, type CanvasRepository } from "./canvases.js";
import { registerGitHistory } from "./git-history.js";
import { InMemoryTicketRepository, registerTickets, type TicketRepository } from "./tickets.js";
import {
  CandidateInputSchema, ENGINEER_ID_HEADER, EvaluateRequestSchema, engineerIdFromHeader, type Scope,
} from "../../../packages/contracts/src/index.js";
import { EVALUATOR_VERSION, compareLesson, loadSuite } from "../../evaluator/src/compare.js";
import { HarnessRollbackSchema } from "../../../packages/contracts/src/harness.js";
import { RepositoryError, type LessonRepository } from "./repository.js";
import { createTeamAuthentication, type TeamAuthConfig } from "./auth.js";

export interface AppOptions {
  repository: LessonRepository;
  tickets?: TicketRepository;
  canvases?: CanvasRepository;
  activity?: ActivityRepository;
  storageLabel?: string;
  token: string;
  teamAuth?: TeamAuthConfig;
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
  if (options.storage === "mongodb" && !options.canvases) throw new Error("MongoDB mode requires a persistent canvas repository.");
  const canvases = options.canvases ?? new InMemoryCanvasRepository();
  if (options.storage === "mongodb" && !options.activity) throw new Error("MongoDB mode requires a persistent activity repository.");
  const activity = options.activity ?? new InMemoryActivityRepository();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  const teamAuth = options.teamAuth ? createTeamAuthentication(options.teamAuth) : null;
  app.addHook("onRequest", async (_request, reply) => { reply.header("cache-control", "no-store"); });
  if (teamAuth) teamAuth.registerSessions(app);
  else app.get("/session", async () => ({ authenticated: true, mode: "local" }));
  app.setErrorHandler((error, _req, reply) => {
    const code = error instanceof Error && "statusCode" in error ? error.statusCode : undefined;
    const status = typeof code === "number" && code >= 400 && code < 500 ? code : 503;
    reply.code(status).send({ error: status < 500 ? "Invalid request." : "Storage is unavailable. Check the API connection and retry." });
  });
  app.get("/health", async (_req, reply) => {
    try { await canvases.ping(); }
    catch { return reply.code(503).send({ status: "degraded", storage: options.storage, error: "MongoDB is unreachable. Check the server configuration and network access." }); }
    return { status: "ok", storage: options.storage, storageLabel: options.storageLabel ?? (options.storage === "memory" ? "Temporary storage" : "MongoDB"),
      checkedAt: new Date().toISOString(), stage: "shared-canvas", evaluator: EVALUATOR_VERSION, suiteVersion: suite.suiteVersion };
  });

  app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (teamAuth) {
        const principal = teamAuth.authenticate(request);
        if (!principal) return reply.code(401).send({ error: "Sign in with a valid team access token." });
        if (principal.via === "cookie" && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !teamAuth.sameOrigin(request)) {
          return reply.code(403).send({ error: "State-changing requests must originate from this application." });
        }
        // Publishing and rolling back both change what every agent loads.
        const evaluatorOnly = request.method === "POST" && ["/v1/lessons/:id/evaluate", "/v1/harness/rollback"].includes(request.routeOptions.url ?? "");
        if (!teamAuth.permits(principal, request.method, evaluatorOnly)) return reply.code(403).send({ error: "This team credential does not permit that operation." });
        request.headers[ENGINEER_ID_HEADER] = principal.actorId;
        return;
      }
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });

    registerTickets(api, tickets, options.scope);
    registerActivity(api, activity, options.scope, options.repository);
    registerCanvases(api, canvases, options.repository, tickets, options.scope);
    registerGitHistory(api);
    // This route runs behind the same authentication hook as all record operations.
    api.get("/access", async (request) => {
      const principal = teamAuth?.authenticate(request);
      return {
        mode: teamAuth ? "team" : "local",
        actorId: principal?.actorId ?? engineerIdFromHeader(request.headers[ENGINEER_ID_HEADER]),
        role: principal?.role ?? "owner",
        scope: options.scope,
      };
    });
    api.get<{ Params: { id: string } }>("/lessons/:id", async (req, reply) => (await options.repository.get(options.scope, req.params.id)) ?? reply.code(404).send({ error: "Lesson not found" }));

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

    // Memory is the active harness version's lessons: a rolled-back lesson stops reaching agents.
    // Context injection keeps the ten most recent; skill sync loads the whole version.
    async function loadActive(request: { headers: Record<string, string | string[] | undefined> }, limit: number) {
      const active = await options.repository.activeHarness(options.scope);
      const lessons = active.lessons.slice(0, limit);
      const fetchedAt = new Date().toISOString();
      await options.repository.recordConsumption(
        options.scope,
        engineerIdFromHeader(request.headers[ENGINEER_ID_HEADER]),
        lessons.map((lesson) => ({ id: lesson.id, version: lesson.version })),
        fetchedAt,
        active.version,
      );
      return { ...active, lessons, fetchedAt };
    }

    api.get("/memory", async (request) => {
      const { lessons, fetchedAt, version } = await loadActive(request, 10);
      return { scope: options.scope, lessons, fetchedAt, harnessVersion: version };
    });

    api.get("/harness/active", async (request) => {
      const { version, versionId, lessons, fetchedAt } = await loadActive(request, 100);
      return { scope: options.scope, version, versionId, lessons, fetchedAt };
    });

    // Inspection only: references and history, not recorded as consumption.
    api.get("/harness", async () => {
      const [active, versions] = await Promise.all([options.repository.activeHarness(options.scope), options.repository.harnessHistory(options.scope)]);
      return { scope: options.scope, version: active.version, versionId: active.versionId,
        lessons: active.lessons.map((lesson) => ({ id: lesson.id, version: lesson.version })), versions };
    });

    api.post("/harness/rollback", async (request, reply) => {
      const parsed = HarnessRollbackSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Provide expectedVersion and lessonId.", issues: parsed.error.issues });
      try {
        const actorId = engineerIdFromHeader(request.headers[ENGINEER_ID_HEADER]);
        return await options.repository.rollbackLesson(options.scope, parsed.data.expectedVersion, parsed.data.lessonId, actorId);
      } catch (error) {
        if (sendRepositoryError(error, reply)) return;
        throw error;
      }
    });

    api.post("/lessons", async (request, reply) => {
      const parsed = CandidateInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid lesson candidate", issues: parsed.error.issues });
      }
      // Optional for older clients. With a key, an identical retry returns the same candidate.
      const key = request.headers["idempotency-key"];
      const operation = key === undefined ? undefined : z.string().uuid().safeParse(key);
      if (operation && !operation.success) return reply.code(400).send({ error: "Idempotency-Key must be a UUID." });
      try {
        const input = teamAuth ? { ...parsed.data, authorId: engineerIdFromHeader(request.headers[ENGINEER_ID_HEADER]) } : parsed.data;
        return reply.code(201).send(await options.repository.propose(options.scope, input, operation?.data));
      } catch (error) {
        if (sendRepositoryError(error, reply)) return;
        throw error;
      }
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

  app.addHook("onClose", async () => { await Promise.all([options.repository.close(), tickets.close(), canvases.close(), activity.close()]); });
  return app;
}
