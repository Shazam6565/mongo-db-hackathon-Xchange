import { z } from "zod";
import { ScopeSchema } from "@team-memory/contracts";
import { ActivityPageSchema, type ActivityRecord } from "../../../../packages/contracts/src/activity.js";
import { CanvasListSchema } from "../../../../packages/contracts/src/canvas.js";
import { HarnessStateSchema } from "../../../../packages/contracts/src/harness.js";
import { HealthResponse, LessonsResponse, TicketsResponse, request } from "../catalog/api.js";
import { schedule } from "./schedule.js";

// The Timeline is a read-only projection: every mark is an existing record, audit event, harness
// version, canvas save, commit or scheduled milestone. Nothing here is stored or inferred.
export const layers = [
  { id: "milestones", label: "Milestones", hint: "Event schedule and harness versions" },
  { id: "git", label: "Git", hint: "Commits in this repository" },
  { id: "tickets", label: "Tickets", hint: "Work created in Catalog" },
  { id: "lessons", label: "Lessons", hint: "Candidates and their evaluation outcome" },
  { id: "activity", label: "Activity", hint: "Observations, decisions, applications, outcomes" },
  { id: "memory", label: "Memory reads", hint: "Agents loading the active harness" },
  { id: "canvases", label: "Canvases", hint: "Maps and guides, by latest save" },
] as const;
export type LayerId = typeof layers[number]["id"];
// Same meaning as canvas colors: inputs, agent evidence, verified results, the system.
export type Tone = "blue" | "amber" | "sage" | "neutral" | "red";
export interface TimelineItem {
  id: string; layer: LayerId; at: number; end?: number; title: string; kind: string; tone: Tone;
  detail?: string; actor?: string; href?: string; external?: boolean;
  // Relation keys such as lesson:ID or ticketKey:XCH-9. Items sharing a key are related.
  refs: string[];
}
export type SourceState = { layer: LayerId; error: string };

const AuditSchema = z.object({ scope: ScopeSchema, events: z.array(z.object({
  id: z.string(), kind: z.string(), actorId: z.string(), at: z.string().datetime(), summary: z.string(),
  lessonId: z.string().nullable(), lessonVersion: z.number().nullable(), consumed: z.array(z.object({ id: z.string(), version: z.number() })).optional(),
})) });
const GitSchema = z.object({ available: z.boolean(), remote: z.string().nullable(), reason: z.string().optional(),
  commits: z.array(z.object({ hash: z.string(), at: z.string().datetime(), author: z.string(), subject: z.string() })) });

const ticketKeys = (text: string) => [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g) ?? [])].map(key => `ticketKey:${key}`);
const time = (iso: string) => Date.parse(iso);
const settle = <T,>(promise: Promise<T>) => promise.then(value => ({ value }), (error: unknown) => ({ error: error instanceof Error ? error.message : "Unavailable" }));

async function activityPages(signal: AbortSignal) {
  const records: ActivityRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const next = ActivityPageSchema.parse(await request(`/v1/activity?limit=100${cursor ? `&cursor=${cursor}` : ""}`, { signal }));
    records.push(...next.records); cursor = next.nextCursor;
    if (!cursor) break;
  }
  return { records, truncated: Boolean(cursor) };
}

