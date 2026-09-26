import { useEffect, useRef, useState } from "react";
import type { ActivityInput, ActivityRecord } from "../../../../packages/contracts/src/activity.js";
import { label } from "../catalog/model.js";
import { AddActivity } from "./AddActivity.js";
import { ActivityHistory, OutcomeEvidence } from "./ActivityHistory.js";

export function ActivityDetails({ record, onClose, onSaved }: { record: ActivityRecord; onClose: () => void; onSaved: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState<ActivityInput["kind"]>(), [revision, setRevision] = useState(0);
  useEffect(() => { setAdding(undefined); heading.current?.focus(); }, [record.id]);
  return <aside className="item-details" aria-label={`${label(record.kind)} details`} onKeyDown={event => { if (event.key === "Escape" && !adding) onClose(); }}>
    <div className="detail-heading"><span className="eyebrow">{label(record.kind)} · recorded</span><button aria-label="Close details" onClick={onClose}>×</button></div>
    <h1 ref={heading} tabIndex={-1}>{record.title}</h1><p className="record-prose">{record.detail}</p>
    {record.correctedBy.length > 0 && <p className="sample-note">A correction is recorded. Inspect the linked history before relying on this report.</p>}
    <p className="muted">Recorded {new Date(record.recordedAt).toLocaleString()} · label: {record.actorLabel}</p>
    {record.runId && <p>Task / run: {record.runId}</p>}
    {record.subject && <p className="muted">Follows {record.subject.kind} {record.subject.id}{record.subject.kind === "lesson" ? ` · v${record.subject.version}` : ""}</p>}
    <OutcomeEvidence record={record} />
    <div className="activity-actions">
      {["observation", "decision"].includes(record.kind) && <button onClick={() => setAdding("application")}>Record application</button>}
      {record.kind === "application" && <button onClick={() => setAdding("outcome")}>Record outcome</button>}
      <button onClick={() => setAdding("correction")}>Add correction</button>
    </div>
    <section><h2>Evidence</h2>{record.evidence.map((item, index) => <div className="evidence" key={index}><strong>{item.reference}</strong><p className="record-prose">{item.summary}</p></div>)}</section>
    <ActivityHistory root={record.root} revision={revision} />
    <details className="record-info"><summary>Record information</summary><dl><dt>ID</dt><dd>{record.id}</dd><dt>Project</dt><dd>{record.projectId}</dd><dt>Team</dt><dd>{record.teamId}</dd></dl><p>This is an attributed report. It does not grant permissions, publish memory, or verify its own evidence. Corrections append to the history.</p></details>
    {adding && <AddActivity key={`${record.id}:${adding}`} subject={{ kind: "activity", id: record.id }} defaultKind={adding} runId={adding === "outcome" ? record.runId : undefined}
      onClose={() => { setAdding(undefined); heading.current?.focus(); }} onSaved={() => { setAdding(undefined); setRevision(value => value + 1); onSaved(); heading.current?.focus(); }} />}
  </aside>;
}
