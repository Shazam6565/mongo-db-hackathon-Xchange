import type { FastifyInstance } from "fastify";
import { loadHostedConfig } from "./hosted-config.js";
import { createRuntime } from "./runtime.js";

// Reuse bounded repository pools per warm instance; instances do not share pools.
let runtime: Promise<FastifyInstance> | undefined;
function getRuntime() {
  return runtime ??= Promise.resolve().then(() => {
    const { settings, teamAuth } = loadHostedConfig(process.env);
    return createRuntime(settings, teamAuth);
  }).catch(error => { runtime = undefined; throw error; });
}
function response(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
export function createHostedHandler(getApp: () => Promise<FastifyInstance>) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // Rewrites preserve search filters and supply the original API path.
    const route = url.searchParams.get("route");
    const path = route ? `/${route}` : url.pathname.replace(/^\/api(?=\/)/, "");
    url.searchParams.delete("route");
    if (!(path === "/health" || path === "/session" || path.startsWith("/v1/")) || /[?#\\]/.test(path)) return response(404, "API route not found.");
    const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
    type Method = typeof methods[number];
    if (!methods.includes(request.method as Method)) return response(405, "Method not allowed.");
    let payload: Buffer | undefined;
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 512 * 1024) { await reader.cancel(); return response(413, "Request body is too large."); }
          chunks.push(value);
        }
        payload = Buffer.concat(chunks);
      } catch { return response(400, "Could not read request body."); }
    }
    try {
      const app = await getApp();
      const headers = Object.fromEntries(request.headers);
      delete headers["content-length"];
      const result = await app.inject({ method: request.method as Method, url: path + url.search, headers, payload });
      const outputHeaders = new Headers();
      for (const [name, value] of Object.entries(result.headers)) {
        if (value === undefined || ["connection", "transfer-encoding", "content-length"].includes(name)) continue;
        for (const entry of Array.isArray(value) ? value : [value]) outputHeaders.append(name, String(entry));
      }
      outputHeaders.set("cache-control", "no-store");
      return new Response(request.method === "HEAD" || [204, 304].includes(result.statusCode) ? null : new Uint8Array(result.rawPayload), { status: result.statusCode, headers: outputHeaders });
    } catch {
      return response(503, "The team API is unavailable. Check server configuration and MongoDB connectivity.");
    }
  };
}
export const hostedFetch = createHostedHandler(getRuntime);
