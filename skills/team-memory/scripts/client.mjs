#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { projectRoot, syncSkills } from "./skills.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The team's hosted workspace. A local owner API needs TEAM_API_URL=http://127.0.0.1:4317.
export const HOSTED_API_URL = "https://mongo-db-hackathon-xchange.vercel.app";
export async function run(args = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const [command, id, file, operation] = args;
  const base = new URL(env.TEAM_API_URL || HOSTED_API_URL);
  if (base.username || base.password || base.search || base.hash || !["/", ""].includes(base.pathname)) throw new Error("TEAM_API_URL must be an origin without embedded credentials or query parameters.");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Use HTTPS for a remote API.");
  const token = env.TEAM_API_TOKEN;
  if (!token) throw new Error("Configure TEAM_API_TOKEN privately before using this skill, for example in ~/.team-memory/credential.env.");
  const recordId = () => {
    if (!id || id.length > 100 || [".", ".."].includes(id) || /[\s/\\?#]/.test(id)) throw new Error("Provide a record ID, not a path or URL.");
    return encodeURIComponent(id);
  };
  const expectedVersion = (minimum) => {
    if (!/^(0|[1-9][0-9]*)$/.test(file || "") || !Number.isSafeInteger(Number(file)) || Number(file) < minimum) throw new Error("Provide the exact expected version as an integer.");
    return Number(file);
  };
  async function api(path, method = "GET", body, key) {
    let response;
    try { response = await fetchImpl(new URL(`/v1${path}`, base), {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-engineer-id": env.ENGINEER_ID || "unattributed", ...(key ? { "idempotency-key": key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000), redirect: "error",
    }); } catch { throw new Error("API unavailable or timed out. For a canvas write, retry with identical content and identifiers before reconciling."); }
    if (!response.ok) throw new Error(response.status === 409 ? "Conflict (409): reread and reconcile. Do not overwrite another writer's changes." : `API request failed (${response.status}). Check the payload, access and server connection.`);
    return response.json();
  }
  switch (command) {
    case "access": {
      const access = await api("/access");
      if (!access || !["team", "local"].includes(access.mode) || typeof access.actorId !== "string" ||
          !(access.mode === "team" ? ["reader", "writer", "evaluator"] : ["owner"]).includes(access.role) ||
          typeof access.scope?.teamId !== "string" || typeof access.scope?.projectId !== "string") throw new Error("The API returned an invalid access response. Check the deployment.");
      if (base.protocol === "https:" && access.mode !== "team") throw new Error("Remote agent access requires team authentication.");
      return access;
    }
    case "memory": return api("/memory");
    // Writes the active harness version as generated skills under the project root (default: nearest .git).
    case "sync-skills": return syncSkills(id ? resolve(id) : await projectRoot(process.cwd()), await api("/harness/active"));
    case "harness": return api("/harness");
    case "lesson": return api(`/lessons/${recordId()}`);
    case "ticket": return api(`/tickets/${recordId()}`);
    case "evaluations": return api("/evaluations");
    case "audit": return api("/audit");
    case "evaluate": return api(`/lessons/${recordId()}/evaluate`, "POST", { expectedVersion: expectedVersion(1) });
    case "rollback": recordId(); return api("/harness/rollback", "POST", { lessonId: id, expectedVersion: expectedVersion(0) });
    case "catalog": { const [lessons, tickets] = await Promise.all([api("/lessons"), api("/tickets")]); return { lessons, tickets }; }
    case "create-ticket": if (!id || !uuid.test(file || "")) throw new Error("Usage: create-ticket JSON_FILE OPERATION_UUID"); return api("/tickets", "POST", JSON.parse(await readFile(id, "utf8")), file);
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
    case "propose": if (!id || (file && !uuid.test(file))) throw new Error("Usage: propose JSON_FILE [OPERATION_UUID]"); return api("/lessons", "POST", JSON.parse(await readFile(id, "utf8")), file);
    default: throw new Error("Commands: access, memory, sync-skills [PROJECT_ROOT], harness, lesson ID, ticket ID, evaluations, audit, evaluate LESSON_ID EXPECTED_VERSION, rollback LESSON_ID EXPECTED_HARNESS_VERSION, catalog, create-ticket JSON_FILE OPERATION_UUID, canvases, schema, canvas UUID, write-canvas UUID JSON_FILE OPERATION_UUID, propose JSON_FILE [OPERATION_UUID], list-activity [QUERY], read-activity UUID, record-activity JSON_FILE OPERATION_UUID");
  }
}
// Settings missing from the environment come from the private credential file the Pi extension also reads:
// TEAM_MEMORY_ENV, or ~/.team-memory/credential.env. Only these keys are read, so other values there stay unread.
export function credentialSettings(env = process.env) {
  let text;
  try { text = readFileSync(env.TEAM_MEMORY_ENV?.trim() || join(homedir(), ".team-memory", "credential.env"), "utf8"); } catch { return {}; }
  const settings = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(TEAM_API_URL|TEAM_API_TOKEN|ENGINEER_ID)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !env[match[1]]?.trim()) settings[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return settings;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2), { ...process.env, ...credentialSettings() }), null, 2)); }
  catch (error) { console.error(error instanceof Error && !["SyntaxError", "TypeError"].includes(error.name) ? error.message : "Invalid configuration or JSON input."); process.exitCode = 1; }
}
