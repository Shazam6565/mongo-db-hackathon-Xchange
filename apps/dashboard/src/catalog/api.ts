import { ActivityPageSchema } from "../../../../packages/contracts/src/activity.js";
import { LessonSchema, ScopeSchema } from "@team-memory/contracts";
import { TicketRecordSchema, type TicketInput } from "../../../../packages/contracts/src/tickets.js";
import { z } from "zod";

export const LessonsResponse = z.object({ scope: ScopeSchema, lessons: z.array(LessonSchema) });
export const TicketsResponse = z.object({ scope: ScopeSchema, tickets: z.array(TicketRecordSchema) });
export const HealthResponse = z.object({ storage: z.enum(["memory", "mongodb"]), storageLabel: z.string().optional() });
export async function request(path: string, init: RequestInit = {}) {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const response = await fetch(`/api${path}`, { ...init, signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${response.status}). Check the local API and try again.`);
  }
  return response.json();
}
export async function loadCatalog(signal: AbortSignal) {
  const [health, lessons, tickets, activity] = await Promise.all([
    request("/health", { signal }).then(v => HealthResponse.parse(v)),
    request("/v1/lessons", { signal }).then(v => LessonsResponse.parse(v)),
    request("/v1/tickets", { signal }).then(v => TicketsResponse.parse(v)),
    request("/v1/activity?limit=100", { signal }).then(v => ActivityPageSchema.parse(v)),
  ]);
  if (lessons.scope.teamId !== tickets.scope.teamId || lessons.scope.projectId !== tickets.scope.projectId) throw new Error("The catalog sources returned different projects. Refresh before continuing.");
  if (lessons.scope.teamId !== activity.scope.teamId || lessons.scope.projectId !== activity.scope.projectId) throw new Error("The activity source returned a different project.");
  return { activity: activity.records, storage: health.storage, storageLabel: health.storageLabel, scope: lessons.scope, lessons: lessons.lessons, tickets: tickets.tickets };
}
export async function saveTicket(input: TicketInput, requestId: string) {
  return TicketRecordSchema.parse(await request("/v1/tickets", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestId }, body: JSON.stringify(input) }));
}
export function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return "The API returned an unexpected record. Refresh or check the API version.";
  return error instanceof Error ? error.message : "Could not reach the API. Try again.";
}
