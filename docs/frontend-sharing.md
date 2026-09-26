# Share the frontend

Use Vercel for the first public frontend preview. Kiro credits pay for coding-agent work; confirm separately if the event also supplied AWS hosting credits.

The preview reuses the working Catalog and Canvas screens. A separate Vite build replaces their API client with a bundled synthetic ticket, lesson and canvas. It does not load environment files, read the local API, connect to MongoDB, or expose the owner token. Writes fail with an explicit read-only message; the preview hides Add ticket and Save buttons. Canvas layout drafts can be explored and discarded. The banner explains which layers are connected.

## Check locally

From the repository root:

```bash
npm run typecheck
node --import tsx --test apps/dashboard/preview/api.test.ts
npm exec vite -- build --config apps/dashboard/vite.preview.config.ts
npm exec vite -- preview --config apps/dashboard/vite.preview.config.ts --host 127.0.0.1 --port 5181
```

Open `http://127.0.0.1:5181/` for Catalog and `http://127.0.0.1:5181/?view=canvas` for the sample Canvas. Filter records, open the lesson evidence, follow the ticket link from the canvas, and reload a deep link. The Network panel should contain no `/api` requests.

## Publish

Create or select a Vercel project under the owner's chosen account/team. Import this repository with **Root Directory set to the repository root**; `vercel.json` contains the build and output settings. Use Node 22. No environment variables are required for this preview. No paid upgrade is required by the implementation; check the selected account's limits before publishing.

The deployed source must include the current Canvas implementation and `packages/contracts/src/canvas.ts`, which are being developed in the shared checkout. Do not deploy an older remote revision that lacks those files. The hosting task must not stage another session's changes.

Share the stable production project URL for ongoing work. Use `/?view=canvas` to link directly to Canvas and the existing `?item=...` links for records. Confirm the published URL loads in a signed-out browser; preview deployments may require Vercel authentication depending on the project's protection settings. Subsequent authorized pushes to the connected production branch can update the same URL. Roll back by promoting the previous working deployment in Vercel.

Deployment is pending: `dev env identity /Users/fxbc/code/labs/mongo-db-hackathon-Xchange --check` reports `profile=none (explicit neutral boundary)`. Choose the owning Vercel account/team and establish its scoped deployment access before creating provider resources. No Vercel project or URL has been created by this setup.

## Connect the next layers

Keep the existing local application build for connected development. For the shared live application, add remote user authentication and team membership, deploy the API with server-only MongoDB credentials, then connect the frontend to that authenticated API. Host persistent agent/evaluation workers separately from the static frontend. Prove a remote ticket-to-lesson run before describing the public preview as a live learning system.

References: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Kiro credits](https://kiro.dev/pricing/).
