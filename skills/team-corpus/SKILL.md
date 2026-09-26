---
name: team-corpus
description: Prepare, validate and seed reviewed Xchange starting records or curated onboarding canvases. Use for corpus maintenance and repeatable demo setup; preserve live edits and keep real and synthetic projects separate.
---

# Reviewed starting records

Read [the data-layer guide](../../docs/data-layer.md), then inspect the selected
file in `corpus/` and [the loader](../../apps/api/src/seed.ts). Commands run from the
repository root. The real workspace is `xchange-team/xchange`; the synthetic demo
is `xchange-team/event-platform`. Confirm the selected scope instead of importing
demo lessons into real project memory.

Keep deterministic corpus keys and reference other records by those keys. Mark
synthetic evidence explicitly. Do not copy held-out evaluator cases into a corpus
or change the gate to publish a starting lesson. Curated guide canvases also follow
[team-canvas](../team-canvas/SKILL.md).

Validate before a live seed:

```sh
npm run seed -- corpus/xchange.json --dry-run
npm run seed -- corpus/event-platform.json --dry-run
```

Dry runs exercise the API in temporary storage; they do not prove Atlas persistence.
For an owner-authorized live seed, verify the intended server-only configuration
using the environment's approved redacted diagnostic, then run only the selected
corpus. Do not inspect credential values or give agents the database URI.

```sh
npm run seed -- corpus/xchange.json
```

The loader passes inputs through API validation and its gate. It retains records
edited after seeding, reports created/exists/kept results, and does not delete.
Report those results and verify the selected records through the normal client or
frontend. Do not force overwritten records to match the corpus. Review differences
as ordinary edits. A seed that leaves real-workspace lessons pending review is a
valid outcome when the current fixed suite does not cover them.
