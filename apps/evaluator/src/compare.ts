import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EvaluationCaseResult, EvaluationScores, Lesson } from "@team-memory/contracts";

export const EVALUATOR_VERSION = "triage-gate-v1";

const SuiteCaseSchema = z.object({
  id: z.string().min(1),
  ticket: z.object({
    key: z.string().min(1),
    summary: z.string(),
    description: z.string(),
  }),
  expectedComponent: z.string().min(1),
  requiredChecks: z.array(z.string().min(1)).min(1),
});

const SuiteSchema = z.object({
  suiteVersion: z.string().min(1),
  description: z.string(),
  metrics: z.array(z.string()),
  cases: z.array(SuiteCaseSchema).min(1),
});

export type TriageSuite = z.infer<typeof SuiteSchema>;
type SuiteCase = z.infer<typeof SuiteCaseSchema>;
type Ticket = SuiteCase["ticket"];

export type LessonProposal = Pick<Lesson, "lesson" | "appliesTo" | "proposedChange">;

const COMPONENT_TOKENS: Record<string, string> = {
  "event-sdk": "event-platform",
  "event-platform": "event-platform",
  "event-consumer": "event-platform",
  notifications: "event-platform",
  "activity-feed": "event-platform",
  frontend: "frontend",
  ui: "frontend",
  rendering: "frontend",
};

const BROAD_TOKENS = new Set([
  "*", "all", "any", "everything", "every", "duplicates", "duplicate", "duplicate-ui", "duplicate-effects",
]);

const TICKET_SIGNALS: Array<[string, RegExp]> = [
  ["event-platform", /\bevent consumer\b|\bsame event id\b|\bevent id\b|\bretry\b|\bredelivery\b|\bredeliver\b/i],
  ["frontend", /\brendered\b|\brenders\b|\bui\b|\blocal state\b|\bno duplicate event\b/i],
];

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "your", "have", "will",
  "before", "after", "when", "than", "then", "same", "only", "into",
]);

const SYNONYMS: Record<string, string[]> = {
  inspect: ["inspect", "check", "verify"],
  check: ["check", "inspect", "verify"],
  verify: ["verify", "check", "inspect"],
  deduplication: ["deduplication", "dedup", "deduplicate"],
  dedup: ["dedup", "deduplication", "deduplicate"],
  replay: ["replay", "redeliver", "redelivery"],
  redeliver: ["redeliver", "replay", "redelivery"],
};

let cachedSuite: TriageSuite | null = null;

export function loadSuite(): TriageSuite {
  if (cachedSuite) return cachedSuite;
  const suitePath = fileURLToPath(new URL("../../../evals/triage-suite.json", import.meta.url));
  const parsed = SuiteSchema.safeParse(JSON.parse(readFileSync(suitePath, "utf8")));
  if (!parsed.success) throw new Error("evals/triage-suite.json does not match the evaluator schema");
  cachedSuite = parsed.data;
  return cachedSuite;
}

function applicability(appliesTo: string[]): { broad: boolean; components: Set<string> } {
  const components = new Set<string>();
  let broad = false;
  for (const token of appliesTo) {
    const key = token.trim().toLowerCase();
    if (BROAD_TOKENS.has(key)) broad = true;
    const component = COMPONENT_TOKENS[key];
    if (component) components.add(component);
  }
  return { broad, components };
}

function ticketSignals(ticket: Ticket): Set<string> {
  const text = `${ticket.summary}\n${ticket.description}`;
  const found = new Set<string>();
  for (const [component, pattern] of TICKET_SIGNALS) {
    if (pattern.test(text)) found.add(component);
  }
  return found;
}

function imposedComponent(components: Set<string>): string | null {
  if (components.size === 1) return [...components][0] ?? null;
  if (components.has("event-platform")) return "event-platform";
  return [...components][0] ?? null;
}

// A single named component applies only to tickets whose text signals that component.
// A broad token, or more than one component, applies the lesson to every suite ticket.
// Component names come from appliesTo. Lesson prose can mention another component as a warning.
function effect(appliesTo: string[], ticket: Ticket): { applied: boolean; component: string | null } {
  const routing = applicability(appliesTo);
  if (!routing.broad && routing.components.size === 0) return { applied: false, component: null };
  if (!routing.broad && routing.components.size === 1) {
    const component = [...routing.components][0];
    if (!component || !ticketSignals(ticket).has(component)) return { applied: false, component: null };
    return { applied: true, component };
  }
  return { applied: true, component: imposedComponent(routing.components) };
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length >= 4 && !STOP_WORDS.has(word)) ?? [];
}

function covers(required: string, corpus: string): boolean {
  const needed = words(required);
  if (needed.length === 0) return false;
  const haystack = new Set(words(corpus));
  return needed.every((word) => (SYNONYMS[word] ?? [word]).some((token) => haystack.has(token)));
}

function proposalCorpus(lesson: LessonProposal): string {
  return [lesson.lesson, ...lesson.proposedChange.instructions, ...lesson.proposedChange.verificationSteps].join("\n");
}

function caseScore(componentCorrect: boolean, covered: number, total: number): number {
  const checks = total === 0 ? 0 : covered / total;
  return (Number(componentCorrect) + checks) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

export function compareLesson(lesson: LessonProposal, suite: TriageSuite = loadSuite()): EvaluationScores {
  const corpus = proposalCorpus(lesson);
  const cases: EvaluationCaseResult[] = [];
  const regressions: string[] = [];
  const scores: number[] = [];

  for (const suiteCase of suite.cases) {
    const appliedEffect = effect(lesson.appliesTo, suiteCase.ticket);
    const checksCovered = appliedEffect.applied
      ? suiteCase.requiredChecks.filter((check) => covers(check, corpus)).length
      : 0;
    const componentCorrect = appliedEffect.applied && appliedEffect.component === suiteCase.expectedComponent;
    if (appliedEffect.applied && appliedEffect.component !== suiteCase.expectedComponent) {
      regressions.push(`${suiteCase.id} (${suiteCase.ticket.key}) assigned ${appliedEffect.component ?? "no component"}`);
    }
    cases.push({
      caseId: suiteCase.id,
      ticketKey: suiteCase.ticket.key,
      applied: appliedEffect.applied,
      component: appliedEffect.applied ? appliedEffect.component : null,
      componentCorrect,
      checksCovered,
      checksTotal: suiteCase.requiredChecks.length,
    });
    scores.push(caseScore(componentCorrect, checksCovered, suiteCase.requiredChecks.length));
  }

  const baselineScore = mean(suite.cases.map(() => caseScore(false, 0, 1)));
  const candidateScore = mean(scores);
  const applied = cases.filter((item) => item.applied);
  const coveredAppliedCases = applied.length > 0 && applied.every((item) => item.checksTotal > 0 && item.checksCovered === item.checksTotal);
  const decision = regressions.length > 0
    ? "reject"
    : candidateScore > baselineScore && coveredAppliedCases
      ? "publish"
      : "needs-review";

  return {
    suiteVersion: suite.suiteVersion,
    evaluatorVersion: EVALUATOR_VERSION,
    baselineScore,
    candidateScore,
    regressions,
    decision,
    cases,
  };
}
