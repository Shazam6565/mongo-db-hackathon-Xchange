import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Lesson } from "@team-memory/contracts";
import "./styles.css";

function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState("unknown");

  async function refresh() {
    setLoading(true);
    try {
      const [health, response] = await Promise.all([fetch("/api/health"), fetch("/api/v1/lessons")]);
      if (!health.ok || !response.ok) throw new Error("Start the API with npm run dev:api, then refresh.");
      setStorage((await health.json()).storage);
      setLessons((await response.json()).lessons);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reach the API.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  return <main>
    <header><span className="wordmark">TEAM MEMORY <span>/ LAB</span></span><span className="tag">Hackathon starter</span></header>
    <section className="intro">
      <div><p className="eyebrow">SHARED LEARNING FOR ENGINEERING AGENTS</p><h1>One agent learns.<br />The team moves forward.</h1>
        <p className="lede">A workspace for lessons, supporting evidence, and the changes they could make to your agents.</p></div>
      <aside><span className="status-dot" /> {storage === "memory" ? "Local demo storage" : storage === "mongodb" ? "MongoDB storage" : "Connecting to API"}<p>Evaluation, automatic publishing, and live sync are planned. Sample lessons are explicitly labeled.</p></aside>
    </section>
    <section className="pipeline" aria-label="Proposed learning pipeline">
      {[["01", "Capture a lesson"], ["02", "Test the change"], ["03", "Publish a version"], ["04", "Share with the team"]].map(([number, label]) =>
        <div key={number}><span>{number}</span><strong>{label}</strong></div>)}
    </section>
    <section className="library">
      <div className="section-top"><div><p className="eyebrow">MEMORY LIBRARY</p><h2>Lessons with a paper trail</h2></div><button onClick={() => void refresh()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div>
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !error && lessons.length === 0 && <p>No lessons yet. Submit a candidate from Pi using <code>/share-lesson</code>.</p>}
      <div className="cards">{lessons.map((lesson) => <article key={lesson.id}>
        <div className="card-top"><span className="badge">{lesson.status}</span><span>v{lesson.version} · {lesson.authorId}</span></div>
        <h3>{lesson.title}</h3><p>{lesson.lesson}</p>
        {lesson.origin === "demo" && <p className="demo-note">Sample data — validation has not run.</p>}
        <div className="chips">{lesson.appliesTo.map((component) => <span key={component}>{component}</span>)}</div>
        <details><summary>Evidence & proposed change</summary>
          <ul>{lesson.evidence.map((e, index) => <li key={index}><strong>{e.reference}</strong> · {e.summary}</li>)}</ul>
          <p><strong>Verification steps</strong></p><ul>{lesson.proposedChange.verificationSteps.map((step) => <li key={step}>{step}</li>)}</ul>
        </details>
      </article>)}</div>
    </section>
    <footer>Pi extension · TypeScript · MongoDB Atlas <span>Candidate → evaluate → publish → retrieve</span></footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
