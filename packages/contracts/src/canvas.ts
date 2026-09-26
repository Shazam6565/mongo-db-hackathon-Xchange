import { z } from "zod";
import { ScopeSchema } from "./index.js";
const nodeId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const position = { id: nodeId, x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000), color: z.enum(["neutral", "sage", "blue", "amber"]).default("neutral") };
export const CanvasNodeSchema = z.discriminatedUnion("kind", [
  z.object({ ...position, kind: z.literal("note"), title: z.string().trim().min(1).max(80), text: z.string().max(2000).default("") }).strict(),
  z.object({ ...position, kind: z.literal("record"), ref: z.object({ kind: z.enum(["ticket", "lesson"]), id: z.string().min(1).max(100) }).strict() }).strict(),
]);
export const CanvasInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().max(2000).default(""),
  // Guides are curated explainers listed first, by order. Absent means a working board.
  kind: z.enum(["guide", "board"]).optional().describe("guide: curated explainer listed first; board (default): working canvas"),
  order: z.number().int().min(1).max(999).optional().describe("Position among guides, lowest first"),
  nodes: z.array(CanvasNodeSchema).max(100),
  edges: z.array(z.object({ id: nodeId, from: nodeId, to: nodeId, label: z.string().max(80).default("") }).strict()).max(200),
}).strict().superRefine((canvas, ctx) => {
  const ids = new Set(canvas.nodes.map(node => node.id));
  if (ids.size !== canvas.nodes.length) ctx.addIssue({ code: "custom", message: "Node IDs must be unique.", path: ["nodes"] });
  if (new Set(canvas.edges.map(edge => edge.id)).size !== canvas.edges.length) ctx.addIssue({ code: "custom", message: "Edge IDs must be unique.", path: ["edges"] });
  canvas.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) ctx.addIssue({ code: "custom", message: "An edge needs two different existing nodes.", path: ["edges", index] });
  });
});
export const CanvasWriteSchema = z.object({ expectedRevision: z.number().int().min(0), canvas: CanvasInputSchema }).strict();
export const CanvasRecordSchema = z.object({
  ...ScopeSchema.shape, id: z.string().uuid(), revision: z.number().int().positive(),
  canvas: CanvasInputSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), editorLabel: z.string(),
});
export const CanvasReferenceSchema = z.object({ kind: z.enum(["ticket", "lesson"]), id: z.string(), title: z.string(), description: z.string(), status: z.string() });
export const CanvasResponseSchema = z.object({ record: CanvasRecordSchema, references: z.array(CanvasReferenceSchema) });
export const CanvasListSchema = z.object({ scope: ScopeSchema, canvases: z.array(CanvasRecordSchema) });
export type CanvasInput = z.infer<typeof CanvasInputSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasWrite = z.infer<typeof CanvasWriteSchema>;
export type CanvasRecord = z.infer<typeof CanvasRecordSchema>;
export type CanvasReference = z.infer<typeof CanvasReferenceSchema>;
