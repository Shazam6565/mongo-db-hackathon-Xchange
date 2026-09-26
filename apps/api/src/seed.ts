import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CandidateInputSchema, ScopeSchema, type EvaluationResult, type Lesson, type Scope } from "@team-memory/contracts";
import { TicketInputSchema } from "../../../packages/contracts/src/tickets.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { stableUuid } from "./ids.js";
import { InMemoryLessonRepository } from "./repository.js";
import { createRuntime } from "./runtime.js";

// A corpus is plain JSON checked into corpus/. Records refer to each other by corpus key;
// the loader turns keys into stable IDs, so re-running it is a no-op and never overwrites
// records the team has edited since. Everything goes through the API routes, so the same
// validation, idempotency and publication gate apply as for any other client.
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/);
const actor = z.string().regex(/^[\w.-]{1,100}$/);
const RefSchema = z.object({ kind: z.enum(["ticket", "lesson", "activity"]), key }).strict();

export const CorpusSchema = z.object({
  scope: ScopeSchema,
  description: z.string().min(1),
  tickets: z.array(TicketInputSchema.extend({ key })).default([]),
  // evaluate: run the existing gate once. Only a passing evaluation publishes a lesson.
  lessons: z.array(z.object({ key, evaluate: z.boolean().default(true), candidate: CandidateInputSchema }).strict()).default([]),
  // record: an activity input whose optional subject is a {kind, key} reference.
  activity: z.array(z.object({ key, actor, record: z.record(z.string(), z.unknown()) }).strict()).default([]),
  // canvas: a canvas input whose record nodes use ref {kind, key}.
  canvases: z.array(z.object({ key, editor: actor, canvas: z.record(z.string(), z.unknown()) }).strict()).default([]),
}).strict();
export type Corpus = z.infer<typeof CorpusSchema>;

export type SeedOutcome = "created" | "exists" | "kept" | "published" | "rejected" | "needs-review" | "evaluated" | "failed";
export interface SeedLine { kind: "ticket" | "lesson" | "evaluation" | "activity" | "canvas"; key: string; outcome: SeedOutcome; detail?: string }

export const corpusId = (scope: Scope, kind: string, recordKey: string) =>
  stableUuid("corpus", scope.teamId, scope.projectId, kind, recordKey);

