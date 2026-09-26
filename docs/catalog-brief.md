# Catalog first

Owner direction, 26 September: build Catalog with lessons and manual ticket entry. Keep React/Vite; Canvas will later represent how tickets derive into evidence and lessons. Timeline, ticket execution, Jira synchronization and agent orchestration are outside this pass.

User: an engineer reviewing shared lessons and adding a ticket to the current team/project. Input: a short ticket summary, optional reference, component and description. Output: a scoped ticket record that appears alongside lessons and survives a browser reload. Memory storage remains explicitly temporary across API restarts; configured MongoDB persists tickets.

The owner session controls dashboard components, styles, a separate ticket contract and ticket API module. Existing evaluator/shared-contract changes belong to another session and must not be staged with this work. Only minimal registration/startup wiring is needed in shared API files. No new dependencies, model calls or provider resources.

Acceptance:
1. Add a synthetic ticket, inspect its unchanged description, reload its link, then find it using search and type/status filters. Cancel leaves no new record; an invalid or failed save keeps the draft recoverable.
2. Open an existing lesson and inspect applicability, evidence and proposed instructions without changing its identity or publication status. Column preferences survive reload; table overflow stays contained on a narrow viewport.

This first view searches the API's recent window (up to 100 items per type), with local sorting/filtering before UI pagination. It explicitly labels that window rather than implying complete historical search. The server has no complete lesson query API yet. Ticket descriptions are preserved verbatim; this pass has no replacement/update endpoint. Existing local token authentication is a single-owner demo boundary, not an authenticated distinction between human and agent callers.
