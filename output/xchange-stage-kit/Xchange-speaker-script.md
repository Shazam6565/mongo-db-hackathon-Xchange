# Xchange — three-minute presentation

Six slides · 341 spoken words · 3:00 pacing target

Use the prepared screenshots throughout the timed talk. Keep the live workspace for questions afterward. Rehearse once at roughly 114 words per minute, allowing for the pauses below.

## 0:00–0:25 · Slide 1: Xchange

Your coding agent solves a hard bug. Tomorrow, another agent on your team hits the same problem and starts from scratch. The fix is in the code, but the lesson is buried in a conversation. We built Xchange: shared memory for coding agents, so what one agent learns can become context for the next.

*Pause after “buried in a conversation.” Look up before introducing Xchange.*

## 0:25–0:55 · Slide 2: We used Xchange to document Xchange

We used Xchange while building Xchange. Here’s an actual lesson we captured: our publication workflow needs a MongoDB replica set because it uses transactions. The record keeps the explanation, scope, commit and test together. It’s still a candidate, and the interface says so. The team can inspect what was learned and the evidence behind it before treating it as trusted guidance.

*Point once to the candidate status in the screenshot, then return to the audience.*

## 0:55–1:35 · Slide 3: Lessons reach the next agent

An agent records a finding. It can propose a candidate for evaluation, or explicitly share a lesson through Pi. Published lessons become part of a versioned set of instructions that another session can retrieve through Pi or MCP. People see the same records in the Catalog, Canvas and Timeline. We verified the handoff between two real Pi processes, and separately confirmed a model could identify its injected memory. Those checks show that the context reaches the agent.

*Give “two real Pi processes” a beat. The transfer check used synthetic content; the separate model check verified injected context.*

## 1:35–2:05 · Slide 4: MongoDB holds the shared state

MongoDB makes that shared state reliable. For evaluated publication, the lesson, evaluation, harness version and audit event commit in one transaction. Version checks protect against competing updates. Rollback removes a lesson from active memory. We also implemented Atlas Vector Search for ticket relevance, with a recency fallback. Each agent keeps its own conversation.

*Emphasize “one transaction.” Keep the architecture explanation to these four records.*

## 2:05–2:40 · Slide 5: Shared memory survives competing writes

Then we put the system under contention. Forty simultaneous shares produced forty consecutive versions, with no lessons lost. Thirty competing evaluations produced one winner and twenty-nine conflicts. Fifty identical retries created one record. These are recorded tests against a local MongoDB replica set. We also have a working hosted workspace, where you can inspect the lessons and the evidence.

*Pause briefly after each result. These are recorded local tests, not production scale claims.*

## 2:40–3:00 · Slide 6: What one agent learns, the team can reuse

Next, we’ll measure whether shared lessons reduce mistakes on unseen tickets. Today, we have working agent integrations and shared memory that we can inspect, version and roll back. Xchange: what one agent learns, the team can reuse.

*Slow down for the last sentence. Leave the final slide up.*

## If you are running late

Skip the Atlas Vector Search sentence on slide 4 and the hosted-workspace sentence on slide 5. Keep the three test results and the closing line.

## Judge questions

**What makes this recursive harnessing?**
Agent findings can become a versioned instruction set for future runs. The transfer mechanism works. Measuring a reduction in mistakes on unseen tickets is the next milestone.

**Does every lesson pass an evaluation?**
No. Candidates can pass a fixed-suite publication gate. Pi also offers immediate sharing without evaluation. Both update active versioned memory. The current evaluator scores lesson text and scope; it does not run before-and-after model trials.

**Why MongoDB?**
MongoDB stores lessons, scope and evidence alongside tickets and activity. Transactions keep evaluated publication consistent across the lesson, evaluation, harness version and audit event. Version checks protect competing writes, and rollback changes what later agents receive. Atlas Vector Search is implemented for relevance; local verification used the recency fallback.

**What did you actually prove?**
Recorded local tests verified concurrency, version conflicts and idempotent retries. Two real Pi processes shared and retrieved a synthetic lesson under different audit identities. A separate real model call correctly identified injected memory. The local setup report also records 94 passing tests with no failures or skips. None of those checks establishes fewer model mistakes.

**How do you prevent a bad lesson from spreading?**
The candidate path has a fixed-suite gate; active versions are auditable and can be rolled back. Immediate sharing is deliberately a separate path that bypasses evaluation. This remains a prototype: broader model evaluations and stronger controls on immediate sharing are future work.

## Optional 20-second product walkthrough, after the talk

Open the [featured lesson](https://mongo-db-hackathon-xchange.vercel.app/?item=lesson%3A6a9be369-ee3a-52dc-af40-f92186f7c145), point to Candidate and its evidence, then open Timeline to show the shared work history. Load the site before taking the stage to avoid waiting on a cold start. This is a read-only walkthrough; it does not depend on publishing anything live.

## Evidence and claim boundaries

- [Recorded concurrency and end-to-end report](https://mongo-db-hackathon-xchange.vercel.app/?item=observation%3A72d75e8b-ff2e-4a0d-a55c-18fc115e7d52): 40 concurrent shares; 30 evaluations with one winner and 29 conflicts; 50 identical retries per record type yielding one record. Tests used a disposable local MongoDB 7 replica set through the hosted entry code. Read in the public UI on 26 September 2026; not rerun for this deck.
- [Featured candidate](https://mongo-db-hackathon-xchange.vercel.app/?item=lesson%3A6a9be369-ee3a-52dc-af40-f92186f7c145): an actual build lesson; its candidate status is visible in the saved screenshot.
- [Pi, model-context and persistence verification](../../docs/local-verification-2026-09-26.md): transport, injected memory, fresh-process persistence and 94-test result.
- [Publication and rollback implementation](../../apps/api/src/repository.ts); [fixed-suite evaluator](../../apps/evaluator/src/compare.ts).
- Product screenshots were captured from the hosted workspace earlier on 26 September 2026. They show that recorded state, rather than promising the current catalog counts.

Automatic extraction from failures and push synchronization remain planned. Do not claim that model weights change or that a reduction in errors has already been measured.