export async function seedCorpus(app: FastifyInstance, corpus: Corpus, token: string): Promise<SeedLine[]> {
  const lines: SeedLine[] = [];
  const ids = new Map<string, string>();
  const lessons = new Map<string, Lesson>();
  const headers = (actorId: string, operation?: string) => ({
    authorization: `Bearer ${token}`, "x-engineer-id": actorId, ...(operation ? { "idempotency-key": operation } : {}),
  });
  const failure = (body: { error?: string; issues?: { path?: unknown[]; message?: string }[] }) =>
    [body.error ?? "Request failed", ...(body.issues ?? []).map(issue => `${(issue.path ?? []).join(".")}: ${issue.message}`)].join("; ");
  const get = async (url: string) => {
    const response = await app.inject({ url, headers: headers("corpus-loader") });
    return response.statusCode === 200 ? response.json() : null;
  };
  function ref(value: unknown): { kind: "ticket" | "lesson" | "activity"; id: string } {
    const parsed = RefSchema.parse(value);
    const id = ids.get(`${parsed.kind}:${parsed.key}`);
    if (!id) throw new Error(`Unknown reference ${parsed.kind}:${parsed.key}. Define it earlier in the corpus.`);
    return { kind: parsed.kind, id };
  }

  const existingTickets = new Set(((await get("/v1/tickets"))?.tickets ?? []).map((ticket: { id: string }) => ticket.id));
  for (const ticket of corpus.tickets) {
    const id = corpusId(corpus.scope, "ticket", ticket.key);
    const response = await app.inject({ method: "POST", url: "/v1/tickets", headers: headers("corpus-loader", id), payload: ticket });
    if (response.statusCode === 201) {
      ids.set(`ticket:${ticket.key}`, id);
      lines.push({ kind: "ticket", key: ticket.key, outcome: existingTickets.has(id) ? "exists" : "created" });
    } else lines.push({ kind: "ticket", key: ticket.key, outcome: response.statusCode === 409 ? "kept" : "failed", detail: failure(response.json()) });
  }

  const existingLessons = new Set(((await get("/v1/lessons"))?.lessons ?? []).map((lesson: Lesson) => lesson.id));
  for (const entry of corpus.lessons) {
    const id = corpusId(corpus.scope, "lesson", entry.key);
    const response = await app.inject({ method: "POST", url: "/v1/lessons", headers: headers(entry.candidate.authorId, id), payload: entry.candidate });
    if (response.statusCode === 201) {
      lessons.set(entry.key, response.json());
      lines.push({ kind: "lesson", key: entry.key, outcome: existingLessons.has(id) ? "exists" : "created" });
    } else if (response.statusCode === 409) {
      // The team changed this lesson (or reused the key); keep theirs and continue with it.
      const current = await get(`/v1/lessons/${id}`);
      if (current) lessons.set(entry.key, current);
      lines.push({ kind: "lesson", key: entry.key, outcome: "kept", detail: "Stored lesson differs from the corpus; left unchanged." });
    } else lines.push({ kind: "lesson", key: entry.key, outcome: "failed", detail: failure(response.json()) });
    const lesson = lessons.get(entry.key);
    if (lesson) ids.set(`lesson:${entry.key}`, lesson.id);
  }

  const evaluated = new Set(((await get("/v1/evaluations"))?.evaluations ?? [])
    .map((item: EvaluationResult) => `${item.lessonId}:${item.candidateVersion}`));
  for (const entry of corpus.lessons.filter(item => item.evaluate)) {
    const lesson = lessons.get(entry.key);
    if (!lesson) continue;
    if (lesson.status !== "candidate" || evaluated.has(`${lesson.id}:${lesson.version}`)) {
      lines.push({ kind: "evaluation", key: entry.key, outcome: "evaluated", detail: `Already evaluated; status ${lesson.status}.` });
      continue;
    }
    const response = await app.inject({ method: "POST", url: `/v1/lessons/${lesson.id}/evaluate`, headers: headers("corpus-loader"), payload: { expectedVersion: lesson.version } });
    if (response.statusCode !== 200) { lines.push({ kind: "evaluation", key: entry.key, outcome: "failed", detail: failure(response.json()) }); continue; }
    const result = response.json() as { lesson: Lesson; evaluation: EvaluationResult };
    lessons.set(entry.key, result.lesson);
    const { decision, candidateScore, baselineScore, regressions } = result.evaluation;
    lines.push({ kind: "evaluation", key: entry.key, outcome: decision === "publish" ? "published" : decision === "reject" ? "rejected" : "needs-review",
      detail: `candidate ${candidateScore} vs baseline ${baselineScore}${regressions.length ? `; regressions: ${regressions.join(", ")}` : ""}` });
  }

  for (const entry of corpus.activity) {
    const id = corpusId(corpus.scope, "activity", entry.key);
    try {
      const { subject, ...record } = entry.record;
      let resolved: Record<string, unknown> | undefined;
      if (subject !== undefined) {
        const target = ref(subject);
        if (target.kind === "ticket") throw new Error("Activity can follow a lesson or another activity record, not a ticket. Cite tickets as evidence.");
        const lesson = target.kind === "lesson" ? [...lessons.values()].find(item => item.id === target.id) : undefined;
        resolved = lesson ? { kind: "lesson", id: lesson.id, version: lesson.version } : target;
      }
      const before = await get(`/v1/activity/${id}`);
      const response = await app.inject({ method: "POST", url: "/v1/activity", headers: headers(entry.actor, id), payload: { ...record, ...(resolved ? { subject: resolved } : {}) } });
      if ([200, 201].includes(response.statusCode)) {
        ids.set(`activity:${entry.key}`, id);
        lines.push({ kind: "activity", key: entry.key, outcome: before ? "exists" : "created" });
      } else lines.push({ kind: "activity", key: entry.key, outcome: response.statusCode === 409 ? "kept" : "failed", detail: failure(response.json()) });
    } catch (error) { lines.push({ kind: "activity", key: entry.key, outcome: "failed", detail: error instanceof Error ? error.message : String(error) }); }
  }

  for (const entry of corpus.canvases) {
    const id = corpusId(corpus.scope, "canvas", entry.key);
    try {
      const nodes = Array.isArray(entry.canvas.nodes) ? entry.canvas.nodes : [];
      const canvas = { ...entry.canvas, nodes: nodes.map((node: Record<string, unknown>) => node.kind === "record" ? { ...node, ref: ref(node.ref) } : node) };
      const before = await get(`/v1/canvases/${id}`);
      const response = await app.inject({ method: "PUT", url: `/v1/canvases/${id}`, headers: headers(entry.editor, corpusId(corpus.scope, "canvas-write", entry.key)),
        payload: { expectedRevision: 0, canvas } });
      if (response.statusCode === 200) lines.push({ kind: "canvas", key: entry.key, outcome: before ? "exists" : "created" });
      else lines.push({ kind: "canvas", key: entry.key, outcome: response.statusCode === 409 ? "kept" : "failed",
        detail: response.statusCode === 409 ? "Edited since seeding; left unchanged." : failure(response.json()) });
    } catch (error) { lines.push({ kind: "canvas", key: entry.key, outcome: "failed", detail: error instanceof Error ? error.message : String(error) }); }
  }
  return lines;
}

