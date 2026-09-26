import { z } from "zod";

export const ScopeSchema = z.object({
  teamId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
});

export const EvidenceSchema = z.object({
  kind: z.enum(["ticket", "test", "review", "commit"]),
  reference: z.string().min(1).max(500),
  summary: z.string().min(1).max(2000),
});

export const HarnessChangeSchema = z.object({
  instructions: z.array(z.string().min(1).max(2000)).max(10),
  verificationSteps: z.array(z.string().min(1).max(500)).max(10),
  // Names from a fixed registered-tool allowlist, not executable code.
  suggestedTools: z.array(z.string().min(1).max(100)).max(10),
});

export const CandidateInputSchema = z.object({
  title: z.string().min(1).max(160),
  lesson: z.string().min(1).max(4000),
  authorId: z.string().min(1).max(100),
  appliesTo: z.array(z.string().min(1).max(100)).max(20),
  evidence: z.array(EvidenceSchema).min(1).max(20),
  proposedChange: HarnessChangeSchema,
}).strict();

export const LessonSchema = CandidateInputSchema.extend({
  id: z.string(),
  teamId: z.string(),
  projectId: z.string(),
  status: z.enum(["candidate", "published", "rejected", "superseded"]),
  version: z.number().int().positive(),
  origin: z.enum(["demo", "submitted"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// How a snapshot was ordered. Every agent receives the same published lessons; "vector" orders
// them by Atlas Vector Search relevance to the ticket/message, "recent" by publication time.
export const RetrievalSchema = z.object({
  mode: z.enum(["vector", "recent"]),
  model: z.string().nullable(),
  ticketKey: z.string().nullable(),
  // Why the snapshot is not vector-ordered, or why a requested ticket was not used.
  note: z.string().nullable(),
  scores: z.array(z.object({ id: z.string(), score: z.number() })),
});

export const MemorySnapshotSchema = z.object({
  scope: ScopeSchema,
  lessons: z.array(LessonSchema),
  fetchedAt: z.string().datetime(),
  retrieval: RetrievalSchema.optional(),
});

// Upper bound on query text sent to the embedding model. Free-tier Atlas clusters
// allow roughly 2,000 query tokens per minute, so keep each query small.
export const MEMORY_QUERY_MAX_CHARS = 2000;

export const MemorySearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(20000),
  ticketKey: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(10).default(10),
}).strict();

// The single text field Atlas Automated Embedding indexes for each lesson.
export function lessonSearchText(lesson: Pick<CandidateInput, "title" | "lesson" | "appliesTo" | "proposedChange">): string {
  return [
    lesson.title,
    lesson.lesson,
    lesson.appliesTo.length ? `Applies to: ${lesson.appliesTo.join(", ")}` : "",
    ...lesson.proposedChange.instructions,
    ...lesson.proposedChange.verificationSteps,
  ].filter(Boolean).join("\n");
}

// Ticket context first, then the engineer's latest message, bounded for the embedding budget.
export function composeMemoryQuery(prompt: string, ticket?: { key: string; summary: string; description: string } | null): string {
  const message = prompt.trim();
  if (!ticket) return message.slice(0, MEMORY_QUERY_MAX_CHARS);
  const ticketText = `${ticket.key}: ${ticket.summary}\n${ticket.description}`.trim().slice(0, 1200);
  return `${ticketText}\n\n${message}`.slice(0, MEMORY_QUERY_MAX_CHARS);
}

export const EvaluateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

export const ENGINEER_ID_HEADER = "x-engineer-id";

const ENGINEER_ID_PATTERN = /^[\w.-]{1,100}$/;

export function engineerIdFromHeader(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "unspecified";
  const trimmed = raw.trim();
  return ENGINEER_ID_PATTERN.test(trimmed) ? trimmed : "unspecified";
}

export type Scope = z.infer<typeof ScopeSchema>;
export type CandidateInput = z.infer<typeof CandidateInputSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type MemorySnapshot = z.infer<typeof MemorySnapshotSchema>;
export type Retrieval = z.infer<typeof RetrievalSchema>;
export type MemorySearchRequest = z.infer<typeof MemorySearchRequestSchema>;

// Native tickets use the implemented, validated record shape.
export type { TicketRecord as Ticket } from "./tickets.js";

// Future agent-event ingestion contract. No /v1/agent-changes route is registered.
export interface AgentChangeInput {
  eventId: string; // Stable across retries, for scoped idempotency.
  ticketKey: string;
  agentId: string;
  sessionId: string;
  kind: "observation" | "triage-proposal" | "verification-result" | "lesson-candidate" | "memory-applied";
  summary: string;
  observedAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  evidence: z.infer<typeof EvidenceSchema>[];
  lessonId?: string;
}

export interface AgentChange extends AgentChangeInput, Scope {
  id: string;
  engineerId: string; // Assigned by the service from authenticated identity.
  recordedAt: string;
}

export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export interface LessonVersionRef {
  id: string;
  version: number;
}

export interface EvaluationCaseResult {
  caseId: string;
  ticketKey: string;
  applied: boolean;
  component: string | null;
  componentCorrect: boolean;
  checksCovered: number;
  checksTotal: number;
}

export interface EvaluationScores {
  suiteVersion: string;
  evaluatorVersion: string;
  baselineScore: number;
  candidateScore: number;
  regressions: string[];
  decision: "publish" | "reject" | "needs-review";
  cases: EvaluationCaseResult[];
}

export interface EvaluationResult extends EvaluationScores {
  id: string;
  teamId: string;
  projectId: string;
  lessonId: string;
  candidateVersion: number;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  teamId: string;
  projectId: string;
  kind: "lesson.proposed" | "lesson.evaluated" | "lesson.published" | "lesson.rejected" | "memory.consumed";
  lessonId: string | null;
  lessonVersion: number | null;
  actorId: string;
  at: string;
  summary: string;
  consumed?: LessonVersionRef[];
}

export interface HarnessVersion extends Scope {
  id: string;
  parentVersionId: string | null;
  lessonIds: string[];
  evaluationIds: string[];
  change: z.infer<typeof HarnessChangeSchema>;
  status: "candidate" | "active" | "retired";
}

// Harness activation remains a design contract. Publication records the lesson;
// it does not install instructions, tools, or verification steps into Pi.

export function renderMemory(snapshot: MemorySnapshot): string {
  const lines = [
    "# Shared team memory",
    "",
    "> Generated cache. Submit changes as lesson candidates; do not edit this file.",
    `> Scope: ${snapshot.scope.teamId} / ${snapshot.scope.projectId}`,
    `> Last fetched: ${snapshot.fetchedAt}`,
  ];
  const retrieval = snapshot.retrieval;
  if (retrieval?.mode === "vector") {
    lines.push(`> Order: most relevant first, by Atlas Vector Search (${retrieval.model ?? "unknown model"})` +
      (retrieval.ticketKey ? ` for ticket ${retrieval.ticketKey}` : ""));
  } else if (retrieval?.mode === "recent") {
    lines.push("> Order: most recently published first");
  }
  if (retrieval?.note) lines.push(`> Note: ${retrieval.note}`);
  lines.push("");
  const scores = new Map(retrieval?.scores.map((item) => [item.id, item.score]) ?? []);
  const published = snapshot.lessons.filter((lesson) => lesson.status === "published");
  if (published.length === 0) lines.push("No published lessons are available.");
  for (const lesson of published) {
    const score = scores.get(lesson.id);
    lines.push(
      `## ${lesson.title}`,
      "",
      `ID: ${lesson.id} · version ${lesson.version} · origin: ${lesson.origin}${score === undefined ? "" : ` · relevance ${score.toFixed(3)}`}`,
      `Applies to: ${lesson.appliesTo.join(", ") || "project-wide"}`,
      "",
      lesson.lesson,
      "",
      ...lesson.evidence.map((e) => `- Evidence (${e.kind}): ${e.reference} — ${e.summary}`),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
