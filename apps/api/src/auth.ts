import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

export type TeamRole = "reader" | "writer" | "evaluator";
export interface TeamAuthGrant { actorId: string; tokenHash: string; role: TeamRole }
export interface TeamAuthConfig { grants: TeamAuthGrant[]; sessionSecret: string; publicOrigin: string }
export interface TeamPrincipal { actorId: string; role: TeamRole; via: "bearer" | "cookie" }
export interface SessionUser { authenticated: boolean; mode: "team" | "local"; actorId?: string; role?: TeamRole }

const grantSchema = z.object({
  actorId: z.string().regex(/^[\w.-]{1,100}$/),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  role: z.enum(["reader", "writer", "evaluator"]),
}).strict();
const configSchema = z.object({
  grants: z.array(grantSchema).min(1).max(100),
  sessionSecret: z.string().min(32).max(512),
  publicOrigin: z.string().max(500),
}).strict();
const tokenSchema = z.string().min(32).max(1024).regex(/^[\x21-\x7e]+$/);
const loginSchema = z.object({ token: tokenSchema }).strict();
const cookieName = "__Host-team-memory-session";
const sessionSeconds = 8 * 60 * 60;
const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=Strict";

/** Validate server-only configuration without including supplied values in errors. */
export function validateTeamAuthConfig(input: unknown): TeamAuthConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new Error("Team authentication requires valid grants, a session secret of at least 32 characters, and a public HTTPS origin.");
  const config = parsed.data;
  try {
    const origin = new URL(config.publicOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
    config.publicOrigin = origin.origin;
  } catch { throw new Error("Team authentication requires a public HTTPS origin without credentials, path, query or fragment."); }
  if (!config.sessionSecret.trim() || new Set(config.grants.map(grant => grant.tokenHash)).size !== config.grants.length) {
    throw new Error("Team authentication requires a nonempty session secret and distinct grant hashes.");
  }
  return config;
}

export function hashTeamToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function equal(a: string, b: string): boolean {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
function sessionUser(principal: TeamPrincipal | null): SessionUser {
  return principal ? { authenticated: true, mode: "team", actorId: principal.actorId, role: principal.role } : { authenticated: false, mode: "team" };
}
function readCookie(request: FastifyRequest): string | null {
  const matches = (request.headers.cookie ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
  return matches.length === 1 ? matches[0]!.slice(cookieName.length + 1) : null;
}

export function createTeamAuthentication(input: TeamAuthConfig, now: () => number = Date.now) {
  const config = validateTeamAuthConfig(input);
  function byHash(hash: string) { return config.grants.find(grant => equal(grant.tokenHash, hash)) ?? null; }
  function byToken(token: string) { return tokenSchema.safeParse(token).success ? byHash(hashTeamToken(token)) : null; }
  function sign(payload: string) { return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url"); }
  function issueSession(grant: TeamAuthGrant): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, hash: grant.tokenHash, exp: Math.floor(now() / 1000) + sessionSeconds })).toString("base64url");
    return `${cookieName}=${payload}.${sign(payload)}; ${cookieFlags}; Max-Age=${sessionSeconds}`;
  }
  function authenticate(request: FastifyRequest): TeamPrincipal | null {
    // A supplied but invalid bearer credential cannot fall back to browser cookies.
    if (request.headers.authorization !== undefined) {
      const match = /^Bearer ([^ ]+)$/.exec(request.headers.authorization);
      const grant = match ? byToken(match[1]!) : null;
      return grant ? { actorId: grant.actorId, role: grant.role, via: "bearer" } : null;
    }
    const cookie = readCookie(request);
    if (!cookie || cookie.length > 2048) return null;
    const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(cookie);
    if (!parts || !equal(sign(parts[1]!), parts[2]!)) return null;
    try {
      const value = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
      const seconds = Math.floor(now() / 1000);
      if (value.v !== 1 || typeof value.hash !== "string" || !Number.isSafeInteger(value.exp) || value.exp <= seconds || value.exp > seconds + sessionSeconds) return null;
      const grant = byHash(value.hash);
      return grant ? { actorId: grant.actorId, role: grant.role, via: "cookie" } : null;
    } catch { return null; }
  }
  function sameOrigin(request: FastifyRequest): boolean { return request.headers.origin === config.publicOrigin; }
  function permits(principal: TeamPrincipal, method: string, evaluatorOnly = false): boolean {
    if (evaluatorOnly) return principal.role === "evaluator";
    return ["GET", "HEAD", "OPTIONS"].includes(method) || principal.role !== "reader";
  }
  function registerSessions(app: FastifyInstance) {
    app.get("/session", async request => sessionUser(authenticate(request)));
    app.post("/session", { bodyLimit: 2048 }, async (request, reply) => {
      if (!sameOrigin(request)) return reply.code(403).send({ error: "Sign in from the configured application origin." });
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Provide a valid team access token." });
      const grant = byToken(parsed.data.token);
      if (!grant) return reply.code(401).send({ error: "The team access token is invalid or revoked." });
      reply.header("set-cookie", issueSession(grant));
      return sessionUser({ ...grant, via: "cookie" });
    });
    app.delete("/session", async (request, reply) => {
      if (!sameOrigin(request)) return reply.code(403).send({ error: "Sign out from the configured application origin." });
      reply.header("set-cookie", `${cookieName}=; ${cookieFlags}; Max-Age=0`);
      return sessionUser(null);
    });
  }
  return { authenticate, sameOrigin, permits, registerSessions };
}
