import { z } from "zod";
import { ScopeSchema } from "./index.js";

export const ActivityKindSchema = z.enum(["observation", "decision", "application", "outcome", "correction"]);
export const ActivitySubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lesson"), id: z.string().min(1).max(100), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("activity"), id: z.string().uuid() }).strict(),
]);
export const ActivityRootSchema = z.object({ kind: z.enum(["lesson", "activity"]), id: z.string().min(1).max(100) }).strict();
export const ActivityEvidenceSchema = z.object({
  reference: z.string().trim().min(1).max(500), summary: z.string().trim().min(1).max(1000),
}).strict();
export const OutcomeSchema = z.object({
  assessment: z.enum(["helped", "no_change", "regressed", "inconclusive"]),
  comparison: z.string().trim().min(1).max(2000),
  metrics: z.array(z.object({
    name: z.string().trim().min(1).max(80), unit: z.string().trim().min(1).max(40),
    before: z.number().finite(), after: z.number().finite(),
  }).strict()).max(8).default([]),
}).strict();

const inputShape = {
  kind: ActivityKindSchema,
  title: z.string().trim().min(1).max(80),
  detail: z.string().trim().min(1).max(4000),
  subject: ActivitySubjectSchema.optional(),
  runId: z.string().trim().min(1).max(100).optional(),
  evidence: z.array(ActivityEvidenceSchema).min(1).max(10),
  outcome: OutcomeSchema.optional(),
};
export const ActivityInputSchema = z.object(inputShape).strict().superRefine((input, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (["application", "outcome", "correction"].includes(input.kind) && !input.subject) issue("subject", "Link the record this follows.");
  if (["application", "outcome"].includes(input.kind) && !input.runId) issue("runId", "An application or outcome needs a task/run reference.");
  if (input.kind === "outcome" && !input.outcome) issue("outcome", "Describe the observed comparison.");
  if (input.kind !== "outcome" && input.outcome) issue("outcome", "Only outcomes carry a comparison.");
  if (["outcome", "correction"].includes(input.kind) && input.subject?.kind !== "activity") issue("subject", "Link an existing activity record.");
});
export const ActivityRecordSchema = z.object({
  ...inputShape, ...ScopeSchema.shape,
  id: z.string().uuid(), root: ActivityRootSchema,
  actorLabel: z.string(), recordedAt: z.string().datetime(),
  // A current projection, resolved independently of history filters or pagination.
  correctedBy: z.array(z.string().uuid()).default([]),
});
export const ActivityPageSchema = z.object({
  scope: ScopeSchema, records: z.array(ActivityRecordSchema), nextCursor: z.string().uuid().nullable(),
});
export const ActivityQuerySchema = z.object({
  kind: ActivityKindSchema.optional(),
  rootKind: z.enum(["lesson", "activity"]).optional(), rootId: z.string().min(1).max(100).optional(),
  since: z.string().datetime().transform(value => new Date(value).toISOString()).optional(),
  until: z.string().datetime().transform(value => new Date(value).toISOString()).optional(),
  cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().superRefine((query, ctx) => {
  if (Boolean(query.rootKind) !== Boolean(query.rootId)) ctx.addIssue({ code: "custom", message: "Provide both rootKind and rootId." });
  if (query.since && query.until && query.since > query.until) ctx.addIssue({ code: "custom", message: "The start must precede the end." });
});
export type ActivityInput = z.infer<typeof ActivityInputSchema>;
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
export type ActivitySubject = z.infer<typeof ActivitySubjectSchema>;
export type ActivityRoot = z.infer<typeof ActivityRootSchema>;
export type ActivityPage = z.infer<typeof ActivityPageSchema>;

export function activityLink(record: ActivityRecord): string {
  return `/?item=${encodeURIComponent(`${record.kind}:${record.id}`)}`;
}
