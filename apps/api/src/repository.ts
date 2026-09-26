import { randomUUID } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import type {
  AuditEvent, CandidateInput, EvaluationResult, EvaluationScores, Lesson, LessonVersionRef, Scope,
} from "@team-memory/contracts";

export class RepositoryError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RepositoryError";
    this.status = status;
  }
}

export interface LessonRepository {
  list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]>;
  get(scope: Scope, id: string): Promise<Lesson | null>;
  propose(scope: Scope, input: CandidateInput): Promise<Lesson>;
  commitEvaluation(scope: Scope, lessonId: string, expectedVersion: number, scores: EvaluationScores): Promise<{ lesson: Lesson; evaluation: EvaluationResult }>;
  recordConsumption(scope: Scope, engineerId: string, lessons: LessonVersionRef[], at: string): Promise<void>;
  listEvaluations(scope: Scope): Promise<EvaluationResult[]>;
  listAudit(scope: Scope): Promise<AuditEvent[]>;
  close(): Promise<void>;
}

function makeCandidate(scope: Scope, input: CandidateInput): Lesson {
  const now = new Date().toISOString();
  return {
    ...input, ...scope, id: randomUUID(), status: "candidate", version: 1,
    origin: "submitted", createdAt: now, updatedAt: now,
  };
}

function reviewedStatus(decision: EvaluationScores["decision"]): Lesson["status"] | null {
  if (decision === "publish") return "published";
  if (decision === "reject") return "rejected";
  return null;
}

function makeEvaluation(scope: Scope, lesson: Lesson, scores: EvaluationScores, at: string): EvaluationResult {
  return {
    ...scores,
    id: randomUUID(),
    teamId: scope.teamId,
    projectId: scope.projectId,
    lessonId: lesson.id,
    candidateVersion: lesson.version,
    createdAt: at,
  };
}

function auditEvent(
  scope: Scope,
  kind: AuditEvent["kind"],
  lessonId: string | null,
  lessonVersion: number | null,
  actorId: string,
  at: string,
  summary: string,
  consumed?: LessonVersionRef[],
): AuditEvent {
  return {
    id: randomUUID(), ...scope, kind, lessonId, lessonVersion, actorId, at, summary,
    ...(consumed ? { consumed } : {}),
  };
}

function evaluationEvents(scope: Scope, lesson: Lesson, scores: EvaluationScores, at: string, status: Lesson["status"] | null): AuditEvent[] {
  const events = [auditEvent(
    scope, "lesson.evaluated", lesson.id, lesson.version, "evaluator", at,
    `${scores.decision}: candidate ${scores.candidateScore} vs baseline ${scores.baselineScore}`,
  )];
  if (status === "published" || status === "rejected") {
    events.push(auditEvent(
      scope, status === "published" ? "lesson.published" : "lesson.rejected",
      lesson.id, lesson.version, "evaluator", at, `${status} ${lesson.id} version ${lesson.version}`,
    ));
  }
  return events;
}

function requireCandidate(lesson: Lesson | null, expectedVersion: number): Lesson {
  if (!lesson) throw new RepositoryError("Lesson not found", 404);
  if (lesson.status !== "candidate") throw new RepositoryError("Only a candidate can be evaluated", 409);
  if (lesson.version !== expectedVersion) throw new RepositoryError("Lesson version does not match expectedVersion", 409);
  return lesson;
}

function mapMongoError(error: unknown): RepositoryError | null {
  if (error instanceof RepositoryError) return error;
  if (error instanceof Error && /replica set|Transaction numbers/i.test(error.message)) {
    return new RepositoryError("Publishing requires a MongoDB replica set", 503);
  }
  return null;
}

export class InMemoryLessonRepository implements LessonRepository {
  private readonly lessons: Lesson[];
  private readonly evaluations: EvaluationResult[] = [];
  private readonly audit: AuditEvent[] = [];
  constructor(seed: Lesson[] = []) { this.lessons = structuredClone(seed); }

  async list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]> {
    return structuredClone(this.lessons
      .filter((lesson) => lesson.teamId === scope.teamId && lesson.projectId === scope.projectId)
      .filter((lesson) => !status || lesson.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100));
  }

  async get(scope: Scope, id: string): Promise<Lesson | null> {
    const lesson = this.lessons.find((item) => item.id === id && item.teamId === scope.teamId && item.projectId === scope.projectId);
    return lesson ? structuredClone(lesson) : null;
  }

  async propose(scope: Scope, input: CandidateInput): Promise<Lesson> {
    const candidate = makeCandidate(scope, input);
    this.lessons.push(candidate);
    this.audit.push(auditEvent(scope, "lesson.proposed", candidate.id, candidate.version, candidate.authorId, candidate.createdAt, `Proposed ${candidate.title}`));
    return structuredClone(candidate);
  }

  async commitEvaluation(scope: Scope, lessonId: string, expectedVersion: number, scores: EvaluationScores) {
    const index = this.lessons.findIndex((item) => item.id === lessonId && item.teamId === scope.teamId && item.projectId === scope.projectId);
    const current = requireCandidate(this.lessons[index] ?? null, expectedVersion);
    const at = new Date().toISOString();
    const status = reviewedStatus(scores.decision);
    const stored = status ? { ...current, status, updatedAt: at } : current;
    const evaluation = makeEvaluation(scope, current, scores, at);
    if (status) this.lessons[index] = stored;
    this.evaluations.push(evaluation);
    this.audit.push(...evaluationEvents(scope, current, scores, at, status));
    return { lesson: structuredClone(stored), evaluation: structuredClone(evaluation) };
  }

  async recordConsumption(scope: Scope, engineerId: string, lessons: LessonVersionRef[], at: string): Promise<void> {
    this.audit.push(auditEvent(
      scope, "memory.consumed", null, null, engineerId, at,
      `Fetched ${lessons.length} published lesson${lessons.length === 1 ? "" : "s"}`,
      lessons,
    ));
  }

  async listEvaluations(scope: Scope): Promise<EvaluationResult[]> {
    return structuredClone(this.evaluations
      .filter((item) => item.teamId === scope.teamId && item.projectId === scope.projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100));
  }

  async listAudit(scope: Scope): Promise<AuditEvent[]> {
    return structuredClone(this.audit
      .filter((item) => item.teamId === scope.teamId && item.projectId === scope.projectId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 100));
  }

  async close(): Promise<void> {}
}

