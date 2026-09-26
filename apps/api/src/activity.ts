import type { FastifyInstance } from "fastify";
import { MongoClient, type Collection, type Filter } from "mongodb";
import { z } from "zod";
import { ENGINEER_ID_HEADER, engineerIdFromHeader, type Scope } from "@team-memory/contracts";
import {
  ActivityInputSchema, ActivityQuerySchema, ActivityRecordSchema,
  type ActivityInput, type ActivityRecord, type ActivityRoot, type ActivityQuery,
} from "../../../packages/contracts/src/activity.js";
import type { LessonRepository } from "./repository.js";

export class ActivityError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export interface ActivityRepository {
  get(scope: Scope, id: string): Promise<ActivityRecord | null>;
  list(scope: Scope, query: ActivityQuery): Promise<{ records: ActivityRecord[]; nextCursor: string | null }>;
  append(scope: Scope, id: string, input: ActivityInput, actorLabel: string, root: ActivityRoot): Promise<ActivityRecord>;
  close(): Promise<void>;
}
const sameScope = (a: Scope, b: Scope) => a.teamId === b.teamId && a.projectId === b.projectId;
const compare = (a: ActivityRecord, b: ActivityRecord) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id);
function sameRequest(record: ActivityRecord, input: ActivityInput, actorLabel: string) {
  const { kind, title, detail, subject, runId, evidence, outcome } = record;
  if (record.actorLabel !== actorLabel || JSON.stringify(ActivityInputSchema.parse({ kind, title, detail, subject, runId, evidence, outcome })) !== JSON.stringify(input)) {
    throw new ActivityError("This operation ID already records different content. Start a new record to change it.", 409);
  }
  return structuredClone(record);
}
function makeRecord(scope: Scope, id: string, input: ActivityInput, actorLabel: string, root: ActivityRoot): ActivityRecord {
  return { ...input, ...scope, id, actorLabel, root, recordedAt: new Date().toISOString(), correctedBy: [] };
}
function page(records: ActivityRecord[], limit: number) {
  return { records: records.slice(0, limit), nextCursor: records.length > limit ? records[limit - 1]!.id : null };
}
export class InMemoryActivityRepository implements ActivityRepository {
  private records: ActivityRecord[] = [];
  private annotate(record: ActivityRecord): ActivityRecord {
    return structuredClone({ ...record, correctedBy: this.records.filter(item => sameScope(item, record) && item.kind === "correction" && item.subject?.kind === "activity" && item.subject.id === record.id).map(item => item.id).sort() });
  }
  async get(scope: Scope, id: string) {
    const record = this.records.find(record => record.id === id && sameScope(record, scope));
    return record ? this.annotate(record) : null;
  }
  async list(scope: Scope, query: ActivityQuery) {
    const cursor = query.cursor ? await this.get(scope, query.cursor) : null;
    if (query.cursor && !cursor) throw new ActivityError("History cursor not found.", 400);
    return structuredClone(page(this.records.filter(record => sameScope(record, scope)
      && (!query.kind || record.kind === query.kind)
      && (!query.rootId || (record.root.kind === query.rootKind && record.root.id === query.rootId))
      && (!query.since || record.recordedAt >= query.since) && (!query.until || record.recordedAt <= query.until)
      && (!cursor || compare(record, cursor) > 0)).sort(compare).slice(0, query.limit + 1).map(record => this.annotate(record)), query.limit));
  }
  async append(scope: Scope, id: string, input: ActivityInput, actorLabel: string, root: ActivityRoot) {
    const existing = this.records.find(record => record.id === id && sameScope(record, scope));
    if (existing) return sameRequest(existing, input, actorLabel);
    const record = makeRecord(scope, id, input, actorLabel, root);
    this.records.push(record);
    return structuredClone(record);
  }
  async close() {}
}
export class MongoActivityRepository implements ActivityRepository {
  private constructor(private client: MongoClient, private records: Collection<ActivityRecord>) {}
  static async connect(uri: string, database: string) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5, waitQueueTimeoutMS: 5000 });
    try {
      await client.connect();
      const records = client.db(database).collection<ActivityRecord>("activity_records");
      await records.createIndex({ teamId: 1, projectId: 1, id: 1 }, { unique: true });
      await records.createIndex({ teamId: 1, projectId: 1, recordedAt: -1, id: -1 });
      await records.createIndex({ teamId: 1, projectId: 1, "root.kind": 1, "root.id": 1, recordedAt: -1, id: -1 });
      await records.createIndex({ teamId: 1, projectId: 1, kind: 1, "subject.kind": 1, "subject.id": 1 });
      return new MongoActivityRepository(client, records);
    } catch (error) { await client.close(); throw error; }
  }
  async get(scope: Scope, id: string) {
    const record = await this.records.findOne({ ...scope, id }, { projection: { _id: 0 } });
    return record ? (await this.annotate(scope, [record]))[0]! : null;
  }
  private async annotate(scope: Scope, records: ActivityRecord[]): Promise<ActivityRecord[]> {
    if (!records.length) return [];
    const corrections = await this.records.find({ ...scope, kind: "correction", "subject.kind": "activity", "subject.id": { $in: records.map(record => record.id) } }, { projection: { id: 1, subject: 1 } }).toArray();
    return records.map(record => ActivityRecordSchema.parse({ ...record, correctedBy: corrections.filter(item => item.subject?.id === record.id).map(item => item.id).sort() }));
  }
  async list(scope: Scope, query: ActivityQuery) {
    const cursor = query.cursor ? await this.get(scope, query.cursor) : null;
    if (query.cursor && !cursor) throw new ActivityError("History cursor not found.", 400);
    const filter: Filter<ActivityRecord> = { ...scope,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.rootId ? { "root.kind": query.rootKind, "root.id": query.rootId } : {}),
      ...(query.since || query.until ? { recordedAt: { ...(query.since ? { $gte: query.since } : {}), ...(query.until ? { $lte: query.until } : {}) } } : {}),
      ...(cursor ? { $or: [{ recordedAt: { $lt: cursor.recordedAt } }, { recordedAt: cursor.recordedAt, id: { $lt: cursor.id } }] } : {}),
    };
    const records = await this.records.find(filter, { projection: { _id: 0 } }).sort({ recordedAt: -1, id: -1 }).limit(query.limit + 1).toArray();
    return page(await this.annotate(scope, records), query.limit);
  }
  async append(scope: Scope, id: string, input: ActivityInput, actorLabel: string, root: ActivityRoot) {
    const record = makeRecord(scope, id, input, actorLabel, root);
    try { await this.records.updateOne({ ...scope, id }, { $setOnInsert: record }, { upsert: true }); }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== 11000) throw error; }
    const existing = await this.get(scope, id);
    if (!existing) throw new ActivityError("Record could not be confirmed. Retry with the same operation ID.", 503);
    return sameRequest(existing, input, actorLabel);
  }
  async close() { await this.client.close(); }
}

