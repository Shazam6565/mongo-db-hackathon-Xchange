import { z } from "zod";
import type { Scope } from "@team-memory/contracts";
import type { CanvasInput } from "../../../../packages/contracts/src/canvas.js";

// Unsaved canvas edits are kept in this browser, per project and canvas, so leaving the page never
// loses work. The shared copy changes only on Save. Storage can be unavailable (private windows,
// blocked site data), so every access is guarded and callers are told when a draft was not kept.
const text = (max: number) => z.string().max(max);
const place = { id: text(80).min(1), x: z.number().finite(), y: z.number().finite(), color: z.enum(["neutral", "sage", "blue", "amber"]) };
// Structural check only: a draft may be mid-edit (for example a cleared title) and is validated on Save.
const LooseCanvas = z.object({
  title: text(80), description: text(2000), kind: z.enum(["guide", "board"]).optional(), order: z.number().int().optional(),
  nodes: z.array(z.discriminatedUnion("kind", [
    z.object({ ...place, kind: z.literal("note"), title: text(80), text: text(2000) }),
    z.object({ ...place, kind: z.literal("record"), ref: z.object({ kind: z.enum(["ticket", "lesson"]), id: text(100).min(1) }) }),
  ])).max(100),
  edges: z.array(z.object({ id: text(80).min(1), from: text(80), to: text(80), label: text(80) })).max(200),
});
const DraftSchema = z.object({ v: z.literal(1), id: z.string().uuid(), baseRevision: z.number().int().min(0), base: LooseCanvas.nullable(), draft: LooseCanvas, keptAt: z.string().datetime() });
export type LocalDraft = { id: string; baseRevision: number; base: CanvasInput | null; draft: CanvasInput; keptAt: string };

const maxAge = 30 * 24 * 60 * 60 * 1000;
const prefix = (scope: Scope) => `team-memory:canvas-draft:v1:${encodeURIComponent(scope.teamId)}:${encodeURIComponent(scope.projectId)}:`;
function parse(raw: string | null): LocalDraft | null {
  if (!raw) return null;
  try {
    const value = DraftSchema.safeParse(JSON.parse(raw));
    return value.success && Date.now() - Date.parse(value.data.keptAt) < maxAge ? value.data as LocalDraft : null;
  } catch { return null; }
}
export function readDraft(scope: Scope, id: string): LocalDraft | null {
  try { return parse(localStorage.getItem(prefix(scope) + id)); } catch { return null; }
}
/** Returns false when this browser could not keep the draft. */
export function keepDraft(scope: Scope, draft: Omit<LocalDraft, "keptAt">): boolean {
  try { localStorage.setItem(prefix(scope) + draft.id, JSON.stringify({ v: 1, ...draft, keptAt: new Date().toISOString() })); return true; }
  catch { return false; }
}
export function dropDraft(scope: Scope, id: string) {
  try { localStorage.removeItem(prefix(scope) + id); } catch { /* nothing kept */ }
}
export function listDrafts(scope: Scope): LocalDraft[] {
  try {
    const start = prefix(scope), found: LocalDraft[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(start)) continue;
      const draft = parse(localStorage.getItem(key));
      if (draft && key === start + draft.id) found.push(draft);
    }
    return found.sort((a, b) => b.keptAt.localeCompare(a.keptAt));
  } catch { return []; }
}
