# Local setup verification — 26 September 2026

Environment: Node 22.22.2, npm 11.12.1, Pi 0.87.1, macOS.
Starting revision: `e211db7`; final checks include the concurrently integrated
`f5cfc60` revision. Local setup commands are in [local-setup.md](local-setup.md).

| Boundary | Result | Evidence |
| --- | --- | --- |
| Pi installation | Achieved | Global pinned install; `pi --version` reports 0.87.1. A link in the existing `~/.local/bin` exposes npm's version-specific installation on PATH. |
| Complete JS/TS suite | Achieved | Final `npm run check:local`: 94 passed, zero failed/skipped; includes seven real MongoDB tests and the three preview tests newly added to `npm test`. The earlier 92-test run also passed before two tests arrived with the concurrent integration. |
| Build and package contracts | Achieved | Maintained skills, TypeScript, Vite production build, portable MCP bundle and 14 plugin tool contracts passed. |
| Phoenix adapter contracts | Achieved, offline only | Five Python tests passed against `~/code/phoenix_mpc/apps/phoenix_mcp/.venv/bin/python` and its real gateway types. No deployed Phoenix access was tested. |
| Local persistence and seed | Achieved | Existing MongoDB 7 replica on 127.0.0.1:27419; separate `xchange_local` database. Both reviewed corpora seeded. Event-platform starts with 10 tickets, 5 lessons, 4 activity records and one canvas. |
| Pi extension | Achieved | Real Pi RPC processes discovered `/team-access`, `/ticket`, `/team-memory`, `/share-lesson`; selected DEMO-118 and wrote the published lesson cache. |
| Cross-session transport | Achieved | One Pi process published a synthetic local lesson; a second process in a fresh temporary directory retrieved it under its own audit identity. The smoke lessons were subsequently rolled back from active memory; their local audit/history remains. No model was used for this transport check. |
| Fresh API process | Achieved | Stopped and restarted only the dev processes started for this setup. Tickets, lessons, canvases, activity and harness responses matched exactly across restart. |
| Browser | Achieved for inspected views | Catalog, seeded Duplicate effects canvas, Timeline and Harness loaded from Local MongoDB. The Timeline footer's schedule-marker mismatch was corrected. |
| Model authentication and response | Achieved | OpenRouter auth reported ready using the user-selected personal 1Password command reference. A real Pi/Sonnet 4.6 request returned `PI_LOCAL_OK` and correctly identified the injected local lesson and its ID. OpenRouter/Sonnet 4.6 is saved as Pi's default. |
| Hosted Xchange | Outside the selected local setup | The user chose the local demo. The saved hosted token identifies as a Claude installation; it was not reused for Pi. Automatic approval review blocked the earlier hosted lesson fetch. |
| Atlas vectors and memory benefit | Not established | Local MongoDB uses recency fallback. Transport, a fixed evaluator score and a stored lesson do not establish improved model behavior. |

The first suite attempt was blocked by sandbox IPC restrictions before any
test executed. The authorized local rerun passed. The initial temporary Pi
runthrough's cleanup used the wrong harness response field (`active.version`);
it was corrected to `version`, the known smoke record reconciled, and the
complete transport/rollback check passed.

The initial Anthropic credential from the inherited environment returned HTTP
401 `Invalid bearer token`, despite a ready configuration check. The user chose
OpenRouter; its key was found in the specified personal 1Password vault and
configured as a command reference. The OpenAI browser flow was canceled when
the user changed provider. A fresh-process OpenRouter request succeeded; no
API key was printed or copied into a repository file. This proves a model
response with injected memory, not a measured learning improvement.

Local evidence files, excluded from Git:

- `.team-memory/local/pi-runthrough.json`: command and two-process transport results.
- `.team-memory/local/restart.json`: fresh-process persistence result.
- `.team-memory/local/persistence-before.json`: pre-restart local record snapshot.
- `/tmp/xchange-local-check.log`: complete 94-test/build/package output.
- `/tmp/xchange-pi-smoke.log`: failed model-authentication smoke call.
- `/tmp/xchange-openrouter-smoke.log`: successful OpenRouter model response with the local lesson.

These local reports are absent from a fresh clone; this dated summary is the
portable evidence. Re-run `npm run check:local` for fresh validation. Launch
`npm run pi:local` to use the configured model and local workspace. A fresh
machine needs its own model credentials; keep them in Pi's sign-in flow or
a secret-manager command reference.
