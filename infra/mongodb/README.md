# MongoDB integration

The API's MongoDB adapter stores lesson candidates and reads published lessons from `lessons`.
Configure `MONGODB_URI` and `MONGODB_DATABASE` in the root `.env`. The API creates ordinary
indexes for the stable lesson ID and scoped/status-filtered listing. MongoDB mode starts empty.
Load the starting corpus with `npm run seed` (see [data layer](../../docs/data-layer.md)); seeded
lessons are published only by the gate. The built-in sample lesson exists only in disposable in-memory mode.

Implemented and planned collections:

| Collection | Contents |
| --- | --- |
| `canvases` | Structured notes, record references and revision-checked layout |
| `activity_records` | Scoped observations, decisions, applications, outcomes and corrections |
| `tickets` | Native ticket records, created through the scoped API |
| `agent_changes` | Proposed agent-event ingestion; no collection or routes are implemented |
| `lessons` | Lesson text, scope, applicability, evidence references, status, version. Embedding is planned |
| `evaluations` | Fixed-suite baseline/candidate scores, case results, regressions, evaluator identity |
| `harness_versions` | Immutable versions of which published lessons agents load; publishing adds a lesson, rollback removes one |
| `audit_events` | Proposal, evaluation, publication, rejection, and consumption events |

`tickets`, `canvases`, `activity_records`, `lessons`, `evaluations`, and `audit_events` are written by the API.
Tickets use unique IDs and unique `(teamId, projectId, key)` references; HTTP detail routes
use the record ID. The proposed agent-event interface does not provision a second log store. Publication of a lesson,
its evaluation, and its audit events uses one MongoDB transaction, which needs a replica set.
Publishing a lesson appends a `harness_versions` record in that same transaction; a rollback appends
one without the lesson. A unique `(teamId, projectId, number)` index keeps concurrent changes from
sharing a version. A version selects lessons for agent context and generated skills; it grants no
tools and does not change Pi's configuration.

## Vector Search — planned

Choose an embedding provider/model first. Create an Atlas Vector Search index on `embedding`
with the model's exact dimensions and similarity function. Add filter fields `teamId`,
`projectId`, and `status`. Generate ticket and lesson embeddings using the same model.
Query only the authenticated scope with `status=published`, then check component/code-version
compatibility. No vector index or model is silently provisioned by this repository.

## Change Streams — planned

Watch approved memory changes on the backend, then fan out scoped invalidations using SSE.
Store resume tokens; refetch the snapshot when resuming is no longer possible. Apply refreshed
context at a model-call boundary, and expose the active memory/config version to the engineer.
Use replica-set-backed MongoDB/Atlas with Change Stream support. The extension currently
refreshes on each new agent run or `/team-memory`; it does not subscribe to live events.

## Concurrent changes — planned

Represent lessons as individual documents. Use immutable revision records and expected-version
updates for promotion/rollback; publish the new configuration pointer together with its audit
event. Do not use whole-file last-writer-wins updates. Team/project filters are enforced in
the service; per-user membership and role checks must precede any shared remote deployment.
