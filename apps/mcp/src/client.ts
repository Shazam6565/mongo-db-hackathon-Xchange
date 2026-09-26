import { z } from "zod";
import { ScopeSchema, type Scope } from "../../../packages/contracts/src/index.js";

export const AccessSchema = z.object({
  mode: z.enum(["local", "team"]),
  actorId: z.string().regex(/^[\w.-]{1,100}$/),
  role: z.enum(["reader", "writer", "evaluator", "owner"]),
  scope: ScopeSchema,
}).strict().refine(value => value.mode === "local" ? value.role === "owner" : value.role !== "owner");
export type Access = z.infer<typeof AccessSchema>;

export class XchangeError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) { super(message); this.name = "XchangeError"; }
}

export function validateApiOrigin(value: string): string {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error();
    return url.origin;
  } catch { throw new XchangeError("configuration", "The Xchange API requires an HTTPS origin, or HTTP on loopback, without a path, credentials, query or fragment."); }
}

export interface XchangeClientOptions {
  origin: string;
  token: string;
  engineerId?: string;
  expectedScope?: Scope;
  expectedMode?: Access["mode"];
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const messages: Record<number, [string, string]> = {
  400: ["invalid_request", "Xchange rejected the request. Check its typed fields and linked records."],
  401: ["unauthorized", "The Xchange credential is invalid or revoked. Its owner must repair access."],
  403: ["forbidden", "This Xchange credential does not permit this operation."],
  404: ["not_found", "The requested record was not found in this workspace."],
  409: ["conflict", "Xchange reported a conflict. Read the current record and reconcile; preserve the operation UUID and exact payload when checking an uncertain retry."],
  413: ["too_large", "The Xchange request exceeds the allowed payload size."],
  429: ["rate_limited", "Xchange is rate limited. No request was automatically retried."],
};

export function sameScope(first: Scope, second: Scope): boolean {
  return first.teamId === second.teamId && first.projectId === second.projectId;
}

/** A fixed-origin, server-configured bearer client. Never retries an uncertain write. */
export class XchangeClient {
  readonly origin: string;
  readonly #token: string;
  readonly #engineerId?: string;
  readonly #expectedScope?: Scope;
  readonly #expectedMode?: Access["mode"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: XchangeClientOptions) {
    this.origin = validateApiOrigin(options.origin);
    if (!/^[\x21-\x7e]{1,1024}$/.test(options.token)) throw new XchangeError("configuration", "A valid privately configured Xchange credential is required.");
    if (options.engineerId !== undefined && !/^[\w.-]{1,100}$/.test(options.engineerId)) throw new XchangeError("configuration", "The local engineer identity is invalid.");
    this.#token = options.token;
    this.#engineerId = options.engineerId;
    this.#expectedScope = options.expectedScope === undefined ? undefined : ScopeSchema.parse(options.expectedScope);
    this.#expectedMode = options.expectedMode;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 30_000 ||
        !Number.isInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1 || this.#maxResponseBytes > 8 * 1024 * 1024) {
      throw new XchangeError("configuration", "Xchange timeout or response size bounds are invalid.");
    }
  }

  async verifyAccess(expected?: Access): Promise<Access> {
    const parsed = AccessSchema.safeParse(await this.request("/v1/access"));
    if (!parsed.success) throw new XchangeError("invalid_response", "Xchange returned an invalid access identity.");
    const access = parsed.data;
    if ((this.#expectedScope && !sameScope(access.scope, this.#expectedScope)) ||
        (this.#expectedMode && access.mode !== this.#expectedMode) ||
        (expected && (!sameScope(access.scope, expected.scope) || access.actorId !== expected.actorId || access.mode !== expected.mode || access.role !== expected.role))) {
      throw new XchangeError("access_changed", "Xchange identity, role or workspace differs from the configured connection. Reconnect with the intended individual credential.", 403);
    }
    return access;
  }

  async request(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown, operationId?: string): Promise<unknown> {
    if (!path.startsWith("/v1/") || path.includes("\\") || path.includes("#") || /(?:^|\/)\.\.(?:\/|\?|$)/.test(path)) {
      throw new XchangeError("invalid_request", "Only fixed Xchange API paths are supported.");
    }
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith("/v1/")) throw new XchangeError("invalid_request", "Only the configured Xchange API origin is allowed.");
    if (method !== "GET" && !z.string().uuid().safeParse(operationId).success) throw new XchangeError("invalid_request", "Writes require a caller-supplied UUID operationId.");
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > 512 * 1024) throw new XchangeError("too_large", "The Xchange request exceeds the allowed payload size.");
    const headers: Record<string, string> = { authorization: `Bearer ${this.#token}`, accept: "application/json" };
    if (this.#engineerId) headers["x-engineer-id"] = this.#engineerId;
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (operationId) headers["idempotency-key"] = operationId;
    const controller = new AbortController();
    const timeout = new XchangeError("timeout", "The Xchange request timed out. For a write, retain its operation UUID and exact payload before checking the result.");
    let responseBody: ReadableStream<Uint8Array> | null | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // Cancellation is best effort: custom fetch/stream adapters may ignore the signal
    // or return a cancellation promise that never settles. Neither can hold the caller.
    const cancel = (body = responseBody): void => {
      try { void (reader ? reader.cancel() : body?.cancel())?.catch(() => {}); } catch {}
    };
    let rejectDeadline!: (error: XchangeError) => void;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => {
      rejectDeadline(timeout);
      controller.abort();
      cancel();
    }, this.#timeoutMs);
    const withinDeadline = <T>(pending: Promise<T>): Promise<T> => Promise.race([pending, deadline]);
    try {
      const response = await withinDeadline(this.#fetch(url, { method, headers, body: payload, redirect: "error", signal: controller.signal }).then(value => {
        // An injected adapter can finish after its deadline. Dispose that late body
        // without reading it or treating an uncertain write as confirmed.
        if (controller.signal.aborted) { cancel(value.body); throw timeout; }
        return value;
      }));
      responseBody = response.body;
      if (response.redirected || (response.url && new URL(response.url).origin !== this.origin) || (response.status >= 300 && response.status < 400)) {
        cancel();
        throw new XchangeError("redirect", "Xchange redirects are not permitted.");
      }
      if (!response.ok) {
        cancel();
        const [code, message] = messages[response.status] ?? ["unavailable", "The Xchange API is unavailable. No request was automatically retried."];
        throw new XchangeError(code!, message!, response.status);
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        cancel();
        throw new XchangeError("invalid_response", "Xchange returned a non-JSON response.");
      }
      const advertisedLength = Number(response.headers.get("content-length"));
      if (advertisedLength > this.#maxResponseBytes) {
        cancel();
        throw new XchangeError("too_large", "The Xchange result exceeds the response limit. Use a narrower query or retrieve a known record.");
      }
      if (!response.body) throw new XchangeError("invalid_response", "Xchange returned an empty response.");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await withinDeadline(reader.read());
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > this.#maxResponseBytes) {
            cancel();
            throw new XchangeError("too_large", "The Xchange result exceeds the response limit. Use a narrower query or retrieve a known record.");
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); reader = undefined; }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new XchangeError("invalid_response", "Xchange returned invalid JSON."); }
    } catch (error) {
      if (error instanceof XchangeError) throw error;
      if (controller.signal.aborted) throw timeout;
      throw new XchangeError("unavailable", "The Xchange request failed. No request was automatically retried.");
    } finally { clearTimeout(timer); }
  }
}
