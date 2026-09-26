import { z } from "zod";

export const TicketInputSchema = z.object({
  summary: z.string().trim().min(1).max(160),
  key: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).optional(),
  description: z.string().max(8000).default(""),
  component: z.string().trim().min(1).max(100).nullable().default(null),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(20).default([]),
}).strict();

export const TicketRecordSchema = TicketInputSchema.extend({
  id: z.string().uuid(),
  key: z.string(),
  teamId: z.string(),
  projectId: z.string(),
  status: z.literal("open"),
  source: z.literal("manual"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TicketInput = z.infer<typeof TicketInputSchema>;
export type TicketRecord = z.infer<typeof TicketRecordSchema>;
