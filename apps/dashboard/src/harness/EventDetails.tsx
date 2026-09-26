import { useEffect, useRef } from "react";
import { kindTone, type FeedItem } from "./feed.js";

const lessonHref = (id: string) => `/?item=${encodeURIComponent(`lesson:${id}`)}`;
const explain: Record<FeedItem["kind"], string> = {
  "memory.consumed": "A Pi agent fetched shared memory before answering a message, or an operator ran sync-skills. The lessons below were handed to it from this harness version. Retrieval is not proof that a lesson was applied or helped.",
  "harness.updated": "A new immutable harness version added this lesson. Every agent loads the new version on its next message.",
  "harness.rollback": "A new harness version removed this lesson from what agents load. The lesson keeps its record and its evaluation.",
  "lesson.proposed": "A candidate lesson was submitted. Agents do not load a candidate until it passes the gate or is shared directly.",
  "lesson.evaluated": "The fixed-suite gate scored the candidate against the baseline. The summary carries the decision and both scores.",
  "lesson.published": "The lesson became published: through the evaluation gate, or shared directly by an agent without evaluation.",
  "lesson.rejected": "The gate rejected the candidate. It stays in the catalog for reference and is never loaded by agents.",
};

export function EventDetails({ item, lessons, onClose }: { item: FeedItem; lessons: Map<string, { title: string; lesson: string }>; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [item.id]);
  const event = item.event;
  const title = (id: string) => lessons.get(id)?.title ?? id;
  return <aside className="item-details" aria-label={`${item.type} details`} onKeyDown={keyboard => { if (keyboard.key === "Escape") onClose(); }}>
    <div className="detail-heading"><span className="eyebrow">Harness event · {item.type}</span><button className="icon-button" aria-label="Close details" onClick={onClose}>×</button></div>
    <h1 ref={heading} tabIndex={-1}>{item.summary}</h1>
    <div className="detail-tags"><span className={`status status-${kindTone(item.kind)}`}>{item.type}</span>{item.harness && <span className="tag">Harness {item.harness}</span>}<span className="tag">{item.actor}</span></div>
    <p className="muted">{new Date(item.at).toLocaleString()} · actor: {item.actor}</p>
    <section><h2>What happened</h2><p className="record-prose">{explain[item.kind]}</p></section>
    {event.lessonId && <section><h2>Lesson</h2>
      <p><a href={lessonHref(event.lessonId)}>{title(event.lessonId)}</a>{event.lessonVersion ? <span className="muted"> · v{event.lessonVersion}</span> : null}</p>
      {lessons.has(event.lessonId) && <p className="record-prose">{lessons.get(event.lessonId)!.lesson}</p>}
    </section>}
    {event.consumed && <section><h2>Lessons loaded ({event.consumed.length})</h2>
      {event.consumed.length ? <ul>{event.consumed.map(ref => <li key={`${ref.id}:${ref.version}`}><a href={lessonHref(ref.id)}>{title(ref.id)}</a> <span className="muted">v{ref.version}</span></li>)}</ul>
        : <p className="muted">No published lesson was active, so the agent received empty team memory.</p>}
    </section>}
    <details className="record-info"><summary>Record information</summary><dl>
      <dt>ID</dt><dd>{event.id}</dd><dt>Kind</dt><dd>{event.kind}</dd><dt>Project</dt><dd>{event.projectId}</dd><dt>Team</dt><dd>{event.teamId}</dd><dt>At</dt><dd>{event.at}</dd>
    </dl><p>Stored in the audit_events collection. Inspecting it here records nothing.</p></details>
  </aside>;
}
