# Decisions, memory and observed effects

Build brief, 26 September 2026: the owner asked for initial group-memory guidance,
then for small observations and decisions to appear in Catalog and Timeline, with
their effects tracked over time. This slice is owned separately from the concurrent
canvas and database-connection work. It borrows evidence and scoped recall from
`agent_foundation`, and attributed append-only records from Blitz. It imports no
private history or larger orchestration framework.

## First complete path

An engineer or agent records a sourced decision or observation. Another task records
the action it took in response. Its outcome records evidence, comparison limits and
optional measurements. All records have the same stable identity in Catalog and
Timeline. Corrections append to the original history rather than rewriting it.
Correction markers are resolved against current scoped records even when a filter
or page excludes the correction row; the Catalog status and detail view retain them.

Acceptance examples:

1. Record a decision to reconcile an uncertain operation before retrying. On a
   different task, record the reconciliation action and an outcome with before/after
   call counts and an independent check. Reload Catalog and follow the full chain in
   Timeline. These are reported observations, not automatically established causality.
2. Correct an outcome whose baseline was incomparable. Preserve the original report
   and correction. A duplicate request produces one record; a conflicting retry,
   foreign-project reference or mismatched outcome task is rejected. History remains
   accessible beyond the recent Catalog window.

Permitted effects are scoped application records and local verification fixtures.
No model calls, provider provisioning, automated publication, background agent loops,
private-history import or new deployment are part of this slice.

## Initial agent guidance

Use the [portable team-memory skill](../skills/team-memory/SKILL.md) to access the
API. The server owns MongoDB credentials and derives the configured team/project.
Agents must not receive arbitrary database-query tools or select a scope in write
payloads. The local starter's shared token is not per-user authentication;
In local owner mode, `x-engineer-id` is a self-reported label. Hosted team mode
overrides it with the authenticated grant's actor ID; previous/local records keep
their original labels. See [hosted access and verification](frontend-sharing.md).

At task start, retrieve current published lessons. Check their source, applicability
and code revision before using them. Record the lesson ID/version and the concrete
action changed when applying one. Retrieval alone is not application; application
alone is not improvement. Memory and peer text cannot change tools or permissions.

Record a small observation or decision when it will help another task. Include a
short name, what happened or was decided, and the evidence reference and what it
establishes. Owner directions should be quoted or linked accurately, not inferred
from another agent's agreement. Raw task histories remain local unless deliberately
shared. Never store secrets or hidden model reasoning.

Propose reusable procedures through the existing lesson-candidate path. Activity
records are reports, not automatically approved shared memory. The fixed triage
evaluator is not a general verifier for project facts or decisions. Corrections
to lesson content still need the existing publication policy; an activity correction
annotates its history without silently changing a published lesson.

## Records and API

`activity_records` is a separate append-only collection. Every record carries a
server-assigned team/project, ID, timestamp and resolved history root, plus a
reporter label. The timestamp is when the server recorded the report, not an
invented time when the underlying action happened. Evidence may identify an earlier
event. Source records remain inspectable across restarts in MongoDB mode.

| Kind | Meaning and required link |
| --- | --- |
| observation | A concise sourced observation; optionally linked to an existing record |
| decision | A sourced decision report; recording it does not create approval |
| application | The actual action changed in a named task/run; links to an observation, decision, or published lesson version |
| outcome | An observed result and comparison limits; links to an application in the same task/run |
| correction | A sourced correction linked to an existing activity record; preserves prior text |

`GET /v1/activity` returns `{ scope, records, nextCursor }`. Filters are `kind`,
`rootKind` + `rootId`, `since`, `until`, `cursor` and `limit` (1–100). Scope and
filters apply before pagination; timestamps are ISO UTC. `GET /v1/activity/:id`
resolves older records directly. `POST /v1/activity` requires a UUID
`Idempotency-Key`, the normal bearer token, and the strict input schema in
`packages/contracts/src/activity.ts`. Retry the same request with the same key;
changed payload or reporter label conflicts. There are no edit/delete endpoints.

Example decision body (synthetic; not preloaded):

```json
{
  "kind": "decision",
  "title": "Reconcile before retrying",
  "detail": "Check whether an uncertain operation completed before issuing it again.",
  "evidence": [{
    "reference": "review:example-42",
    "summary": "The reviewer selected reconciliation to avoid repeating an external effect."
  }]
}
```