// Records document claims and observations. They never grant authority or publish lessons.
export function registerActivity(api: FastifyInstance, repository: ActivityRepository, scope: Scope, lessons: LessonRepository) {
  api.get("/activity", async (request, reply) => {
    const query = ActivityQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid history filter.", issues: query.error.issues });
    try { return { scope, ...await repository.list(scope, query.data) }; }
    catch (error) { if (error instanceof ActivityError) return reply.code(error.status).send({ error: error.message }); throw error; }
  });
  api.get<{ Params: { id: string } }>("/activity/:id", async (request, reply) =>
    await repository.get(scope, request.params.id) ?? reply.code(404).send({ error: "Activity not found." }));
  api.post("/activity", async (request, reply) => {
    const parsed = ActivityInputSchema.safeParse(request.body);
    const operation = z.string().uuid().safeParse(request.headers["idempotency-key"]);
    if (!parsed.success || !operation.success) return reply.code(400).send({ error: "Provide a valid activity record and UUID Idempotency-Key.", issues: parsed.success ? [] : parsed.error.issues });
    const input = parsed.data, id = operation.data;
    const actorLabel = engineerIdFromHeader(request.headers[ENGINEER_ID_HEADER]);
    try {
      const existing = await repository.get(scope, id);
      if (existing) return reply.code(200).send(sameRequest(existing, input, actorLabel));
      let root: ActivityRoot = { kind: "activity", id };
      if (input.subject?.kind === "lesson") {
        const lesson = await lessons.get(scope, input.subject.id);
        if (!lesson) throw new ActivityError("Referenced lesson not found in this project.", 404);
        if (lesson.version !== input.subject.version) throw new ActivityError("The referenced lesson version has changed.", 409);
        if (input.kind === "application" && lesson.status !== "published") throw new ActivityError("Only published lessons can be recorded as shared-memory applications.", 409);
        root = { kind: "lesson", id: lesson.id };
      } else if (input.subject?.kind === "activity") {
        const parent = await repository.get(scope, input.subject.id);
        if (!parent) throw new ActivityError("Referenced activity not found in this project.", 404);
        if (input.kind === "application" && !["decision", "observation"].includes(parent.kind)) throw new ActivityError("Apply a decision, observation or published lesson.", 400);
        if (input.kind === "outcome" && (parent.kind !== "application" || parent.runId !== input.runId)) throw new ActivityError("An outcome must link to an application in the same task/run.", 400);
        root = parent.root;
      }
      return reply.code(201).send(await repository.append(scope, id, input, actorLabel, root));
    } catch (error) { if (error instanceof ActivityError) return reply.code(error.status).send({ error: error.message }); throw error; }
  });
}
