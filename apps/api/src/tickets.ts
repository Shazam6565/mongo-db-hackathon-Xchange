import type { FastifyInstance } from "fastify";
import { MongoClient, type Collection } from "mongodb";
import { z } from "zod";
import type { Scope } from "@team-memory/contracts";
import { TicketInputSchema, type TicketInput, type TicketRecord } from "../../../packages/contracts/src/tickets.js";

export interface TicketRepository {
  list(scope: Scope): Promise<TicketRecord[]>;
  get(scope: Scope, id: string): Promise<TicketRecord | null>;
  create(scope: Scope, id: string, input: TicketInput): Promise<TicketRecord>;
  close(): Promise<void>;
}

class TicketConflict extends Error {}
const sameScope = (a: Scope, b: Scope) => a.teamId === b.teamId && a.projectId === b.projectId;
function makeTicket(scope: Scope, id: string, input: TicketInput): TicketRecord {
  const at = new Date().toISOString();
  return { ...input, ...scope, id, key: input.key ?? `TKT-${id.slice(0, 8).toUpperCase()}`, status: "open", source: "manual", createdAt: at, updatedAt: at };
}
function sameRequest(existing: TicketRecord, candidate: TicketRecord): TicketRecord {
  if (!sameScope(existing, candidate) || existing.key !== candidate.key || existing.summary !== candidate.summary ||
      existing.description !== candidate.description || existing.component !== candidate.component ||
      JSON.stringify(existing.acceptanceCriteria) !== JSON.stringify(candidate.acceptanceCriteria)) {
    throw new TicketConflict("This save has already been used for another ticket. Reopen Add ticket to start a new one.");
  }
  return structuredClone(existing);
}

export class InMemoryTicketRepository implements TicketRepository {
  private readonly tickets: TicketRecord[] = [];
  async list(scope: Scope) {
    return structuredClone(this.tickets.filter(ticket => sameScope(ticket, scope))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, 100));
  }
  async get(scope: Scope, id: string) {
    return structuredClone(this.tickets.find(ticket => ticket.id === id && sameScope(ticket, scope)) ?? null);
  }
  async create(scope: Scope, id: string, input: TicketInput) {
    const ticket = makeTicket(scope, id, input);
    const existing = this.tickets.find(item => item.id === id);
    if (existing) return sameRequest(existing, ticket);
    if (this.tickets.some(item => sameScope(item, scope) && item.key === ticket.key)) {
      throw new TicketConflict("A ticket with this reference already exists in this project.");
    }
    this.tickets.push(ticket);
    return structuredClone(ticket);
  }
  async close() {}
}

export class MongoTicketRepository implements TicketRepository {
  private constructor(private readonly client: MongoClient, private readonly tickets: Collection<TicketRecord>) {}
  static async connect(uri: string, database: string) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      const tickets = client.db(database).collection<TicketRecord>("tickets");
      await tickets.createIndex({ id: 1 }, { unique: true });
      await tickets.createIndex({ teamId: 1, projectId: 1, key: 1 }, { unique: true });
      await tickets.createIndex({ teamId: 1, projectId: 1, updatedAt: -1 });
      return new MongoTicketRepository(client, tickets);
    } catch (error) { await client.close(); throw error; }
  }
  async list(scope: Scope) {
    return this.tickets.find(scope, { projection: { _id: 0 } }).sort({ updatedAt: -1, id: 1 }).limit(100).toArray();
  }
  async get(scope: Scope, id: string) {
    return this.tickets.findOne({ ...scope, id }, { projection: { _id: 0 } });
  }
  async create(scope: Scope, id: string, input: TicketInput) {
    const ticket = makeTicket(scope, id, input);
    try {
      await this.tickets.updateOne({ ...scope, id }, { $setOnInsert: ticket }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== 11000) throw error;
      const existing = await this.get(scope, id);
      if (existing) return sameRequest(existing, ticket);
      throw new TicketConflict("A ticket with this reference already exists in this project.");
    }
    return sameRequest((await this.get(scope, id))!, ticket);
  }
  async close() { await this.client.close(); }
}

// Register inside the existing authenticated /v1 plugin; do not expose another server.
export function registerTickets(api: FastifyInstance, repository: TicketRepository, scope: Scope) {
  api.get("/tickets", async () => ({ scope, tickets: await repository.list(scope) }));
  api.get<{ Params: { id: string } }>("/tickets/:id", async (request, reply) => {
    const ticket = await repository.get(scope, request.params.id);
    return ticket ?? reply.code(404).send({ error: "Ticket not found" });
  });
  api.post("/tickets", async (request, reply) => {
    const input = TicketInputSchema.safeParse(request.body);
    const id = z.string().uuid().safeParse(request.headers["idempotency-key"]);
    if (!input.success || !id.success) return reply.code(400).send({ error: "Provide a valid ticket and a UUID Idempotency-Key.", issues: input.success ? [] : input.error.issues });
    try { return reply.code(201).send(await repository.create(scope, id.data, input.data)); }
    catch (error) {
      if (error instanceof TicketConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
}
