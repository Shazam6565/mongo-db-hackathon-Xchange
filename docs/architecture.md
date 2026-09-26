# Architecture

Target: independent engineering agents share useful, tested lessons while retaining separate
task histories and working copies. MongoDB owns shared records; Pi extensions adapt each local
agent's context. Jira provides the first ticket workflow.

## System sketch

```mermaid
flowchart TB
  subgraph A[Engineer A — local workspace]
    PA[Pi session + extension]
    MA[Generated .team-memory/MEMORY.md]
    PA --> MA
  end
  subgraph B[Engineer B — separate workspace]
    PB[Pi session + extension]
    MB[Generated .team-memory/MEMORY.md]
    PB --> MB
  end
  PA <-->|Candidate submission / published snapshot| API[Shared memory API — TypeScript]
  PB <-->|Candidate submission / published snapshot| API
  UI[Lesson + evidence dashboard] --> API
  API <--> DB[(MongoDB Atlas: lessons)]
  API -.->|Candidate queue — planned| EVAL[Isolated evaluator: baseline vs candidate]
  EVAL -.->|Scores and regressions| GATE[Version-checked publication gate]
  GATE -.->|Evaluations + harness versions + audit| DB
  DB -.->|Change Stream — planned| EVENTS[Scoped SSE notifications]
  EVENTS -.->|Invalidate, refetch at next safe boundary| PA
  EVENTS -.->|Invalidate, refetch at next safe boundary| PB
  JIRA[Jira adapter — planned] -.-> API
```

Solid connections are scaffold paths. Dashed connections are planned. The MongoDB adapter is
implemented but requires a real URI; the default local demo runs against an in-memory repository.

## Learning and publication

```mermaid
sequenceDiagram
  participant A as Engineer A + Pi
  participant API as Shared API
  participant E as Evaluator (planned)
  participant DB as MongoDB
  participant B as Engineer B + Pi
  A->>API: Propose lesson + evidence + workflow change
  API->>DB: Store as candidate
  API->>E: Compare baseline and candidate on fixed held-out cases
  E->>DB: Persist actual scores, regressions, suite/version identity
  alt Passes gate with matching expected version
    E->>DB: Publish lesson and activate version, with audit event
    DB-->>API: Published state changed
    API-->>B: Memory invalidated (planned SSE)
    B->>API: Fetch applicable published lessons
    API-->>B: Scoped snapshot + version provenance
    B->>B: Refresh local Markdown and inject at model-call boundary
  else Failure or unresolved conflict
    E->>DB: Keep unpublished / reject / request review
  end
```

## Ownership and contracts

| Boundary | Responsibility |
| --- | --- |
| Pi extension | Fetch current memory, generate local cache, propose lessons; later extract evidence and apply evaluated configuration |
| API | Enforce scope, validate requests, persist candidates; later authenticate users and coordinate publication |
| Evaluator | Execute fixed baseline/candidate trials in isolation; compute hard metrics; cannot be edited by the candidate |
| MongoDB | Durable shared knowledge, evidence metadata, versions, later vectors and publication history |
| Dashboard | Explain which lesson exists, where it came from, how it was tested, and who consumed it |
| Jira adapter | Convert tickets to the common schema and submit visible triage proposals |

The model continues to run through Pi and its configured provider. Sharing changes retrieved
context and eventually harness configuration, not model weights. The implementation currently
injects lesson text only; `proposedChange` is saved but not activated.

## Memory and consistency

- Each lesson has a stable ID, team/project scope, version, applicability, evidence, and status.
- Only `published` records appear in the memory snapshot. Candidates remain visible in the dashboard.
- The generated file lives at `.team-memory/MEMORY.md`; existing root-level memory files are untouched.
- `/team-memory` and the next new agent run fetch the current snapshot. There is no automatic
  cross-machine push yet, and a file update cannot change a model request that is already running.
- Planned delivery is eventual consistency with published version IDs, reconnect recovery, and
  explicit client consumption logs. The backend is the source of truth after disconnection.
- Planned conflict resolution uses separate revisions and expected-version updates. An LLM
  summary must not silently overwrite another engineer's finding.

## Validation and evidence

Use the same model, fixtures, and budgets for baseline and candidate trials. Keep evaluation
answers and scoring outside the tested agent's workspace/context. Start with component accuracy,
required-check coverage, and regressions. A negative-control case must stop an overly broad lesson
from sending every duplicate UI bug to the event team. A single good result is a demo, not proof
of general reliability; grow the suite and repeat trials before wider rollout.

The repository contains fixed synthetic fixtures and an evaluator interface only. It does not
have computed scores, automatic publication, trained models, or a completed isolation mechanism.

## Remote use and access

The starter binds both services to loopback and uses a development token for a single scope.
Before remote use, authenticate engineers, derive membership/scope on the server, separate worker
publication authority from agent submission authority, and use HTTPS. Tenant filters supplement
authorization; they are not a replacement. Keep retrieved lesson content separate from executable
tool authorization. Treat evidence references as claims until the evaluator verifies them.

## First implementation milestone

Two independently identified Pi sessions, one repo, one candidate learned from ticket A, fixed
positive/negative evaluation cases, one published version, and an improved result on ticket B.
The candidate-to-published transition is the central missing piece of the skeleton.
