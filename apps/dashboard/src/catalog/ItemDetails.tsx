import { useEffect, useRef, useState } from "react";
import { ActivityDetails } from "../activity/ActivityDetails.js";
import { ActivityHistory } from "../activity/ActivityHistory.js";
import { AddActivity } from "../activity/AddActivity.js";
import { canWrite, useSession } from "../auth/SessionContext.js";
import { Evaluation } from "./Evaluation.js";
import { label, type CatalogItem } from "./model.js";

export function ItemDetails({ item, onClose, onEvaluated }: { item: CatalogItem; onClose: () => void; onEvaluated: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const writable = canWrite(useSession());
  const [applying, setApplying] = useState(false), [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => { setApplying(false); heading.current?.focus(); }, [item.id, item.kind]);
  const source = item.record;
  if (source.kind === "activity") return <ActivityDetails record={source.value} onClose={onClose} onSaved={onEvaluated} />;
  return <aside className="item-details" aria-label={`${label(item.kind)} details`} onKeyDown={event => { if (event.key === "Escape" && !applying) onClose(); }}>
    <div className="detail-heading"><span className="eyebrow">{label(item.kind)} · {item.reference}</span><button className="icon-button" aria-label="Close details" onClick={onClose}>×</button></div>
    <h1 ref={heading} tabIndex={-1}>{item.title}</h1>
    <div className="detail-tags"><span className={`status status-${item.status}`}>{label(item.status)}</span>{item.appliesTo.map(value => <span className="tag" key={value}>{value}</span>)}</div>
    {source.kind === "lesson" && source.value.origin === "demo" && <p className="sample-note">Sample lesson · validation has not run.</p>}
    <section><h2>{item.kind === "lesson" ? "Lesson" : "Description"}</h2><p className="record-prose">{item.description || "No description yet."}</p></section>
    {source.kind === "lesson" ? <>
      <Evaluation key={item.id} lesson={source.value} onEvaluated={onEvaluated} />
      {source.value.status === "published" && writable && <div className="activity-actions"><button onClick={() => setApplying(true)}>Record application</button></div>}
      <ActivityHistory root={{ kind: "lesson", id: item.id }} revision={historyRevision} />
      <section><h2>Evidence</h2>{source.value.evidence.map((evidence, index) => <div className="evidence" key={index}>
        <div><span className="muted">{label(evidence.kind)}</span> <strong>{evidence.reference}</strong></div><p className="record-prose">{evidence.summary}</p>
      </div>)}</section>
      <section><h2>Proposed instructions</h2><TextList values={source.value.proposedChange.instructions} empty="No instructions proposed." /></section>
      <section><h2>Verification steps</h2><TextList values={source.value.proposedChange.verificationSteps} empty="No verification steps recorded." /></section>
      {source.value.proposedChange.suggestedTools.length > 0 && <section><h2>Suggested tools</h2><div className="detail-tags">{source.value.proposedChange.suggestedTools.map(tool => <span className="tag" key={tool}>{tool}</span>)}</div></section>}
    </> : source.value.acceptanceCriteria.length > 0 && <section><h2>Acceptance criteria</h2><TextList values={source.value.acceptanceCriteria} empty="" /></section>}
    <details className="record-info"><summary>Record information</summary><dl>
      <dt>ID</dt><dd>{item.id}</dd><dt>Project</dt><dd>{source.value.projectId}</dd><dt>Team</dt><dd>{source.value.teamId}</dd>
      {source.kind === "lesson" && <><dt>Author</dt><dd>{source.value.authorId}</dd><dt>Version</dt><dd>{source.value.version}</dd><dt>Origin</dt><dd>{source.value.origin}</dd></>}
      <dt>Created</dt><dd>{new Date(source.value.createdAt).toLocaleString()}</dd><dt>Updated</dt><dd>{new Date(source.value.updatedAt).toLocaleString()}</dd>
    </dl></details>
    {applying && source.kind === "lesson" && <AddActivity subject={{ kind: "lesson", id: item.id, version: source.value.version }} defaultKind="application"
      onClose={() => { setApplying(false); heading.current?.focus(); }} onSaved={() => { setApplying(false); setHistoryRevision(value => value + 1); onEvaluated(); heading.current?.focus(); }} />}
  </aside>;
}
function TextList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? <ul>{values.map((value, index) => <li className="record-prose" key={index}>{value}</li>)}</ul> : <p className="muted">{empty}</p>;
}
