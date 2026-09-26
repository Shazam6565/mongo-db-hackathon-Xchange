import { createHash } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ENGINEER_ID_HEADER, engineerIdFromHeader, type Scope } from "../../../packages/contracts/src/index.js";
import { CanvasRecordSchema, CanvasWriteSchema, type CanvasRecord, type CanvasWrite, type CanvasReference } from "../../../packages/contracts/src/canvas.js";
import type { LessonRepository } from "./repository.js";
import type { TicketRepository } from "./tickets.js";

export const mongoOptions = { serverSelectionTimeoutMS: 5000, maxPoolSize: 5, waitQueueTimeoutMS: 5000 };
type StoredCanvas = CanvasRecord & { operationId: string; requestHash: string };
export class CanvasConflict extends Error {}
export interface CanvasRepository {
  list(scope: Scope): Promise<CanvasRecord[]>;
  get(scope: Scope, id: string): Promise<CanvasRecord | null>;
  write(scope: Scope, id: string, input: CanvasWrite, operationId: string, editorLabel: string): Promise<CanvasRecord>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
const matches = (a: Scope, b: Scope) => a.teamId === b.teamId && a.projectId === b.projectId;
const hash = (input: CanvasWrite) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
function retry(current: StoredCanvas | null | undefined, operationId: string, requestHash: string) {
  if (current?.operationId !== operationId) return null;
  if (current.requestHash !== requestHash) throw new CanvasConflict("This operation ID has already been used for different content.");
  return CanvasRecordSchema.parse(current);
}
function nextRecord(scope: Scope, id: string, input: CanvasWrite, operationId: string, editorLabel: string, createdAt?: string): StoredCanvas {
  const now = new Date().toISOString();
  return { ...scope, id, revision: input.expectedRevision + 1, canvas: input.canvas, createdAt: createdAt ?? now, updatedAt: now, editorLabel, operationId, requestHash: hash(input) };
}
const conflict = () => new CanvasConflict("Another writer saved this canvas. Your draft is preserved; reload the latest revision before merging and retrying.");
export class InMemoryCanvasRepository implements CanvasRepository {
  private records = new Map<string, StoredCanvas>();
  async list(scope: Scope) { return [...this.records.values()].filter(item => matches(item, scope)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0,100).map(item => CanvasRecordSchema.parse(item)); }
  async get(scope: Scope, id: string) { const item = this.records.get(id); return item && matches(item, scope) ? CanvasRecordSchema.parse(item) : null; }
  async write(scope: Scope, id: string, input: CanvasWrite, operationId: string, editorLabel: string) {
    const current = this.records.get(id);
    if (current && !matches(current, scope)) throw conflict();
    const replay = retry(current, operationId, hash(input)); if (replay) return replay;
    if ((current?.revision ?? 0) !== input.expectedRevision) throw conflict();
    const next = nextRecord(scope, id, input, operationId, editorLabel, current?.createdAt);
    this.records.set(id, structuredClone(next)); return CanvasRecordSchema.parse(next);
  }
  async ping() {}
  async close() {}
}
export class MongoCanvasRepository implements CanvasRepository {
  private constructor(private client: MongoClient, private records: Collection<StoredCanvas>) {}
  static async connect(uri: string, database: string) {
    const client = new MongoClient(uri, mongoOptions);
    try {
      await client.connect(); const records = client.db(database).collection<StoredCanvas>("canvases");
      await records.createIndex({ id: 1 }, { unique: true });
      await records.createIndex({ teamId: 1, projectId: 1, updatedAt: -1 });
      return new MongoCanvasRepository(client, records);
    } catch (error) { await client.close(); throw error; }
  }
  async list(scope: Scope) { return (await this.records.find(scope).sort({ updatedAt: -1, id: 1 }).limit(100).toArray()).map(item => CanvasRecordSchema.parse(item)); }
  async get(scope: Scope, id: string) { const item = await this.records.findOne({ ...scope, id }); return item ? CanvasRecordSchema.parse(item) : null; }
  async write(scope: Scope, id: string, input: CanvasWrite, operationId: string, editorLabel: string) {
    const current = await this.records.findOne({ ...scope, id });
    const replay = retry(current, operationId, hash(input)); if (replay) return replay;
    if ((current?.revision ?? 0) !== input.expectedRevision) throw conflict();
    const next = nextRecord(scope, id, input, operationId, editorLabel, current?.createdAt);
    if (!current) {
      try { await this.records.insertOne(next); return CanvasRecordSchema.parse(next); }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== 11000) throw error;
      }
    } else {
      const updated = await this.records.findOneAndUpdate({ ...scope, id, revision: input.expectedRevision }, { $set: next }, { returnDocument: "after" });
      if (updated) return CanvasRecordSchema.parse(updated);
    }
    const raced = await this.records.findOne({ ...scope, id });
    const retried = retry(raced, operationId, hash(input)); if (retried) return retried;
    throw conflict();
  }
  async ping() { await this.client.db(this.records.dbName).command({ ping: 1 }, { timeoutMS: 1500 }); }
  async close() { await this.client.close(); }
}
export function registerCanvases(api: FastifyInstance, repository: CanvasRepository, lessons: LessonRepository, tickets: TicketRepository, scope: Scope) {
  async function references(canvas: CanvasRecord["canvas"]): Promise<CanvasReference[]> {
    const refs = new Map(canvas.nodes.flatMap(node => node.kind === "record" ? [[`${node.ref.kind}:${node.ref.id}`, node.ref] as const] : []));
    const found = await Promise.all([...refs.values()].map(async ref => {
      if (ref.kind === "ticket") { const value = await tickets.get(scope, ref.id); return value ? { kind: ref.kind, id: value.id, title: value.summary, description: value.description, status: value.status } : null; }
      const value = await lessons.get(scope, ref.id); return value ? { kind: ref.kind, id: value.id, title: value.title, description: value.lesson, status: value.status } : null;
    }));
    return found.filter(value => value !== null);
  }
  api.get("/canvases", async () => ({ scope, canvases: await repository.list(scope) }));
  api.get("/canvas-schema", async () => z.toJSONSchema(CanvasWriteSchema));
  api.get<{ Params: { id: string } }>("/canvases/:id", async (req, reply) => {
    const record = await repository.get(scope, req.params.id);
    return record ? { record, references: await references(record.canvas) } : reply.code(404).send({ error: "Canvas not found" });
  });
  api.put<{ Params: { id: string } }>("/canvases/:id", { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const input = CanvasWriteSchema.safeParse(req.body); const id = z.string().uuid().safeParse(req.params.id); const op = z.string().uuid().safeParse(req.headers["idempotency-key"]);
    if (!input.success || !id.success || !op.success) return reply.code(400).send({ error: "A valid canvas, UUID canvas ID and UUID Idempotency-Key are required.", issues: input.success ? [] : input.error.issues });
    const resolved = await references(input.data.canvas);
    if (input.data.canvas.nodes.some(node => node.kind === "record" && !resolved.some(ref => ref.kind === node.ref.kind && ref.id === node.ref.id))) return reply.code(400).send({ error: "A referenced record is not available in this project." });
    try {
      const record = await repository.write(scope, id.data, input.data, op.data, engineerIdFromHeader(req.headers[ENGINEER_ID_HEADER]));
      return { record, references: resolved };
    } catch (error) { if (error instanceof CanvasConflict) return reply.code(409).send({ error: error.message }); throw error; }
  });
}