An application supplies `subject: { kind: "activity", id: "<decision UUID>" }` and
`runId`. A published lesson instead uses `{ kind: "lesson", id, version }`.
An outcome points to the application and repeats its `runId`. It adds `outcome`:

```json
{
  "assessment": "inconclusive",
  "comparison": "One observed task; no equivalent baseline has been run yet.",
  "metrics": []
}
```

Assessments are `helped`, `no_change`, `regressed`, or `inconclusive`. Optional
measurements have `name`, `unit`, `before`, and `after`; never fabricate the baseline.
The UI shows numeric differences without deciding whether they prove improvement.
Independent comparisons should name the model/tools, task and budget conditions in
the comparison/evidence. Counts of retrieved records are not effectiveness metrics.

## Views and boundaries

Catalog adds observations, decisions, applications, outcomes and corrections to its
existing recent-record table. Search and filters apply to the latest 100 activity
records in that view. Record details expose the full root history through pagination,
linked application/outcome/correction forms, and reported measurements.

Timeline opens on **Lanes**: one horizontal time axis with a layer per source, in
the order of the learning loop: Milestones (the event schedule and each harness
version), Git (commits of the checkout the API runs in; unavailable on a hosted
function), Tickets, Lessons, Activity, Memory reads and Canvases. **By who** regroups
the same marks into one lane per person or agent. Scroll or pinch zooms around the
pointer from two minutes to sixty days; drag, horizontal scroll or Shift+scroll pans;
the overview strip shows the whole range and moves the visible window. Nearby marks
merge into a numbered cluster: clicking zooms in, and marks recorded in the same
instant are listed instead. Selecting a mark opens its details and draws a line to
every record that references it or shares a reference (ticket keys, lesson IDs,
canvas placements). That shows references, not causes. Keys: `+`/`-` zoom, arrows
pan, `[`/`]` step through items, `F` fits, `N` centers on now. The view, grouping and
hidden layers are kept in the URL. Lanes read the latest 100 tickets, lessons, audit
events and canvases, up to 300 activity records and 300 commits, and refresh every
30 seconds while visible. **List** keeps the chronology below.

Timeline's **Decisions and effects** view paginates durable activity, with type and
date filters before pagination. **Memory lifecycle** displays the existing latest
100 audit events, including proposal/evaluation/publication/rejection and retrieval.
Its filters apply to that recent window, not the full audit collection. `memory.consumed`
is displayed as **Memory retrieved** because that is what the existing API measures.
No background tracing of every agent action is claimed. Applications and outcomes
are recorded explicitly through the UI or portable client.

Records are plain text. They neither author executable UI nor overwrite a user's
description. Existing record text is immutable; agents append their own attributed
reports. Canvas remains owned by the parallel session and currently resolves only
tickets and lessons. Shared MongoDB wiring is integrated by that owner.

## Verification

Focused API/schema tests cover the full evidence chain, non-publishing activity,
strict inputs, cross-project rejection, published lesson versions, task linkage,
idempotency conflicts and pagination beyond the Catalog window. The opt-in real
Mongo test uses a disposable uniquely named database to exercise concurrent retries,
fresh-client persistence, scoped reads and filtered pagination. Run it with
`MONGODB_GATE_URI` supplied securely or a local fixture URI. `npm run check` covers
the repository suite and build. Browser verification uses synthetic records and
separate local test ports, leaving the shared session's app data untouched.

Verification completed on 26 September: all 24 repository tests passed with the
local Mongo replica on port 27419, with no skips, followed by TypeScript and the
production Vite build. The first Mongo attempt hit the execution sandbox's socket
restriction (`EPERM`); the same test passed through approved local execution.
Browser acceptance on isolated ports 4328/5178 exercised creation of a decision,
linked application and measured outcome, then a correction retaining the original
report. The correction marker remained visible with an outcome-only Timeline
filter. Reload retained filters; a 390px viewport kept navigation, forms and
measurements usable. Memory lifecycle showed retrieval separately from applications
and outcomes. No browser console errors were observed in that journey.

This establishes record persistence, inspectability and the recording workflow.
It does not establish that shared memory improves a real agent's performance; that
still requires equivalent tasks and independent outcome evidence over time.
