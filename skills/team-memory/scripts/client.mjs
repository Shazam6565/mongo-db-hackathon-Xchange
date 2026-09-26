#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const [command, id, file, operation] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function run() {
  const base = new URL(process.env.TEAM_API_URL || "http://127.0.0.1:4317");
  if (base.username || base.password || base.search || base.hash || !["/", ""].includes(base.pathname)) throw new Error("TEAM_API_URL must be an origin without embedded credentials or query parameters.");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Use HTTPS for a remote API.");
  const token = process.env.TEAM_API_TOKEN;
  if (!token) throw new Error("Configure TEAM_API_TOKEN privately before using this skill.");
  async function api(path, method = "GET", body, key) {
    let response;
    try { response = await fetch(new URL(`/v1${path}`, base), {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-engineer-id": process.env.ENGINEER_ID || "unattributed", ...(key ? { "idempotency-key": key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000), redirect: "error",
    }); } catch { throw new Error("API unavailable or timed out. For a canvas write, retry with identical content and identifiers before reconciling."); }
    if (!response.ok) throw new Error(response.status === 409 ? "Conflict (409): reread and reconcile. Do not overwrite another writer's changes." : `API request failed (${response.status}). Check the payload, access and server connection.`);
    return response.json();
  }
  switch (command) {
    case "memory": return api("/memory");
    case "catalog": { const [lessons, tickets] = await Promise.all([api("/lessons"), api("/tickets")]); return { lessons, tickets }; }
    case "canvases": return api("/canvases");
    case "list-activity": return api(`/activity?${new URLSearchParams(id || "limit=100")}`);
    case "read-activity": if (!uuid.test(id || "")) throw new Error("An activity UUID is required."); return api(`/activity/${id}`);
    case "record-activity": if (!id || !uuid.test(file || "")) throw new Error("Usage: record-activity JSON_FILE OPERATION_UUID"); return api("/activity", "POST", JSON.parse(await readFile(id, "utf8")), file);
    case "schema": return api("/canvas-schema");
    case "canvas": if (!uuid.test(id || "")) throw new Error("A canvas UUID is required."); return api(`/canvases/${id}`);
    case "write-canvas": {
      if (!uuid.test(id || "") || !uuid.test(operation || "") || !file) throw new Error("Usage: write-canvas CANVAS_UUID JSON_FILE OPERATION_UUID");
      const source = await readFile(file, "utf8"); if (Buffer.byteLength(source) > 512 * 1024) throw new Error("Drawing exceeds 512 KB.");
      return api(`/canvases/${id}`, "PUT", JSON.parse(source), operation);
    }
    case "propose": if (!id) throw new Error("Usage: propose JSON_FILE"); return api("/lessons", "POST", JSON.parse(await readFile(id, "utf8")));
    default: throw new Error("Commands: memory, catalog, canvases, schema, canvas UUID, write-canvas UUID JSON_FILE OPERATION_UUID, propose JSON_FILE");
  }
}
try { console.log(JSON.stringify(await run(), null, 2)); }
catch (error) { console.error(error instanceof Error && !["SyntaxError", "TypeError"].includes(error.name) ? error.message : "Invalid configuration or JSON input."); process.exitCode = 1; }
