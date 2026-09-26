import { useEffect, useRef, useState } from "react";
import { ActivityPageSchema, activityLink, type ActivityPage, type ActivityRecord, type ActivityRoot } from "../../../../packages/contracts/src/activity.js";
import { errorMessage, request } from "../catalog/api.js";
import { label } from "../catalog/model.js";
import "./activity.css";

export function OutcomeEvidence({ record }: { record: ActivityRecord }) {
  if (!record.outcome) return null;
  return <div className="outcome-evidence"><strong>Reported: {label(record.outcome.assessment)}</strong><p className="record-prose">{record.outcome.comparison}</p>
    {record.outcome.metrics.length > 0 && <div className="effect-table"><table><caption>Recorded measurements; a difference does not establish cause.</caption><thead><tr><th>Measure</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>{record.outcome.metrics.map((metric, index) => <tr key={index}><td>{metric.name} ({metric.unit})</td><td>{metric.before}</td><td>{metric.after}</td><td>{Number((metric.after - metric.before).toPrecision(8))}</td></tr>)}</tbody></table></div>}
  </div>;
}
export function ActivityHistory({ root, revision = 0 }: { root: ActivityRoot; revision?: number }) {
  const [data, setData] = useState<ActivityPage>(), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  async function load(cursor?: string) {
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ rootKind: root.kind, rootId: root.id, limit: "30", ...(cursor ? { cursor } : {}) });
      const page = ActivityPageSchema.parse(await request(`/v1/activity?${query}`, { signal: active.signal }));
      if (!active.signal.aborted) setData(previous => ({ ...page, records: cursor ? [...previous?.records ?? [], ...page.records] : page.records }));
    } catch (failure) { if (!active.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!active.signal.aborted) setLoading(false); }
  }
  useEffect(() => { setData(undefined); void load(); return () => controller.current?.abort(); }, [root.kind, root.id, revision]);
  const records = data?.records ?? [];
  const corrected = new Set(records.filter(record => record.correctedBy.length > 0).map(record => record.id));
  const outcomes = records.filter(record => record.kind === "outcome" && !corrected.has(record.id));
  return <section className="activity-history"><h2>History and effects</h2>
    <p className="muted">{records.filter(record => record.kind === "application").length} applications · {outcomes.length} outcomes without corrections in loaded history. Reports are not proof of causation.</p>
    <a href={`/?${new URLSearchParams({ view: "timeline", rootKind: root.kind, rootId: root.id })}`}>Open this history in Timeline</a>
    {error ? <p role="alert">{error} <button onClick={() => void load()}>Retry</button></p> : <ol className="activity-history-list">{records.map(record => <li key={record.id}><div className="history-meta"><span>{label(record.kind)}{corrected.has(record.id) ? " · correction recorded" : ""}</span><time dateTime={record.recordedAt}>{new Date(record.recordedAt).toLocaleString()}</time></div><a href={activityLink(record)}>{record.title}</a><p className="record-prose">{record.detail}</p>{!corrected.has(record.id) && <OutcomeEvidence record={record} />}</li>)}</ol>}
    {!error && !loading && records.length === 0 && <p className="muted">No applications or outcomes recorded yet.</p>}
    {loading && <p role="status">Loading history…</p>}
    {data?.nextCursor && !error && <button disabled={loading} onClick={() => void load(data.nextCursor!)}>Load earlier history</button>}
  </section>;
}
