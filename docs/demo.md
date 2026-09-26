# Demo plan

## What the starter can demonstrate now

1. Run `npm run dev` from the root and open the dashboard.
2. Inspect the sample published lesson. It is labeled as demo data with no real validation.
3. Start Pi with the extension using the command in the root README.
4. Run `/team-memory`; inspect `.team-memory/MEMORY.md` in that agent's current working directory.
5. Run `/share-lesson Title | Lesson | DEMO-101`, or POST `examples/lesson-candidate.json` to the API.
6. Refresh the dashboard. The new record is a candidate.
7. Refresh team memory. The candidate is deliberately absent because evaluation/publishing is not implemented.

This checks the proposal/read plumbing. With MongoDB enabled, candidates survive API restarts;
the database starts empty, so there is initially no published memory. A candidate cannot set its
own status. Publication happens only through the evaluation route below.

## Fixed-suite gate

1. Submit `examples/lesson-candidate.json`. It stays a candidate, so `/v1/memory` and a refreshed
   `MEMORY.md` omit it.
2. `POST /v1/lessons/:id/evaluate` with `{ "expectedVersion": 1 }`. The event-redelivery ticket
   passes and the UI-only duplicate stays out of scope. The lesson becomes `published`, and
   `/v1/memory` includes it.
3. Submit the same lesson with `frontend` added to `appliesTo`. Evaluation rejects it. Team memory
   still contains only the published lesson.
4. Fetch `/v1/memory` with header `x-engineer-id: engineer-b`. `/v1/audit` records that engineer
   and the published lesson version. A mismatched `expectedVersion` leaves the candidate unchanged.

The dashboard Evaluate button calls the same route. Scores are from the fixed suite, not a live model.

## Target hackathon demonstration

Use two engineers or two separate sessions/checkouts with distinct identities. Use two machines
only after the shared API has actual user authentication and a reachable HTTPS deployment.

1. Engineer A's ticket: repeated event delivery creates duplicate notifications. Record the initial
   incorrect triage, the correction, and a real failing/passing replay test.
2. Produce a scoped lesson and a proposed verification step; show their provenance.
3. Compare baseline/candidate on fixed held-out tickets. Include a UI-only duplicate bug as a
   negative control. Display actual scores and show a bad candidate being rejected.
4. Publish the passing change as a versioned record. Show the corresponding audit event.
5. Engineer B is handling a different activity-feed ticket. Its agent receives the memory update,
   checks applicability, and includes event deduplication in the investigation/acceptance criteria.
6. Show which lesson/configuration version B used and its measured outcome.

The key observation is knowledge transferring across independent work—not identical transcripts
or two agents secretly sharing a single conversation. Keep the evaluator's expected answers out
of both agents' context and workspaces.

## Metrics to display once implemented

- Correct component assignment on unseen tickets.
- Required verification checks included in the triage proposal.
- Repeated-mistake rate and regression count.
- Time from published version to consumption by Engineer B.
- Tool calls/tokens per correct result (secondary to correctness).

Do not pre-fill success percentages. The UI should show pending/failed evaluations honestly.
