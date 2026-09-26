import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { EVALUATOR_VERSION, loadSuite } from "./compare.js";

export { EVALUATOR_VERSION, compareLesson, loadSuite } from "./compare.js";

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const suite = loadSuite();
  const caseIds = suite.cases.map((item) => item.id).join(", ");
  console.info(`Evaluator ${EVALUATOR_VERSION}: suite ${suite.suiteVersion}, ${suite.cases.length} held-out cases (${caseIds}).`);
  console.info("No model calls or promotions. Publish through POST /v1/lessons/:id/evaluate.");
}
