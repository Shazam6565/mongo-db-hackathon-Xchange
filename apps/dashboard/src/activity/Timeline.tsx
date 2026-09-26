import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ActivityKindSchema, ActivityPageSchema, activityLink, type ActivityPage } from "../../../../packages/contracts/src/activity.js";
import { ScopeSchema } from "@team-memory/contracts";
import { AppFrame } from "../AppFrame.js";
import { errorMessage, HealthResponse, request } from "../catalog/api.js";
import { label } from "../catalog/model.js";
import { AddActivity } from "./AddActivity.js";
import { OutcomeEvidence } from "./ActivityHistory.js";
import { canWrite, useSession } from "../auth/SessionContext.js";
import "../catalog/catalog.css";
import "./activity.css";

const AuditSchema = z.object({ scope: ScopeSchema, events: z.array(z.object({
  id: z.string(), kind: z.string(), actorId: z.string(), at: z.string().datetime(), summary: z.string(),
  lessonId: z.string().nullable(), lessonVersion: z.number().nullable(),
  consumed: z.array(z.object({ id: z.string(), version: z.number() })).optional(),
})) });
type Audit = z.infer<typeof AuditSchema>;
function dateFilter(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}
export function Timeline() {
  const session = useSession();
  const initial = new URLSearchParams(window.location.search);
  const [source, setSource] = useState(initial.get("source") === "memory" ? "memory" : "records");
  const [kind, setKind] = useState(ActivityKindSchema.safeParse(initial.get("kind")).success ? initial.get("kind")! : "");
  const [since, setSince] = useState(dateFilter(initial.get("since"))), [until, setUntil] = useState(dateFilter(initial.get("until")));
  const rootKind = initial.get("rootKind"), rootId = initial.get("rootId");
  const [page, setPage] = useState<ActivityPage>(), [audit, setAudit] = useState<Audit>();
  const [health, setHealth] = useState<z.infer<typeof HealthResponse>>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [adding, setAdding] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  async function load(cursor?: string) {
    activeRequest.current?.abort(); const active = new AbortController(); activeRequest.current = active;
    setLoading(true); setError("");
    try {
      if (since && until && since > until) throw new Error("Choose a start date on or before the end date.");
      const params = new URLSearchParams({ limit: "50", ...(kind ? { kind } : {}), ...(cursor ? { cursor } : {}) });
      if (rootId && rootKind) { params.set("rootKind", rootKind); params.set("rootId", rootId); }
      if (since) params.set("since", new Date(`${since}T00:00:00`).toISOString());
      if (until) params.set("until", new Date(`${until}T23:59:59.999`).toISOString());
      const [nextHealth, data] = await Promise.all([
        request("/health", { signal: active.signal }).then(value => HealthResponse.parse(value)),
        request(source === "memory" ? "/v1/audit" : `/v1/activity?${params}`, { signal: active.signal }),
      ]);
      if (active.signal.aborted) return;
      setHealth(nextHealth);
      if (source === "memory") setAudit(AuditSchema.parse(data));
      else {
        const next = ActivityPageSchema.parse(data);
        setPage(previous => ({ ...next, records: cursor ? [...previous?.records ?? [], ...next.records] : next.records }));
      }
    } catch (failure) { if (!active.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!active.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    setPage(undefined); setAudit(undefined);
    const params = new URLSearchParams({ view: "timeline" });
    if (source === "memory") params.set("source", source);
    if (kind) params.set("kind", kind);
    if (since) params.set("since", since); if (until) params.set("until", until);
    if (rootId && rootKind) { params.set("rootKind", rootKind); params.set("rootId", rootId); }
    window.history.replaceState(null, "", `/?${params}`);
    void load(); return () => activeRequest.current?.abort();
  }, [source, kind, since, until, rootId, rootKind]);
  const scope = source === "memory" ? audit?.scope : page?.scope;
  const records = page?.records ?? [];
  const corrected = new Set(records.filter(record => record.correctedBy.length > 0).map(record => record.id));
  const events = (audit?.events ?? []).filter(event => (!since || event.at >= new Date(`${since}T00:00:00`).toISOString())
    && (!until || event.at <= new Date(`${until}T23:59:59.999`).toISOString())
    && (!rootId || (rootKind === "lesson" && (event.lessonId === rootId || event.consumed?.some(item => item.id === rootId)))))
    .sort((a,b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return <div className="catalog-app"><a className="skip-link" href="#timeline-content">Skip to timeline</a>
    <AppFrame active="Timeline" data={health && scope ? { ...health, scope } : undefined} error={Boolean(error)} />
    <main id="timeline-content" className="catalog-main" tabIndex={-1}>
      <div className="timeline-toolbar">
        <label>Show <select value={source} onChange={event => setSource(event.target.value)}><option value="records">Decisions and effects</option><option value="memory">Memory lifecycle</option></select></label>
        {source === "records" && <label>Type <select value={kind} onChange={event => setKind(event.target.value)}><option value="">All types</option>{ActivityKindSchema.options.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>}
        <label>From <input type="date" value={since} onChange={event => setSince(event.target.value)} /></label>
        <label>Through <input type="date" value={until} onChange={event => setUntil(event.target.value)} /></label>
        <button disabled={loading} onClick={() => void load()}>Refresh</button><span className="toolbar-spacer" />
        {canWrite(session) && <button ref={addButton} className="primary" onClick={() => setAdding(true)}>New record</button>}
      </div>
      <div className="timeline-content">
        {rootId && <p className="timeline-caption">History for {rootKind} {rootId} · <a href="/?view=timeline">Show all records</a></p>}
        <p className="timeline-caption">{source === "records" ? <>Recorded chronology. Applications describe changed actions; outcomes retain comparisons and uncertainty. {session.mode === "team" ? "New team records use authenticated member IDs; earlier local records may retain self-reported labels." : "Local reporter labels are self-reported, not authenticated identities."}</> : "Latest 100 lifecycle events. A retrieval means context was fetched, not used or proven helpful. Date filters apply to this recent window."}</p>
        {error ? <p role="alert" className="error-message">{error} <button onClick={() => void load()}>Retry</button></p> : source === "records" ? <ol className="timeline-list">{records.map(record => <li key={record.id}>
          <time dateTime={record.recordedAt}>{new Date(record.recordedAt).toLocaleString()}</time><div className="timeline-entry">
            <div className="history-meta"><span>{label(record.kind)}{corrected.has(record.id) ? " · correction recorded" : ""}</span><span>Label: {record.actorLabel}</span>{record.runId && <span>Task/run: {record.runId}</span>}</div>
            <a href={activityLink(record)}>{record.title}</a><p className="record-prose">{record.detail}</p><OutcomeEvidence record={record} />
            <details><summary>Evidence and links</summary>{record.evidence.map((item, index) => <p key={index}><strong>{item.reference}</strong> — {item.summary}</p>)}<a href={`/?${new URLSearchParams({ view: "timeline", rootKind: record.root.kind, rootId: record.root.id })}`}>Follow this record’s history</a></details>
          </div></li>)}</ol> : <ol className="timeline-list">{events.map(event => <li key={event.id}><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time><div className="timeline-entry"><div className="history-meta"><span>{event.kind === "memory.consumed" ? "Memory retrieved" : event.kind.replaceAll(".", " ")}</span><span>Label: {event.actorId}</span></div><p className="record-prose">{event.summary}</p>{event.lessonId && <a href={`/?item=${encodeURIComponent(`lesson:${event.lessonId}`)}`}>Inspect lesson{event.lessonVersion ? ` · v${event.lessonVersion}` : ""}</a>}{event.consumed?.map(lesson => <p key={`${lesson.id}:${lesson.version}`}><a href={`/?item=${encodeURIComponent(`lesson:${lesson.id}`)}`}>{lesson.id} · v{lesson.version}</a></p>)}</div></li>)}</ol>}
        {loading && <p role="status">Loading timeline…</p>}
        {!loading && !error && !(source === "records" ? records.length : events.length) && <p className="muted">No recorded activity in this view. Add a decision or observation to begin its history.</p>}
        {!error && source === "records" && page?.nextCursor && <button disabled={loading} onClick={() => void load(page.nextCursor!)}>Load earlier records</button>}
      </div>
    </main>
    {adding && <AddActivity onClose={() => { setAdding(false); addButton.current?.focus(); }} onSaved={() => { setAdding(false); addButton.current?.focus(); void load(); }} />}
  </div>;
}
