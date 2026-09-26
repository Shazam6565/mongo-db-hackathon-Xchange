import { randomUUID } from "node:crypto";
import { MongoClient, type ClientSession, type Collection } from "mongodb";
import type {
  AuditEvent, CandidateInput, EvaluationResult, EvaluationScores, Lesson, LessonVersionRef, Scope,
} from "@team-memory/contracts";
import type { HarnessVersionRecord, LessonRef } from "../../../packages/contracts/src/harness.js";
import { LessonSchema } from "../../../packages/contracts/src/index.js";
import { stableUuid } from "./ids.js";

// Serve only contract fields. Other tools may add fields to stored lessons (search text,
// embeddings); passing them through would break every client that validates lessons strictly.
const lessonFields = { _id: 0, ...Object.fromEntries(Object.keys(LessonSchema.shape).map((key) => [key, 1])) };

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
  // With an ID (the request's Idempotency-Key), repeating an identical proposal returns the
  // existing candidate; reusing the ID for different content is a 409.
  propose(scope: Scope, input: CandidateInput, id?: string): Promise<Lesson>;
  // A publish decision also appends a harness version that adds the lesson, in the same commit.
  commitEvaluation(scope: Scope, lessonId: string, expectedVersion: number, scores: EvaluationScores): Promise<EvaluationCommit>;
  recordConsumption(scope: Scope, engineerId: string, lessons: LessonVersionRef[], at: string, harnessVersion?: number): Promise<void>;
  listEvaluations(scope: Scope): Promise<EvaluationResult[]>;
  listAudit(scope: Scope): Promise<AuditEvent[]>;
  activeHarness(scope: Scope): Promise<ActiveLessons>;
  harnessHistory(scope: Scope): Promise<HarnessVersionRecord[]>;
  // Appends a version without the lesson. expectedVersion must be the active version number.
  rollbackLesson(scope: Scope, expectedVersion: number, lessonId: string, actorId: string): Promise<{ harness: HarnessVersionRecord } & ActiveLessons>;
  close(): Promise<void>;
}

export interface EvaluationCommit { lesson: Lesson; evaluation: EvaluationResult; harness?: HarnessVersionRecord }
// Version 0 with versionId null means no harness record exists yet: every published lesson is active.
export interface ActiveLessons { version: number; versionId: string | null; lessons: Lesson[] }

function makeCandidate(scope: Scope, input: CandidateInput, id: string = randomUUID()): Lesson {
  const now = new Date().toISOString();
  return {
    ...input, ...scope, id, status: "candidate", version: 1,
    origin: "submitted", createdAt: now, updatedAt: now,
  };
}

const proposalFields = (value: CandidateInput) =>
  JSON.stringify([value.title, value.lesson, value.authorId, value.appliesTo, value.evidence, value.proposedChange]);

function sameProposal(existing: Lesson, scope: Scope, input: CandidateInput): Lesson {
  if (existing.teamId !== scope.teamId || existing.projectId !== scope.projectId || proposalFields(existing) !== proposalFields(input)) {
    throw new RepositoryError("This Idempotency-Key was already used for a different lesson. Submit the new lesson with a new key.", 409);
  }
  return existing;
}

const isDuplicateKey = (error: unknown) => error instanceof Error && "code" in error && error.code === 11000;

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

