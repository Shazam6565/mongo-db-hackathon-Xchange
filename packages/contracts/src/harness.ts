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

export type LessonRef = z.infer<typeof LessonRefSchema>;
export type HarnessVersionRecord = z.infer<typeof HarnessVersionSchema>;
export type HarnessRollback = z.infer<typeof HarnessRollbackSchema>;
export type HarnessState = z.infer<typeof HarnessStateSchema>;
export type ActiveHarness = z.infer<typeof ActiveHarnessSchema>;
