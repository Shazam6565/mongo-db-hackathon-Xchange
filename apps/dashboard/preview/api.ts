import { LessonSchema, ScopeSchema } from "@team-memory/contracts";
import { z } from "zod";
import { demoLessons } from "../../../packages/contracts/src/demo.js";
import { TicketRecordSchema, type TicketInput } from "../../../packages/contracts/src/tickets.js";
import { CanvasResponseSchema } from "../../../packages/contracts/src/canvas.js";

// Same exports as src/catalog/api.ts, which this module replaces in the preview build.
export const ApiLessonSchema = LessonSchema.strip();
export const LessonsResponse = z.object({ scope: ScopeSchema, lessons: z.array(ApiLessonSchema) });
export const TicketsResponse = z.object({ scope: ScopeSchema, tickets: z.array(TicketRecordSchema) });
export const HealthResponse = z.object({ storage: z.enum(["memory", "mongodb"]), storageLabel: z.string().optional() });
/** Never thrown here: preview failures are plain Errors, so `instanceof ApiError` checks are false. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const scope = { teamId: "demo-team", projectId: "event-platform" };
export const canvasId = "a630c355-5568-43e9-8957-9afc9c9567ec";
const timestamp = "2026-09-26T12:00:00.000Z";
const lessons = z.array(LessonSchema).parse(demoLessons);
const ticket = TicketRecordSchema.parse({
  ...scope, id: "adcfc247-d63f-4648-b99b-23b8c9f95a81", key: "DEMO-101",
  summary: "Sample: one event produces two notifications",
  description: "Synthetic ticket for exploring the frontend. A retried event appears twice in the notification feed. Investigate event-ID deduplication before treating this as a rendering bug. No investigation or test has run in this preview.",
  component: "notifications", acceptanceCriteria: ["Replay one event twice and check that it produces one notification."],
  status: "open", source: "manual", createdAt: timestamp, updatedAt: timestamp,
});
const canvas = CanvasResponseSchema.parse({
  record: {
    ...scope, id: canvasId, revision: 1, editorLabel: "Synthetic preview", createdAt: timestamp, updatedAt: timestamp,
    canvas: {
      title: "Sample: ticket → observation → shared lesson",
      description: "An illustrative relationship, not evidence of a completed learning run.",
      nodes: [
        { id: "ticket", kind: "record", ref: { kind: "ticket", id: ticket.id }, x: 0, y: 80, color: "blue" },
        { id: "observation", kind: "note", title: "Check event redelivery", text: "Illustrative observation: inspect the event ID and consumer deduplication. No test has run.", x: 320, y: 80, color: "amber" },
        { id: "lesson", kind: "record", ref: { kind: "lesson", id: lessons[0]!.id }, x: 640, y: 80, color: "sage" },
      ],
      edges: [
        { id: "investigate", from: "ticket", to: "observation", label: "investigate" },
        { id: "propose", from: "observation", to: "lesson", label: "propose lesson" },
      ],
    },
  },
  references: [
    { kind: "ticket", id: ticket.id, title: ticket.summary, description: ticket.description, status: ticket.status },
    { kind: "lesson", id: lessons[0]!.id, title: lessons[0]!.title, description: lessons[0]!.lesson, status: lessons[0]!.status },
  ],
});

// Selected only by vite.preview.config.ts. This module has no network transport.
export async function request(path: string, init: RequestInit = {}): Promise<any> {
  init.signal?.throwIfAborted();
  if ((init.method ?? "GET").toUpperCase() !== "GET") {
    throw new Error("This shared preview is read-only. Saving and evaluation require the connected application.");
  }
  if (/^\/v1\/activity(?:\?|$)/.test(path)) return structuredClone({ scope, records: [], nextCursor: null });
  const routes: Record<string, unknown> = {
    "/health": { storage: "memory", storageLabel: "Sample preview" },
    "/v1/lessons": { scope, lessons },
    [`/v1/lessons/${lessons[0]!.id}`]: lessons[0],
    "/v1/tickets": { scope, tickets: [ticket] },
    [`/v1/tickets/${ticket.id}`]: ticket,
    "/v1/canvases": { scope, canvases: [canvas.record] },
    [`/v1/canvases/${canvasId}`]: canvas,
    "/v1/evaluations": { scope, evaluations: [] },
    "/v1/audit": { scope, events: [] },
  };
  if (!Object.hasOwn(routes, path)) throw new Error("This record is not part of the shared sample preview.");
  return structuredClone(routes[path]);
}

export async function loadCatalog(signal: AbortSignal) {
  signal.throwIfAborted();
  return structuredClone({ storage: "memory" as const, storageLabel: "Sample preview", scope, lessons, tickets: [ticket], activity: [] });
}
export async function saveTicket(_input: TicketInput, _requestId: string) {
  return TicketRecordSchema.parse(await request("/v1/tickets", { method: "POST" }));
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not open this sample record.";
}
