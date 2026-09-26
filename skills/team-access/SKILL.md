---
name: team-access
description: Onboard teammates or agent installations to the Xchange API, inspect their identity and scope, or rotate and revoke individual credentials. Use for workspace access; not for creating Atlas infrastructure accounts.
---

# Team and agent access

Read [the access contract](../../docs/team-access.md) for credential preparation,
enrollment, roles, verification and offboarding. Run commands from the repository
root. The reusable issuer is `npm run access:issue -- --help`; the client is
`node skills/team-memory/scripts/client.mjs access`.

Distinguish three operations: preparing a credential privately, enrolling its hash
in a deployed server's grants, and verifying that the intended identity can access
that server. A generated file or Git push completes only its own step. Finish
authorized local preparation; report any missing external configuration explicitly.

Use one stable actor per person and a separate actor per agent installation. The
issuer defaults to reader; choose writer when the intended work includes records
or canvases. Evaluator credentials belong only to authorized evaluation operators.
Store a private roster connecting actors to their owners and purposes. Do not
invent teammate identities or distribute credentials to unrequested recipients.

The backend owns `MONGODB_URI`; clients receive only their own `TEAM_API_URL` and
`TEAM_API_TOKEN`. Use the owner's approved private credential destination/channel.
The issuer requires a new absolute output directory outside the checkout, writes
private files, and never prints the token. It does not enroll the grant. Merge the
new hash into server grants without replacing other members, then apply the owner's
authorized deployment workflow from [live hosting](../../docs/frontend-sharing.md).

Inspect access before troubleshooting writes: confirm `mode`, actor, role and
team/project. Remote access must report `team`. Local owner mode is not teammate
authentication. A 401 concerns credentials; a 403 is an operation/role boundary;
a 503 concerns configuration or storage. Do not broaden roles or network access
merely to make a diagnostic pass. Browser sign-in and agent bearer access should
resolve to their separate enrolled identities.

For rotation, keep the actor stable and replace the credential hash. For revocation,
remove the relevant hashes and redeploy. Old deployments can retain old grants;
retire or protect them within the authorized change. Verify both token and session
revocation on the affected deployment without exposing their values. Signing out
does not revoke a token. Preserve other actors and their records.

For normal record operations use [team-memory](../team-memory/SKILL.md). No Atlas
administration account or direct database connection is needed for those clients.
