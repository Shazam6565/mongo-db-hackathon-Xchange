---
name: team-harness
description: Inspect the active Xchange lesson harness, evaluate a candidate, roll back an active lesson, and refresh generated lesson skills. Use for publication and harness-version operations, not for changing the evaluation suite to make a candidate pass.
---

# Publish and recover the active harness

The API owns publication and immutable harness history. The maintained workflow
skills in `skills/` are distinct from the generated `team-lesson-*` caches. Read
[the data-layer contract](../../docs/data-layer.md) for current scope and loading
behavior. Run the portable client from the repository root with the caller's own
privately injected `TEAM_API_URL` and `TEAM_API_TOKEN`.

```sh
node skills/team-memory/scripts/client.mjs access
node skills/team-memory/scripts/client.mjs harness
node skills/team-memory/scripts/client.mjs lesson LESSON_ID
```

Confirm the intended project and role. Writers propose candidates; hosted evaluate
and rollback require evaluator. A local owner API permits development operations
but does not prove the hosted evaluator boundary. Read the candidate, evidence and
current version before an authorized evaluation:

```sh
node skills/team-memory/scripts/client.mjs evaluate LESSON_ID EXPECTED_LESSON_VERSION
node skills/team-memory/scripts/client.mjs evaluations
node skills/team-memory/scripts/client.mjs harness
```

The current gate is a fixed-suite scorer. Report the actual result and suite;
publishing through it is not proof of improved live-agent behavior. Do not edit
held-out cases, copy their answers into candidates, or write lesson status directly.
Reconcile a timeout or 409 by rereading the lesson, evaluation and harness. Do not
repeat a mutation with a guessed version.

For an authorized rollback, read the active harness number and confirm that the
target lesson is active. Use that number, not the lesson's version:

```sh
node skills/team-memory/scripts/client.mjs rollback LESSON_ID EXPECTED_HARNESS_VERSION
node skills/team-memory/scripts/client.mjs harness
```

Rollback appends a new harness version removing that lesson from active retrieval;
it does not delete the lesson or its evaluation. Inspect the resulting references
and audit. Never rewrite history to hide a failed evaluation or publication.

Refresh derived skills after a verified publication or rollback:

```sh
node skills/team-memory/scripts/client.mjs sync-skills
```

This writes advisory lesson caches under `.agents/skills/` and `.claude/skills/`,
and records consumption. `memory` also records consumption; `harness`, `lesson`,
`evaluations` and `audit` are inspection commands. Do not commit caches or treat
retrieval as evidence of application or improvement. A failed refresh leaves the
current remote version unverified. Read [team-memory](../team-memory/SKILL.md) to
record an actual application and outcome. A learning-effectiveness claim additionally
needs a held-out comparison with memory enabled/disabled and fixed task/tool budgets.