// Keyed by lesson version, so a retried proposal cannot record a second event.
function proposalEvent(lesson: Lesson): AuditEvent {
  const scope = { teamId: lesson.teamId, projectId: lesson.projectId };
  return {
    ...auditEvent(scope, "lesson.proposed", lesson.id, lesson.version, lesson.authorId, lesson.createdAt, `Proposed ${lesson.title}`),
    id: stableUuid("lesson.proposed", lesson.id, String(lesson.version)),
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

const refOf = (lesson: Pick<Lesson, "id" | "version">): LessonRef => ({ id: lesson.id, version: lesson.version });
const byRecent = (a: Lesson, b: Lesson) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
const MAX_HARNESS_LESSONS = 100;

// Builds the next immutable version from the active lesson set.
function nextHarnessVersion(
  scope: Scope, current: HarnessVersionRecord | null, active: LessonRef[], reason: HarnessVersionRecord["reason"],
  lesson: LessonRef, actorId: string, at: string,
): HarnessVersionRecord {
  const kept = active.filter((ref) => ref.id !== lesson.id);
  const lessons = reason === "publish" ? [...kept, lesson] : kept;
  if (lessons.length > MAX_HARNESS_LESSONS) throw new RepositoryError(`A harness version holds at most ${MAX_HARNESS_LESSONS} lessons. Roll one back first.`, 409);
  return {
    ...scope, id: randomUUID(), number: (current?.number ?? 0) + 1, parentId: current?.id ?? null,
    lessons, reason, lessonId: lesson.id, actorId, createdAt: at,
  };
}

function harnessEvent(version: HarnessVersionRecord, lesson: Pick<Lesson, "title"> | null, lessonVersion: number): AuditEvent {
  const scope = { teamId: version.teamId, projectId: version.projectId };
  const verb = version.reason === "publish" ? "added" : "rolled back";
  return {
    ...auditEvent(scope, version.reason === "publish" ? "harness.updated" : "harness.rollback", version.lessonId, lessonVersion,
      version.actorId, version.createdAt, `Harness v${version.number}: ${verb} ${lesson?.title ?? version.lessonId}`),
    harnessVersion: version.number,
  };
}

function requireActive(active: LessonRef[], current: number, expectedVersion: number, lessonId: string): LessonRef {
  if (current !== expectedVersion) throw new RepositoryError("The harness changed since it was loaded. Reload and retry.", 409);
  const ref = active.find((item) => item.id === lessonId);
  if (!ref) throw new RepositoryError("That lesson is not active in the current harness version.", 409);
  return ref;
}

const consumedSummary = (count: number, harnessVersion?: number) =>
  `Fetched ${count} published lesson${count === 1 ? "" : "s"}${harnessVersion === undefined ? "" : ` (harness v${harnessVersion})`}`;

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
  private readonly harness: HarnessVersionRecord[] = [];
  constructor(seed: Lesson[] = []) { this.lessons = structuredClone(seed); }

  private inScope(scope: Scope) {
    return this.lessons.filter((lesson) => lesson.teamId === scope.teamId && lesson.projectId === scope.projectId);
  }

  private latestHarness(scope: Scope): HarnessVersionRecord | null {
    return this.harness.filter((item) => item.teamId === scope.teamId && item.projectId === scope.projectId)
      .reduce<HarnessVersionRecord | null>((latest, item) => !latest || item.number > latest.number ? item : latest, null);
  }

  private activeRefs(scope: Scope, current: HarnessVersionRecord | null): LessonRef[] {
    return current ? current.lessons : this.inScope(scope).filter((lesson) => lesson.status === "published").sort(byRecent).slice(0, MAX_HARNESS_LESSONS).map(refOf);
  }

  private resolve(scope: Scope, current: HarnessVersionRecord | null): ActiveLessons {
    const ids = new Set(this.activeRefs(scope, current).map((ref) => ref.id));
    return {
      version: current?.number ?? 0, versionId: current?.id ?? null,
      lessons: structuredClone(this.inScope(scope).filter((lesson) => ids.has(lesson.id)).sort(byRecent)),
    };
  }

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

  async propose(scope: Scope, input: CandidateInput, id?: string): Promise<Lesson> {
    const existing = id ? this.lessons.find((item) => item.id === id) : undefined;
    if (existing) return structuredClone(sameProposal(existing, scope, input));
    const candidate = makeCandidate(scope, input, id);
    this.lessons.push(candidate);
    this.audit.push(proposalEvent(candidate));
    return structuredClone(candidate);
  }

  async commitEvaluation(scope: Scope, lessonId: string, expectedVersion: number, scores: EvaluationScores) {
    const index = this.lessons.findIndex((item) => item.id === lessonId && item.teamId === scope.teamId && item.projectId === scope.projectId);
    const current = requireCandidate(this.lessons[index] ?? null, expectedVersion);
    const at = new Date().toISOString();
    const status = reviewedStatus(scores.decision);
    const stored = status ? { ...current, status, updatedAt: at } : current;
    const evaluation = makeEvaluation(scope, current, scores, at);
    const latest = this.latestHarness(scope);
    // Built before any write, so an oversized harness leaves the candidate unchanged.
    const harness = status === "published" ? nextHarnessVersion(scope, latest, this.activeRefs(scope, latest), "publish", refOf(current), "evaluator", at) : undefined;
    if (status) this.lessons[index] = stored;
    this.evaluations.push(evaluation);
    this.audit.push(...evaluationEvents(scope, current, scores, at, status));
    if (harness) {
      this.harness.push(harness);
      this.audit.push(harnessEvent(harness, current, current.version));
    }
    return { lesson: structuredClone(stored), evaluation: structuredClone(evaluation), ...(harness ? { harness: structuredClone(harness) } : {}) };
  }

  async recordConsumption(scope: Scope, engineerId: string, lessons: LessonVersionRef[], at: string, harnessVersion?: number): Promise<void> {
    this.audit.push({
      ...auditEvent(scope, "memory.consumed", null, null, engineerId, at, consumedSummary(lessons.length, harnessVersion), lessons),
      ...(harnessVersion === undefined ? {} : { harnessVersion }),
    });
  }

  async activeHarness(scope: Scope): Promise<ActiveLessons> {
    return this.resolve(scope, this.latestHarness(scope));
  }

  async harnessHistory(scope: Scope): Promise<HarnessVersionRecord[]> {
    return structuredClone(this.harness.filter((item) => item.teamId === scope.teamId && item.projectId === scope.projectId)
      .sort((a, b) => b.number - a.number).slice(0, 50));
  }

  async rollbackLesson(scope: Scope, expectedVersion: number, lessonId: string, actorId: string) {
    const latest = this.latestHarness(scope);
    const ref = requireActive(this.activeRefs(scope, latest), latest?.number ?? 0, expectedVersion, lessonId);
    const version = nextHarnessVersion(scope, latest, this.activeRefs(scope, latest), "rollback", ref, actorId, new Date().toISOString());
    this.harness.push(version);
    this.audit.push(harnessEvent(version, this.inScope(scope).find((lesson) => lesson.id === lessonId) ?? null, ref.version));
    return { harness: structuredClone(version), ...this.resolve(scope, version) };
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
    private readonly harness: Collection<HarnessVersionRecord>,
  ) {}

  static async connect(uri: string, database: string): Promise<MongoLessonRepository> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5, waitQueueTimeoutMS: 5000 });
    try {
      await client.connect();
      const db = client.db(database);
      const lessons = db.collection<Lesson>("lessons");
      const evaluations = db.collection<EvaluationResult>("evaluations");
      const audit = db.collection<AuditEvent>("audit_events");
      const harness = db.collection<HarnessVersionRecord>("harness_versions");
      await lessons.createIndex({ id: 1 }, { unique: true });
      await lessons.createIndex({ teamId: 1, projectId: 1, status: 1, updatedAt: -1 });
      await evaluations.createIndex({ id: 1 }, { unique: true });
      await evaluations.createIndex({ teamId: 1, projectId: 1, lessonId: 1, createdAt: -1 });
      await audit.createIndex({ id: 1 }, { unique: true });
      await audit.createIndex({ teamId: 1, projectId: 1, at: -1 });
      await harness.createIndex({ id: 1 }, { unique: true });
      // Two concurrent changes cannot both become version n + 1.
      await harness.createIndex({ teamId: 1, projectId: 1, number: -1 }, { unique: true });
      return new MongoLessonRepository(client, lessons, evaluations, audit, harness);
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private latestHarness(scope: Scope, session?: ClientSession) {
    return this.harness.findOne(scope, { session, sort: { number: -1 }, projection: { _id: 0 } });
  }

  private async activeRefs(scope: Scope, current: HarnessVersionRecord | null, session?: ClientSession): Promise<LessonRef[]> {
    if (current) return current.lessons;
    const published = await this.lessons.find({ ...scope, status: "published" }, { session, projection: { _id: 0, id: 1, version: 1 } })
      .sort({ updatedAt: -1, id: 1 }).limit(MAX_HARNESS_LESSONS).toArray();
    return published.map(refOf);
  }

  private async resolve(scope: Scope, current: HarnessVersionRecord | null, session?: ClientSession): Promise<ActiveLessons> {
    const ids = (await this.activeRefs(scope, current, session)).map((ref) => ref.id);
    const lessons = ids.length ? await this.lessons.find({ ...scope, id: { $in: ids } }, { session, projection: lessonFields }).toArray() : [];
    return { version: current?.number ?? 0, versionId: current?.id ?? null, lessons: lessons.sort(byRecent) };
  }

  private async insertHarness(version: HarnessVersionRecord, session: ClientSession) {
    try { await this.harness.insertOne({ ...version }, { session }); }
    catch (error) {
      if (isDuplicateKey(error)) throw new RepositoryError("Another harness change landed first. Reload and retry.", 409);
      throw error;
    }
  }

  async list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]> {
    return this.lessons.find(
      { ...scope, ...(status ? { status } : {}) },
      { projection: lessonFields },
    ).sort({ updatedAt: -1 }).limit(100).toArray();
  }

  async get(scope: Scope, id: string): Promise<Lesson | null> {
    return this.lessons.findOne({ ...scope, id }, { projection: lessonFields });
  }

  async propose(scope: Scope, input: CandidateInput, id?: string): Promise<Lesson> {
    const candidate = makeCandidate(scope, input, id);
    // Both writes are keyed upserts: a retry with the same ID completes a partial proposal
    // instead of creating a second candidate or a second audit event.
    try { await this.lessons.updateOne({ id: candidate.id }, { $setOnInsert: { ...candidate } }, { upsert: true }); }
    catch (error) { if (!isDuplicateKey(error)) throw error; }
    const found = await this.lessons.findOne({ id: candidate.id }, { projection: lessonFields });
    if (!found) throw new RepositoryError("The proposal could not be confirmed. Retry with the same Idempotency-Key.", 503);
    const stored = sameProposal(found, scope, input);
    const event = proposalEvent(stored);
    try { await this.audit.updateOne({ id: event.id }, { $setOnInsert: { ...event } }, { upsert: true }); }
    catch (error) { if (!isDuplicateKey(error)) throw error; }
    return stored;
  }

  async commitEvaluation(scope: Scope, lessonId: string, expectedVersion: number, scores: EvaluationScores) {
    const session = this.client.startSession();
    try {
      let committed: EvaluationCommit | undefined;
      await session.withTransaction(async () => {
        const current = requireCandidate(
          await this.lessons.findOne({ ...scope, id: lessonId }, { session, projection: lessonFields }),
          expectedVersion,
        );
        const at = new Date().toISOString();
        const status = reviewedStatus(scores.decision);
        let harness: HarnessVersionRecord | undefined;
        if (status === "published") {
          // Read the active set before this lesson's status changes, inside the same transaction.
          const latest = await this.latestHarness(scope, session);
          harness = nextHarnessVersion(scope, latest, await this.activeRefs(scope, latest, session), "publish", refOf(current), "evaluator", at);
        }
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
        if (harness) {
          await this.insertHarness(harness, session);
          await this.audit.insertOne({ ...harnessEvent(harness, current, current.version) }, { session });
        }
        committed = { lesson: stored, evaluation, ...(harness ? { harness } : {}) };
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

  async recordConsumption(scope: Scope, engineerId: string, lessons: LessonVersionRef[], at: string, harnessVersion?: number): Promise<void> {
    await this.audit.insertOne({
      ...auditEvent(scope, "memory.consumed", null, null, engineerId, at, consumedSummary(lessons.length, harnessVersion), lessons),
      ...(harnessVersion === undefined ? {} : { harnessVersion }),
    });
  }

  async activeHarness(scope: Scope): Promise<ActiveLessons> {
    return this.resolve(scope, await this.latestHarness(scope));
  }

  async harnessHistory(scope: Scope): Promise<HarnessVersionRecord[]> {
    return this.harness.find(scope, { projection: { _id: 0 } }).sort({ number: -1 }).limit(50).toArray();
  }

  async rollbackLesson(scope: Scope, expectedVersion: number, lessonId: string, actorId: string) {
    const session = this.client.startSession();
    try {
      let result: ({ harness: HarnessVersionRecord } & ActiveLessons) | undefined;
      await session.withTransaction(async () => {
        const latest = await this.latestHarness(scope, session);
        const active = await this.activeRefs(scope, latest, session);
        const ref = requireActive(active, latest?.number ?? 0, expectedVersion, lessonId);
        const version = nextHarnessVersion(scope, latest, active, "rollback", ref, actorId, new Date().toISOString());
        await this.insertHarness(version, session);
        const lesson = await this.lessons.findOne({ ...scope, id: lessonId }, { session, projection: { _id: 0, title: 1 } });
        await this.audit.insertOne({ ...harnessEvent(version, lesson, ref.version) }, { session });
        result = { harness: version, ...await this.resolve(scope, version, session) };
      });
      if (!result) throw new RepositoryError("Rollback did not commit", 500);
      return result;
    } catch (error) {
      const mapped = mapMongoError(error);
      if (mapped) throw mapped;
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async listEvaluations(scope: Scope): Promise<EvaluationResult[]> {
    return this.evaluations.find(scope, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  async listAudit(scope: Scope): Promise<AuditEvent[]> {
    return this.audit.find(scope, { projection: { _id: 0 } }).sort({ at: -1 }).limit(100).toArray();
  }

  async close(): Promise<void> { await this.client.close(); }
}