export class MongoLessonRepository implements LessonRepository {
  private constructor(
    private readonly client: MongoClient,
    private readonly lessons: Collection<Lesson>,
    private readonly evaluations: Collection<EvaluationResult>,
    private readonly audit: Collection<AuditEvent>,
  ) {}

  static async connect(uri: string, database: string): Promise<MongoLessonRepository> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      const db = client.db(database);
      const lessons = db.collection<Lesson>("lessons");
      const evaluations = db.collection<EvaluationResult>("evaluations");
      const audit = db.collection<AuditEvent>("audit_events");
      await lessons.createIndex({ id: 1 }, { unique: true });
      await lessons.createIndex({ teamId: 1, projectId: 1, status: 1, updatedAt: -1 });
      await evaluations.createIndex({ id: 1 }, { unique: true });
      await evaluations.createIndex({ teamId: 1, projectId: 1, lessonId: 1, createdAt: -1 });
      await audit.createIndex({ id: 1 }, { unique: true });
      await audit.createIndex({ teamId: 1, projectId: 1, at: -1 });
      return new MongoLessonRepository(client, lessons, evaluations, audit);
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]> {
    return this.lessons.find(
      { ...scope, ...(status ? { status } : {}) },
      { projection: { _id: 0 } },
    ).sort({ updatedAt: -1 }).limit(100).toArray();
  }

  async get(scope: Scope, id: string): Promise<Lesson | null> {
    return this.lessons.findOne({ ...scope, id }, { projection: { _id: 0 } });
  }

  async propose(scope: Scope, input: CandidateInput): Promise<Lesson> {
    const candidate = makeCandidate(scope, input);
    await this.lessons.insertOne({ ...candidate });
    await this.audit.insertOne(auditEvent(scope, "lesson.proposed", candidate.id, candidate.version, candidate.authorId, candidate.createdAt, `Proposed ${candidate.title}`));
    return candidate;
  }

  async commitEvaluation(scope: Scope, lessonId: string, expectedVersion: number, scores: EvaluationScores) {
    const session = this.client.startSession();
    try {
      let committed: { lesson: Lesson; evaluation: EvaluationResult } | undefined;
      await session.withTransaction(async () => {
        const current = requireCandidate(
          await this.lessons.findOne({ ...scope, id: lessonId }, { session, projection: { _id: 0 } }),
          expectedVersion,
        );
        const at = new Date().toISOString();
        const status = reviewedStatus(scores.decision);
        let stored: Lesson = current;
        if (status) {
          const updated = await this.lessons.updateOne(
            { ...scope, id: lessonId, version: expectedVersion, status: "candidate" },
            { $set: { status, updatedAt: at } },
            { session },
          );
          if (updated.matchedCount !== 1) throw new RepositoryError("Lesson version does not match expectedVersion", 409);
          stored = { ...current, status, updatedAt: at };
        }
        const evaluation = makeEvaluation(scope, current, scores, at);
        await this.evaluations.insertOne({ ...evaluation }, { session });
        await this.audit.insertMany(evaluationEvents(scope, current, scores, at, status).map((event) => ({ ...event })), { session });
        committed = { lesson: stored, evaluation };
      });
      if (!committed) throw new RepositoryError("Evaluation did not commit", 500);
      return committed;
    } catch (error) {
      const mapped = mapMongoError(error);
      if (mapped) throw mapped;
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async recordConsumption(scope: Scope, engineerId: string, lessons: LessonVersionRef[], at: string): Promise<void> {
    await this.audit.insertOne(auditEvent(
      scope, "memory.consumed", null, null, engineerId, at,
      `Fetched ${lessons.length} published lesson${lessons.length === 1 ? "" : "s"}`,
      lessons,
    ));
  }

  async listEvaluations(scope: Scope): Promise<EvaluationResult[]> {
    return this.evaluations.find(scope, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  async listAudit(scope: Scope): Promise<AuditEvent[]> {
    return this.audit.find(scope, { projection: { _id: 0 } }).sort({ at: -1 }).limit(100).toArray();
  }

  async close(): Promise<void> { await this.client.close(); }
}
