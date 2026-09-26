import type { Tone } from "./model.js";

// The event's published schedule (MongoDB NYC hackathon, times in New York). This is the
// only Timeline data that is not a stored record; change it here if the schedule changes.
export const schedule: { id: string; at: string; end?: string; title: string; detail: string; tone: Tone }[] = [
  { id: "build-window", at: "2026-09-26T10:30:00-04:00", end: "2026-09-26T17:00:00-04:00", title: "Build window", detail: "Hackathon build time, 10:30 to 17:00 on Saturday 26 September.", tone: "neutral" },
  { id: "submission", at: "2026-09-26T17:00:00-04:00", title: "Submission due", detail: "Public repository and one-minute demo video, both checked while signed out.", tone: "red" },
  { id: "first-judging", at: "2026-09-26T17:15:00-04:00", title: "First judging", detail: "Technical demo: execution, a changed result, recovery and Atlas evidence.", tone: "neutral" },
];
