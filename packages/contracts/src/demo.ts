import type { CandidateInput, Lesson } from "./index.js";

export const demoCandidate: CandidateInput = {
  title: "Check event deduplication when investigating duplicate effects",
  lesson: "In the demo event platform, notification and activity-feed consumers may receive the same event twice. Check the event ID and consumer deduplication before classifying duplicate effects as a frontend rendering issue.",
  authorId: "engineer-a",
  appliesTo: ["event-sdk", "notifications", "activity-feed"],
  evidence: [
    { kind: "ticket", reference: "DEMO-101", summary: "Synthetic ticket: one event produces two notifications." },
    { kind: "test", reference: "fixtures/event-replay", summary: "Demo evidence placeholder. No test has actually run." },
  ],
  proposedChange: {
    instructions: ["Consider event redelivery when triaging duplicate effects in event consumers."],
    verificationSteps: ["Replay the same event twice and check for a single side effect."],
    suggestedTools: ["read", "bash"],
  },
};

export const demoLessons: Lesson[] = [{
  ...demoCandidate,
  id: "demo-lesson-001",
  teamId: "demo-team",
  projectId: "event-platform",
  status: "published",
  version: 1,
  origin: "demo",
  createdAt: "2026-09-25T12:00:00.000Z",
  updatedAt: "2026-09-25T12:00:00.000Z",
}];
