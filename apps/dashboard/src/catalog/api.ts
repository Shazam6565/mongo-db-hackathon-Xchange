import { ActivityPageSchema } from "../../../../packages/contracts/src/activity.js";
import { LessonSchema, ScopeSchema } from "@team-memory/contracts";
import { TicketRecordSchema, type TicketInput } from "../../../../packages/contracts/src/tickets.js";
import { z } from "zod";
import { AUTH_EXPIRED_EVENT } from "../auth/session.js";

export const LessonsResponse = z.object({ scope: ScopeSchema, lessons: z.array(LessonSchema) });
export const TicketsResponse = z.object({ scope: ScopeSchema, tickets: z.array(TicketRecordSchema) });
export const HealthResponse = z.object({ storage: z.enum(["memory", "mongodb"]), storageLabel: z.string().optional() });
/** status 0 means the API was not reached or did not answer in time. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function request(path: string, init: RequestInit = {}) {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...init, signal }); }
  catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(error instanceof DOMException && error.name === "TimeoutError" ? "The team API did not answer in time." : "Could not reach the team API. Check that it is running.", 0);
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      throw new ApiError("Your session expired. Sign in again.", 401);
    }
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.error ?? (response.status >= 502 ? "The team API is not responding. Check that it is running." : `Request failed (${response.status}). Check the API and try again.`), response.status);
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
