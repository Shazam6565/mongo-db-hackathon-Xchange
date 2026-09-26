# Local Pi and Xchange

Use Node 22.19+ and Pi **0.87.1**, matching the lockfile. From this checkout:

```sh
npm ci
npm install --global --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
pi --version
```

If npm's global bin directory is outside your PATH, add `$(npm prefix -g)/bin`
to your shell PATH. The checkout also provides Pi through `npm run pi:local`.

## Start the local workspace

The local commands use MongoDB at `127.0.0.1:27419`, database `xchange_local`,
and the `xchange-team/event-platform` scope. They explicitly override hosted
settings in `.env` and use the documented local demo token. The model provider
remains configured separately in Pi.

This workstation already has the `agent-foundation-mongo-1` replica running at
that address. Reuse it. On a machine without a local replica, create one:

```sh
docker run --name xchange-local-mongo -d \
  -p 127.0.0.1:27419:27419 -v xchange-local-mongo:/data/db \
  mongo:7.0 --replSet rs0 --bind_ip_all --port 27419
docker exec xchange-local-mongo mongosh --port 27419 --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27419"}]})'
```

Wait for MongoDB to become primary, then:

```sh
npm run seed:local
npm run dev:local
```

- Dashboard: <http://127.0.0.1:5173>
- API health: <http://127.0.0.1:4317/health>
- Data persists across API restarts in the separate local database.
- Seeding again preserves existing records and edits.
- Both checked-in corpora are seeded. To browse the Xchange project guides,
  stop the dev process and run `XCHANGE_LOCAL_PROJECT=xchange npm run dev:local`.

In a second terminal in this checkout:

```sh
npm run pi:local
```

Inside Pi, select your model with `/model`, or configure its provider with
`/login` if needed. Then run:

```text
/team-access
/ticket DEMO-118
/team-memory
```

`/team-access` must show **local** mode and `xchange-team/event-platform`.
Ask Pi to inspect the ticket with the retrieved lessons. `/share-lesson` and
the `share_lesson` tool publish immediately to this local database. Candidate
submission through the portable client instead requires evaluation to publish.
Use the [demo guide](demo.md) for the separate candidate/evaluation sequence.

The local launcher loads the extension for each session; a global extension
installation is unnecessary. A bare `pi` opens the general-purpose CLI.
`npm run pi:local -- --provider openrouter --model anthropic/claude-sonnet-4.6` explicitly
selects a model. All normal Pi arguments can follow `--`.

## OpenRouter on this workstation

Pi's saved default is **OpenRouter / `anthropic/claude-sonnet-4.6`**. Its private
credential configuration contains a command reference to the owner's personal
1Password API credential. The key is resolved when Pi needs it and is not
copied into the repository or Pi's configuration.

Keep the 1Password desktop app unlocked with CLI integration enabled. Check
availability without printing the key:

```sh
pi auth check --provider openrouter --json
```

Run `/model` to change models. In that picker, `Ctrl+S` saves the selected model
as the default for future sessions. A fresh machine needs its own credential
configuration; the workstation's private vault reference is not tracked here.

## Verify

```sh
npm run check:local
```

This runs the maintained-skill checks, all TypeScript/JavaScript tests (including
preview and real MongoDB tests), typecheck, production dashboard build, MCP
bundle, and plugin contract checks. The MongoDB tests create isolated random
databases and clean up their own fixtures.

The optional Phoenix adapter checks require the separate Phoenix checkout and
its Python environment; see [its instructions](../integrations/phoenix/README.md).
No local check establishes Atlas vector search, live Phoenix grants, or a
measured improvement from model memory. A provider authentication check also
does not prove a successful model response.

Hosted Xchange needs a separately enrolled Pi token. Do not reuse another
installation's token; follow [team access](team-access.md).
