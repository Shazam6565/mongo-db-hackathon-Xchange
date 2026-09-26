import { useEffect, useState } from "react";
import type { EvaluationResult, Lesson } from "@team-memory/contracts";
import { errorMessage, request } from "./api.js";

export function Evaluation({ lesson, onEvaluated }: { lesson: Lesson; onEvaluated: () => void }) {
  const [evaluation, setEvaluation] = useState<EvaluationResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request("/v1/evaluations", { signal: controller.signal }).then((body: { evaluations: EvaluationResult[] }) => {
      if (!controller.signal.aborted) setEvaluation(body.evaluations.find(result => result.lessonId === lesson.id && result.candidateVersion === lesson.version));
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [lesson.id, lesson.version]);
  async function evaluate() {
    setPending(true); setError("");
    try {
      const result = await request(`/v1/lessons/${encodeURIComponent(lesson.id)}/evaluate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: lesson.version }),
      });
      setEvaluation(result.evaluation); onEvaluated();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  }
  return <section><h2>Evaluation</h2>
    {evaluation ? <><p>{evaluation.decision} · candidate {evaluation.candidateScore} · baseline {evaluation.baselineScore}</p>
      <p className="muted">{evaluation.suiteVersion} · {evaluation.evaluatorVersion}</p>
      {evaluation.regressions.length > 0 && <ul>{evaluation.regressions.map((item, index) => <li key={index}>{item}</li>)}</ul>}</> : <p className="muted">No evaluation recorded in the recent results.</p>}
    {lesson.status === "candidate" && <><p className="muted">Run the fixed suite. Passing candidates publish automatically.</p><button onClick={() => void evaluate()} disabled={pending}>{pending ? "Evaluating…" : "Evaluate"}</button></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
