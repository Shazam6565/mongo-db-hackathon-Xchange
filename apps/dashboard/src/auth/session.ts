import { z } from "zod";

export const AUTH_EXPIRED_EVENT = "team-memory:auth-expired";

const SessionSchema = z.union([
  z.object({ authenticated: z.literal(false), mode: z.literal("team") }),
  z.object({ authenticated: z.literal(true), mode: z.literal("local") }),
  z.object({ authenticated: z.literal(true), mode: z.literal("team"), actorId: z.string().min(1), role: z.string().min(1) }),
]);

export type Session = z.infer<typeof SessionSchema>;

export class SessionError extends Error {
  constructor(public readonly kind: "unauthorized" | "unavailable", message: string) { super(message); }
}

async function sessionRequest(init: RequestInit = {}): Promise<Session> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  let response: Response;
  try {
    response = await fetch("/api/session", { ...init, credentials: "same-origin", cache: "no-store", signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new SessionError("unavailable", "Cannot reach the team API. Check your connection and retry.");
  }
  if (response.status === 401) throw new SessionError("unauthorized", "That access token was not accepted. Check it and try again.");
  if (response.status === 429) throw new SessionError("unavailable", "Too many sign-in attempts. Wait a moment and try again.");
  if (!response.ok) throw new SessionError("unavailable", "The team API is unavailable. Retry in a moment.");
  const parsed = SessionSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new SessionError("unavailable", "The team API returned an unexpected session. Check the deployment and retry.");
  return parsed.data;
}

export function getSession(signal?: AbortSignal) { return sessionRequest({ signal }); }
export function signIn(token: string) {
  return sessionRequest({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
}
export function signOut() { return sessionRequest({ method: "DELETE" }); }
