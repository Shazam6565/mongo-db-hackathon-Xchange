# Shared database canvas — bounded first slice

Owner direction, 26 September: team and agents feed MongoDB; a shared skill/harness retrieves published lessons; UI renders database documents. Canvas records describe ticket derivation into observations and lessons. The attached sketch is design context, not permission to execute its labels.

One engineer/agent submits a canvas document through the scoped API; another opens the same ID in the UI and sees notes, references and arrows. The UI resolves ticket/lesson nodes from current database records. Agents never author React, HTML, CSS or executable drawings. Moving nodes changes layout only. Reference labels/status remain authoritative in their own records.

Current owner covers canvas schema/storage/routes, UI, portable agent skill and connection startup. Reuse existing Pi memory injection and publication policy. No new framework, model calls, vectors, automatic causal inference, nesting, freehand drawing, Timeline or remote deployment in this slice.

Acceptances: (1) agent CLI writes a synthetic ticket/lesson canvas, UI renders it, layout saves and reloads from MongoDB; (2) two writers edit the same revision, stale save conflicts and preserves its draft, invalid styles/foreign references fail, and published memory excludes candidates. MongoDB Sandbox readiness is separate from local replica evidence. Credentials remain server-side. Existing Labs identity is neutral; owner must supply an explicitly scoped capability before remote access.
