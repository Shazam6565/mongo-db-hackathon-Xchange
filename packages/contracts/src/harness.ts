import { z } from "zod";
import { LessonSchema, ScopeSchema } from "./index.js";

// A harness version is an immutable record of which published lessons agents load.
// Publishing a lesson appends a version that adds it; a rollback appends a version that
// removes one. The highest number is active. Version 0 is implicit: before any record
// exists, every published lesson in the scope is active.
export const LessonRefSchema = z.object({ id: z.string().min(1).max(100), version: z.number().int().positive() }).strict();

export const HarnessVersionSchema = z.object({
  ...ScopeSchema.shape,
  id: z.string().uuid(),
  number: z.number().int().positive(),
  parentId: z.string().uuid().nullable(),
  lessons: z.array(LessonRefSchema).max(100),
  reason: z.enum(["publish", "rollback"]),
  lessonId: z.string().min(1).max(100), // The lesson this version added or removed.
  actorId: z.string(),
  createdAt: z.string().datetime(),
});

export const HarnessRollbackSchema = z.object({
  expectedVersion: z.number().int().min(0),
  lessonId: z.string().min(1).max(100),
}).strict();

// Inspection view: references only, and reading it is not recorded as consumption.
export const HarnessStateSchema = z.object({
  scope: ScopeSchema,
  version: z.number().int().min(0),
  versionId: z.string().uuid().nullable(),
  lessons: z.array(LessonRefSchema),
  versions: z.array(HarnessVersionSchema),
});

// What an agent loads: full lessons for the active version. Fetching it is audited.
export const ActiveHarnessSchema = z.object({
  scope: ScopeSchema,
  version: z.number().int().min(0),
  versionId: z.string().uuid().nullable(),
  lessons: z.array(LessonSchema),
  fetchedAt: z.string().datetime(),
});

// The harness activity feed: every audited action in the scope, newest first. Agents' memory reads
// (what each loaded, from which version), lesson proposals, evaluations, publications, rejections
// and harness versions added or rolled back. Reading the feed is not recorded as consumption.
export const AuditKindSchema = z.enum([
  "lesson.proposed", "lesson.evaluated", "lesson.published", "lesson.rejected", "memory.consumed", "harness.updated", "harness.rollback",
]);
export const AuditEventSchema = z.object({
  ...ScopeSchema.shape,
  id: z.string().min(1),
  kind: AuditKindSchema,
  lessonId: z.string().nullable(),
  lessonVersion: z.number().int().nullable(),
  actorId: z.string(),
  at: z.string().datetime(),
  summary: z.string(),
  consumed: z.array(LessonRefSchema).optional(),
  harnessVersion: z.number().int().min(0).optional(),
});
export const AuditQuerySchema = z.object({
  kind: AuditKindSchema.optional(),
  actorId: z.string().trim().min(1).max(100).optional(),
  since: z.string().datetime().transform((value) => new Date(value).toISOString()).optional(),
  until: z.string().datetime().transform((value) => new Date(value).toISOString()).optional(),
  // The last event ID of the previous page; the next page continues after it.
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict().superRefine((query, ctx) => {
  if (query.since && query.until && query.since > query.until) ctx.addIssue({ code: "custom", message: "The start must precede the end." });
});
export const AuditPageSchema = z.object({
  scope: ScopeSchema, events: z.array(AuditEventSchema), nextCursor: z.string().min(1).nullable().default(null),
});

export type LessonRef = z.infer<typeof LessonRefSchema>;
export type AuditKind = z.infer<typeof AuditKindSchema>;
export type AuditEventRecord = z.infer<typeof AuditEventSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type AuditPage = z.infer<typeof AuditPageSchema>;
export type HarnessVersionRecord = z.infer<typeof HarnessVersionSchema>;
export type HarnessRollback = z.infer<typeof HarnessRollbackSchema>;
export type HarnessState = z.infer<typeof HarnessStateSchema>;
export type ActiveHarness = z.infer<typeof ActiveHarnessSchema>;
