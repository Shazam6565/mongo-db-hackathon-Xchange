---
name: team-activity
description: Record and inspect Xchange observations, decisions, lesson applications, measured outcomes and corrections in the shared Timeline. Use for attributable work evidence without automatically publishing memory.
---

# Attributed evidence and outcomes

Use the shared client from the repository root with the caller's privately
injected API URL and token. Read [the activity contract](../../packages/contracts/src/activity.ts)
for strict input fields and [the tracking guide](../../docs/memory-tracking.md)
for current behavior. The API derives actor, timestamps and project scope.

```sh
node skills/team-memory/scripts/client.mjs list-activity 'kind=observation&limit=50'
node skills/team-memory/scripts/client.mjs read-activity ACTIVITY_UUID
node skills/team-memory/scripts/client.mjs record-activity ./activity.json OPERATION_UUID
```

Choose the record kind that the evidence supports:

- `observation`: a bounded finding with a concrete source reference.
- `decision`: a choice and concise rationale tied to evidence.
- `application`: link an existing observation/decision or a published lesson
  version, name the run, and say how it changed an action.
- `outcome`: link that run's application; provide the observed comparison and
  `helped`, `no_change`, `regressed` or `inconclusive` assessment. Include numeric
  before/after metrics only when measured.
- `correction`: append a link to the prior activity and explain the correction;
  do not silently replace its history.

Every input needs a short title, detail, and 1–10 evidence references with summaries.
Application/outcome need `runId`. Lesson subjects include exact ID and version;
activity subjects use an activity UUID. Tickets are evidence references, not an
activity subject kind. Do not add invented identity or approval fields.

Read linked records before writing. Retain the operation UUID and exact payload
for an identical retry; resolve 409s deliberately. Read the saved record and
follow its root history to verify the chain. For history queries supply both
`rootKind` and `rootId`; follow `nextCursor` rather than claiming the first page
is complete. Date filters use ISO timestamps.

Reported outcomes are evidence claims, not independently verified causality.
Retrieval alone is neither application nor improvement. Keep hidden reasoning,
credentials, private transcripts and another project's records out of the Timeline.
These writes never publish memory automatically; use
[team-memory](../team-memory/SKILL.md) for a separately reviewed candidate.
