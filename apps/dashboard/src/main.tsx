import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EvaluationResult, Lesson } from "@team-memory/contracts";
import "./styles.css";

function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationResult[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState("unknown");
  const [pendingId, setPendingId] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [health, response, scored] = await Promise.all([
        fetch("/api/health"), fetch("/api/v1/lessons"), fetch("/api/v1/evaluations"),
      ]);
      if (!health.ok || !response.ok || !scored.ok) throw new Error("Start the API with npm run dev:api, then refresh.");
      setStorage((await health.json()).storage);
      setLessons((await response.json()).lessons);
      setEvaluations((await scored.json()).evaluations);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reach the API.");
    } finally { setLoading(false); }
  }

  async function evaluate(lesson: Lesson) {
    setPendingId(lesson.id);
    try {
      const response = await fetch(`/api/v1/lessons/${encodeURIComponent(lesson.id)}/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: lesson.version }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "Evaluation failed.");
      }
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Evaluation failed.");
    } finally { setPendingId(""); }
  }
  useEffect(() => { void refresh(); }, []);
  const latestEvaluation = new Map<string, EvaluationResult>();
  for (const evaluation of evaluations) {
    if (!latestEvaluation.has(evaluation.lessonId)) latestEvaluation.set(evaluation.lessonId, evaluation);
  }

  return <main>
    <header><span className="wordmark">TEAM MEMORY <span>/ LAB</span></span><span className="tag">Hackathon starter</span></header>
    <section className="intro">
      <div><p className="eyebrow">SHARED LEARNING FOR ENGINEERING AGENTS</p><h1>One agent learns.<br />The team moves forward.</h1>
        <p className="lede">A workspace for lessons, supporting evidence, and the changes they could make to your agents.</p></div>
      <aside><span className="status-dot" /> {storage === "memory" ? "Local demo storage" : storage === "mongodb" ? "MongoDB storage" : "Connecting to API"}<p>A candidate publishes when the fixed suite passes its version check. Live model trials and sync are still planned. Sample lessons are labeled.</p></aside>
    </section>
    <section className="pipeline" aria-label="Proposed learning pipeline">
      {[["01", "Capture a lesson"], ["02", "Test the change"], ["03", "Publish a version"], ["04", "Share with the team"]].map(([number, label]) =>
        <div key={number}><span>{number}</span><strong>{label}</strong></div>)}
    </section>
    <section className="library">
      <div className="section-top"><div><p className="eyebrow">MEMORY LIBRARY</p><h2>Lessons with a paper trail</h2></div><button onClick={() => void refresh()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div>
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !error && lessons.length === 0 && <p>No lessons yet. Submit a candidate from Pi using <code>/share-lesson</code>.</p>}
      <div className="cards">{lessons.map((lesson) => {
        const evaluation = latestEvaluation.get(lesson.id);
        return <article key={lesson.id}>
        <div className="card-top"><span className="badge">{lesson.status}</span><span>v{lesson.version} · {lesson.authorId}</span></div>
        <h3>{lesson.title}</h3><p>{lesson.lesson}</p>
        {lesson.origin === "demo" && <p className="demo-note">Sample data — validation has not run.</p>}
        {evaluation && <p className="eval-note">{evaluation.decision} · candidate {evaluation.candidateScore} · baseline {evaluation.baselineScore}{evaluation.regressions.length ? ` · ${evaluation.regressions.join("; ")}` : ""}</p>}
        {lesson.status === "candidate" && <button className="slim" type="button" disabled={pendingId === lesson.id} onClick={() => void evaluate(lesson)}>{pendingId === lesson.id ? "Evaluating…" : "Evaluate"}</button>}
        <div className="chips">{lesson.appliesTo.map((component) => <span key={component}>{component}</span>)}</div>
        <details><summary>Evidence & proposed change</summary>
          <ul>{lesson.evidence.map((e, index) => <li key={index}><strong>{e.reference}</strong> · {e.summary}</li>)}</ul>
          <p><strong>Verification steps</strong></p><ul>{lesson.proposedChange.verificationSteps.map((step) => <li key={step}>{step}</li>)}</ul>
        </details>
      </article>; })}</div>
    </section>
    <footer>Pi extension · TypeScript · MongoDB Atlas <span>Candidate → evaluate → publish → retrieve</span></footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
