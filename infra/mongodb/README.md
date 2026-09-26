# MongoDB integration

The API's MongoDB adapter stores lesson candidates and reads published lessons from `lessons`.
Configure `MONGODB_URI` and `MONGODB_DATABASE` in the root `.env`. The API creates ordinary
indexes for the stable lesson ID and scoped/status-filtered listing. MongoDB mode starts empty;
sample published lessons are exclusive to disposable in-memory mode.

Planned collections:

| Collection | Contents |
| --- | --- |
| `lessons` | Lesson text, scope, applicability, evidence references, status, version, embedding |
| `evaluations` | Fixed-suite baseline/candidate scores, regression results, evaluator identity |
| `harness_versions` | Versioned instructions, registered-tool presets, verification steps |
| `audit_events` | Proposal, evaluation, promotion, rollback, and consumption events |

Only `lessons` is implemented. The contract types for evaluations and harness versions are
design placeholders, not proof of implemented persistence or rollout.

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
