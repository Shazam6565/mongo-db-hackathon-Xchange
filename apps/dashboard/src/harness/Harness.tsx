import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { Lesson } from "@team-memory/contracts";
import { HarnessStateSchema, type HarnessState, type HarnessVersionRecord } from "../../../../packages/contracts/src/harness.js";
import { AppFrame } from "../AppFrame.js";
import { errorMessage, HealthResponse, LessonsResponse, request } from "../catalog/api.js";
import { canEvaluate, useSession } from "../auth/SessionContext.js";
import "../catalog/catalog.css";
import "../activity/activity.css";

const lessonLink = (id: string) => `/?item=${encodeURIComponent(`lesson:${id}`)}`;

export function Harness() {
  const session = useSession();
  // Mirrors the API: rollback is evaluator-only on the hosted API; the local owner may roll back.
  const canRollback = canEvaluate(session);
  const [state, setState] = useState<HarnessState>(), [lessons, setLessons] = useState<Map<string, Lesson>>(new Map());
  const [health, setHealth] = useState<z.infer<typeof HealthResponse>>();
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(""), [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  async function load() {
    activeRequest.current?.abort(); const active = new AbortController(); activeRequest.current = active;
    setLoading(true); setError("");
    try {
      const [nextHealth, harness, catalog] = await Promise.all([
        request("/health", { signal: active.signal }).then(value => HealthResponse.parse(value)),
        request("/v1/harness", { signal: active.signal }).then(value => HarnessStateSchema.parse(value)),
        request("/v1/lessons", { signal: active.signal }).then(value => LessonsResponse.parse(value)),
      ]);
      if (active.signal.aborted) return;
      setHealth(nextHealth); setState(harness); setLessons(new Map(catalog.lessons.map(lesson => [lesson.id, lesson])));
    } catch (failure) { if (!active.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!active.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    window.history.replaceState(null, "", "/?view=harness");
    void load(); return () => activeRequest.current?.abort();
  }, []);

  async function rollback(lessonId: string) {
    if (!state) return;
    const title = lessons.get(lessonId)?.title ?? lessonId;
    if (!window.confirm(`Roll back “${title}”? Agents stop receiving it from harness v${state.version + 1}. The lesson keeps its evaluation.`)) return;
    setPending(lessonId); setError("");
    try {
      await request("/v1/harness/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: state.version, lessonId }) });
      await load();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(""); }
  }

  const describe = (version: HarnessVersionRecord) =>
    `${version.reason === "publish" ? "Added" : "Rolled back"} ${lessons.get(version.lessonId)?.title ?? version.lessonId}`;
  return <div className="catalog-app"><a className="skip-link" href="#harness-content">Skip to harness</a>
    <AppFrame active="Harness" data={health && state ? { ...health, scope: state.scope } : undefined} error={Boolean(error)} />
    <main id="harness-content" className="catalog-main" tabIndex={-1}>
      <div className="timeline-toolbar"><button disabled={loading} onClick={() => void load()}>Refresh</button><span className="toolbar-spacer" /></div>
      <div className="timeline-content">
        <p className="timeline-caption">Agents load the active harness version: Pi injects it as context and <code>client.mjs sync-skills</code> installs it as skills. Publishing through the gate adds a lesson; rollback removes it without changing its evaluation. Version 0 means no change has been recorded yet, so every published lesson is active.</p>
        {error && <p role="alert" className="error-message">{error} <button onClick={() => void load()}>Retry</button></p>}
        {state && <>
          <h2>Active · v{state.version}</h2>
          {state.lessons.length ? <ol className="timeline-list">{state.lessons.map(ref => {
            const lesson = lessons.get(ref.id);
            return <li key={ref.id}>{lesson ? <time dateTime={lesson.updatedAt} title="Published">{new Date(lesson.updatedAt).toLocaleString()}</time> : <span />}<div className="timeline-entry">
              <div className="history-meta"><span>Lesson v{ref.version}</span>{lesson && <span>Author: {lesson.authorId}</span>}{lesson && <span>Applies to: {lesson.appliesTo.join(", ") || "project-wide"}</span>}</div>
              <a href={lessonLink(ref.id)}>{lesson?.title ?? ref.id}</a>
              {lesson && <p className="record-prose">{lesson.lesson}</p>}
              {canRollback && <button disabled={Boolean(pending)} onClick={() => void rollback(ref.id)}>{pending === ref.id ? "Rolling back…" : "Roll back"}</button>}
            </div></li>;
          })}</ol> : <p className="muted">No lessons are active. Agents receive empty team memory until a candidate passes the gate.</p>}
          <h2>History</h2>
          {state.versions.length ? <ol className="timeline-list">{state.versions.map(version => <li key={version.id}>
            <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time><div className="timeline-entry">
              <div className="history-meta"><span>v{version.number}</span><span>By: {version.actorId}</span><span>{version.lessons.length} active</span></div>
              <a href={lessonLink(version.lessonId)}>{describe(version)}</a>
            </div></li>)}</ol> : <p className="muted">No harness changes recorded yet.</p>}
        </>}
        {loading && <p role="status">Loading harness…</p>}
      </div>
    </main>
  </div>;
}
