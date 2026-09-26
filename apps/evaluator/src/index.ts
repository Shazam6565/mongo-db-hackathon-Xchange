import type { EvaluationResult, Lesson } from "@team-memory/contracts";

export interface EvaluationRunner {
  compare(lesson: Lesson, suiteVersion: string): Promise<EvaluationResult>;
}

// Implement fixed baseline/candidate runs on held-out tickets in an isolated workspace.
// The candidate must not edit this runner, fixtures, expected outputs, or scoring.
// Persist evidence and scores before an atomic, version-checked promotion.
console.info("Evaluator scaffold only: no model calls, scores, or promotions are performed.");
console.info("Next: implement EvaluationRunner.compare using evals/triage-suite.json.");