async function main(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const files = argv.filter(arg => !arg.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: npm run seed -- corpus/xchange.json [corpus/event-platform.json] [--dry-run]");
    process.exitCode = 1;
    return;
  }
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
  const settings = loadConfig(process.env);
  if (!dryRun && settings.mode !== "mongodb") {
    throw new Error("Seeding writes to MongoDB. Configure MONGODB_URI (STORAGE_MODE=mongodb), or pass --dry-run to validate against temporary storage.");
  }
  let failed = 0;
  for (const file of files) {
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
    const corpus = CorpusSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (!dryRun && corpus.scope.teamId !== settings.scope.teamId) {
      throw new Error(`${file} targets team ${corpus.scope.teamId}, but TEAM_ID is ${settings.scope.teamId}. Seed only your own team's data.`);
    }
    // A dry run starts from empty temporary storage, without the built-in sample lesson.
    const app = dryRun
      ? buildApp({ repository: new InMemoryLessonRepository(), token: settings.token, scope: corpus.scope, storage: "memory" })
      : await createRuntime({ ...settings, scope: corpus.scope });
    try {
      const lines = await seedCorpus(app, corpus, settings.token);
      const published = ((await app.inject({ url: "/v1/lessons", headers: { authorization: `Bearer ${settings.token}` } })).json().lessons as Lesson[])
        .filter(lesson => lesson.status === "published").length;
      console.log(`\n${corpus.scope.teamId}/${corpus.scope.projectId} · ${dryRun ? "dry run, temporary storage" : settings.label} · ${file}`);
      for (const line of lines) console.log(`  ${line.kind.padEnd(10)} ${line.key.padEnd(32)} ${line.outcome}${line.detail ? ` — ${line.detail}` : ""}`);
      console.log(`  ${published} published lesson${published === 1 ? "" : "s"} available to agents in this project.`);
      failed += lines.filter(line => line.outcome === "failed").length;
    } finally { await app.close(); }
  }
  if (failed) { console.error(`\n${failed} record${failed === 1 ? "" : "s"} failed validation; nothing else was changed for them.`); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof z.ZodError ? `Corpus file is invalid: ${error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
      : error instanceof Error ? error.message : "Seeding failed.");
    process.exitCode = 1;
  });
}
