# Team memory for Pi

A [Pi](https://pi.dev/) extension that gives every engineer's agent the same shared team memory,
stored in MongoDB Atlas.

- **Reads:** before each message, the agent receives the project's published lessons. They are
  ordered by Atlas Vector Search relevance to your current ticket and message, and written to
  `.team-memory/MEMORY.md` in the folder where Pi runs.
- **Writes:** when the agent confirms a reusable finding, it calls its `share_lesson` tool. The
  lesson is published immediately, and every teammate's agent receives it on their next message.
  There is no review step.

The extension talks only to the team API. It never needs a MongoDB connection string.

## Requirements

- Node.js 22 and Pi 0.87.1 (the version in this repository's lockfile).
- A model provider already configured in Pi.
- A team API URL and your own team token from the owner. See [team access](../../docs/team-access.md).
  Use a `writer` token so the agent can share lessons; a `reader` token can only read memory.

## Install

```sh
git clone https://github.com/Shazam6565/mongo-db-hackathon-Xchange.git
cd mongo-db-hackathon-Xchange
npm ci
pi install ./packages/pi-extension
```

`pi install` with a local path loads the extension from this checkout without copying it, and
keeps it enabled for every Pi session. After `git pull`, run `npm ci` again if dependencies changed.
To try it once without installing, run `pi -e ./packages/pi-extension` from the checkout instead.
Remove it with `pi remove ./packages/pi-extension`.

## Configure

Put your settings in a private file at `~/.team-memory/credential.env`
(Windows: `%USERPROFILE%\.team-memory\credential.env`). The `credential.env` created by
`npm run access:issue` already has the right format; copy it there.

```sh
TEAM_API_URL=https://your-team-api.example
TEAM_API_TOKEN=your-personal-token
# Optional
TEAM_TICKET=XCH-4
ENGINEER_ID=your-name
```

| Setting | Meaning |
| --- | --- |
| `TEAM_API_URL` | Team API origin. Must be HTTPS, except `http://127.0.0.1:4317` for a local owner API |
| `TEAM_API_TOKEN` | Your personal team token. Required for a remote API |
| `TEAM_TICKET` | Ticket to start each session on; change it with `/ticket` |
| `ENGINEER_ID` | Label for a local owner API. Defaults to your OS user name. A hosted API ignores it and uses your token's identity |
| `TEAM_MEMORY_ENV` | Path to a different credential file |

Environment variables set in the terminal take precedence over the file. The extension reads
only the keys above from the file. Keep the file out of Git, chat and screenshots.

## Check the connection

Start `pi` and run:

```text
/team-access
```

It shows the API, your identity and role, and the team/project scope. A remote API must report
`team` mode.

## Use it

| In Pi | What it does |
| --- | --- |
| `/ticket XCH-4` | Set the ticket this session works on; memory is ordered by relevance to it. `/ticket clear` removes it |
| `/team-memory [text]` | Refresh `.team-memory/MEMORY.md` now, optionally for a search text |
| `share_lesson` tool | The agent shares confirmed findings by itself. You can also ask: "share that as a lesson". When a finding corrects an existing lesson, the agent can pass that lesson's ID in `replaces`; the old lesson becomes `superseded` and stops loading. When lessons conflict, agents are told to trust the most recent one |
| `/share-lesson Title \| Lesson \| TICKET-1 [\| component, component]` | Share a lesson by hand |

Share only confirmed findings. A shared lesson reaches the whole project immediately, and the
audit log records who shared it.

## Troubleshooting

| Message | Cause |
| --- | --- |
| Team memory is not configured | `TEAM_API_URL` is not HTTPS, or `TEAM_API_TOKEN` is missing |
| API returned 401 | Token missing, invalid or revoked; ask the owner |
| API returned 403 | Your role cannot do this, for example a reader sharing a lesson |
| Team memory unavailable | API unreachable or timed out; local work continues without memory |
| Not ranked for this message | Vector search is unavailable (free Atlas tiers allow about 3 queries per minute); lessons arrive in publication order |

Memory is per project: you see lessons shared in the project your token is scoped to.

## Development

Run a local owner API from the repository root (`npm run dev:api`) with a MongoDB URI in the
root `.env`, then use `TEAM_API_URL=http://127.0.0.1:4317` and that `.env`'s `TEAM_API_TOKEN`.
`npm test` includes this package's tests. See [MongoDB setup](../../infra/mongodb/README.md)
for the Atlas Vector Search index (`npm run vector:setup`).