export async function loadTimeline(signal: AbortSignal) {
  const [health, lessons, tickets, activity, audit, canvases, harness, git] = await Promise.all([
    request("/health", { signal }).then(value => HealthResponse.parse(value)),
    settle(request("/v1/lessons", { signal }).then(value => LessonsResponse.parse(value))),
    settle(request("/v1/tickets", { signal }).then(value => TicketsResponse.parse(value))),
    settle(activityPages(signal)),
    settle(request("/v1/audit", { signal }).then(value => AuditSchema.parse(value))),
    settle(request("/v1/canvases", { signal }).then(value => CanvasListSchema.parse(value))),
    settle(request("/v1/harness", { signal }).then(value => HarnessStateSchema.parse(value))),
    settle(request("/v1/git", { signal }).then(value => GitSchema.parse(value))),
  ]);
  const scope = [lessons, tickets, audit, canvases].flatMap(source => "value" in source ? [source.value.scope] : [])[0];
  const items: TimelineItem[] = [];
  const failed: SourceState[] = [];
  const fail = (layer: LayerId, source: { error: string } | object) => { if ("error" in source) failed.push({ layer, error: source.error as string }); };
  fail("lessons", lessons); fail("tickets", tickets); fail("activity", activity); fail("memory", audit); fail("canvases", canvases); fail("milestones", harness); fail("git", git);
  const lessonTitles = new Map("value" in lessons ? lessons.value.lessons.map(lesson => [lesson.id, lesson.title]) : []);

  for (const milestone of schedule) items.push({ id: `schedule:${milestone.id}`, layer: "milestones", at: time(milestone.at), end: milestone.end ? time(milestone.end) : undefined,
    title: milestone.title, kind: milestone.end ? "window" : "milestone", tone: milestone.tone, detail: milestone.detail, refs: [] });
  if ("value" in harness) for (const version of harness.value.versions) items.push({
    id: `harness:${version.id}`, layer: "milestones", at: time(version.createdAt), kind: `harness.${version.reason}`, tone: version.reason === "publish" ? "sage" : "red",
    title: `Harness v${version.number}`, actor: version.actorId, refs: [`lesson:${version.lessonId}`],
    detail: `${version.reason === "publish" ? "Added" : "Rolled back"} “${lessonTitles.get(version.lessonId) ?? version.lessonId}”. ${version.lessons.length} active lesson${version.lessons.length === 1 ? "" : "s"}.`,
    href: "/?view=harness" });
  if ("value" in git && git.value.available) for (const commit of git.value.commits) items.push({
    id: `git:${commit.hash}`, layer: "git", at: time(commit.at), kind: "commit", tone: "neutral", title: commit.subject, actor: commit.author,
    detail: `${commit.hash.slice(0, 7)} · ${commit.author}`, refs: ticketKeys(commit.subject),
    href: git.value.remote ? `${git.value.remote}/commit/${commit.hash}` : undefined, external: true });
  else if ("value" in git) failed.push({ layer: "git", error: git.value.reason ?? "Git history is unavailable." });
  if ("value" in tickets) for (const ticket of tickets.value.tickets) items.push({
    id: `ticket:${ticket.id}`, layer: "tickets", at: time(ticket.createdAt), end: ticket.updatedAt > ticket.createdAt ? time(ticket.updatedAt) : undefined,
    kind: ticket.status, tone: "blue", title: `${ticket.key} · ${ticket.summary}`, detail: ticket.description,
    href: `/?item=${encodeURIComponent(`ticket:${ticket.id}`)}`, refs: [`ticket:${ticket.id}`, `ticketKey:${ticket.key}`] });
  if ("value" in lessons) for (const lesson of lessons.value.lessons) items.push({
    id: `lesson:${lesson.id}`, layer: "lessons", at: time(lesson.createdAt), end: lesson.updatedAt > lesson.createdAt ? time(lesson.updatedAt) : undefined,
    kind: lesson.status, tone: lesson.status === "published" ? "sage" : lesson.status === "rejected" ? "red" : "amber", title: lesson.title, actor: lesson.authorId,
    detail: `${lesson.status.replaceAll("_", " ")} · version ${lesson.version}. ${lesson.lesson}`, href: `/?item=${encodeURIComponent(`lesson:${lesson.id}`)}`,
    refs: [`lesson:${lesson.id}`, ...lesson.evidence.flatMap(evidence => ticketKeys(`${evidence.reference} ${evidence.summary}`))] });
  if ("value" in activity) for (const record of activity.value.records) items.push({
    id: `activity:${record.id}`, layer: "activity", at: time(record.recordedAt), kind: record.kind, actor: record.actorLabel,
    tone: record.kind === "outcome" ? "sage" : record.kind === "correction" ? "red" : record.kind === "decision" ? "blue" : "amber",
    title: record.title, detail: record.detail, href: `/?item=${encodeURIComponent(`${record.kind}:${record.id}`)}`,
    refs: [`activity:${record.id}`, `${record.root.kind}:${record.root.id}`, ...(record.subject ? [`${record.subject.kind}:${record.subject.id}`] : []),
      ...record.evidence.flatMap(evidence => ticketKeys(`${evidence.reference} ${evidence.summary}`))] });
  if ("value" in audit) for (const event of audit.value.events.filter(item => item.kind === "memory.consumed")) items.push({
    id: `audit:${event.id}`, layer: "memory", at: time(event.at), kind: "memory read", tone: "amber", actor: event.actorId,
    title: `${event.actorId} loaded ${event.consumed?.length ?? 0} lesson${event.consumed?.length === 1 ? "" : "s"}`, detail: event.summary,
    refs: (event.consumed ?? []).map(lesson => `lesson:${lesson.id}`) });
  if ("value" in canvases) for (const record of canvases.value.canvases) items.push({
    id: `canvas:${record.id}`, layer: "canvases", at: time(record.updatedAt), kind: record.canvas.kind === "guide" ? "guide" : "board",
    tone: record.canvas.kind === "guide" ? "sage" : "neutral", title: record.canvas.title, actor: record.editorLabel,
    detail: `Revision ${record.revision} by ${record.editorLabel}. ${record.canvas.description}`, href: `/?view=canvas&canvas=${record.id}`,
    refs: [`canvas:${record.id}`, ...record.canvas.nodes.flatMap(node => node.kind === "record" ? [`${node.ref.kind}:${node.ref.id}`] : [])] });
  return { health, scope, items: items.filter(item => Number.isFinite(item.at)), failed, truncated: "value" in activity && activity.value.truncated };
}

/** Items related to `item`: they share at least one relation key or refer to it directly. */
export function related(item: TimelineItem, items: TimelineItem[]) {
  const keys = new Set([item.id, ...item.refs]);
  return items.filter(other => other.id !== item.id && (keys.has(other.id) || other.refs.some(key => keys.has(key))));
}

// Time axis: round steps from one minute to a week, aligned to local clock time.
const minute = 60e3, hour = 60 * minute, day = 24 * hour;
const steps = [minute, 2 * minute, 5 * minute, 10 * minute, 15 * minute, 30 * minute, hour, 2 * hour, 3 * hour, 6 * hour, 12 * hour, day, 2 * day, 7 * day];
export const limits = { minSpan: 2 * minute, maxSpan: 60 * day };
const offset = (t: number) => new Date(t).getTimezoneOffset() * minute;
const floorLocal = (t: number, step: number) => { const local = t - offset(t); return local - (((local % step) + step) % step) + offset(t); };
export function ticks(start: number, end: number, width: number) {
  const perPx = (end - start) / Math.max(1, width);
  const step = steps.find(value => value / perPx >= 90) ?? steps[steps.length - 1]!;
  const values: number[] = [];
  for (let t = floorLocal(start, step); t <= end && values.length < 200; t += step) if (t >= start) values.push(t);
  const days: number[] = [];
  for (let t = floorLocal(start, day); t <= end && days.length < 70; t += day) days.push(t);
  return { step, values, days };
}
export function tickLabel(t: number, step: number) {
  const date = new Date(t);
  return step >= day ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function spanLabel(span: number) {
  return span < hour ? `${Math.round(span / minute)} min` : span < 2 * day ? `${Math.round(span / hour * 10) / 10} h` : `${Math.round(span / day * 10) / 10} days`;
}
export const presets = [{ label: "1 h", span: hour }, { label: "6 h", span: 6 * hour }, { label: "Day", span: day }, { label: "Week", span: 7 * day }];
