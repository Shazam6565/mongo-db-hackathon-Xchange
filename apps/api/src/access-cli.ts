import { randomBytes } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { hashTeamToken, validateTeamAuthConfig, type TeamRole } from "./auth.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
class AccessSetupError extends Error {}

/** Prepare one private credential for owner enrollment; never contacts a provider. */
export async function issueCredential(input: { actor: string; role: string; origin: string; out: string }) {
  if (!isAbsolute(input.out)) throw new AccessSetupError("Use an absolute output directory outside the repository.");
  const token = randomBytes(32).toString("base64url");
  const grant = { actorId: input.actor, role: input.role as TeamRole, tokenHash: hashTeamToken(token) };
  let origin: string;
  try {
    origin = validateTeamAuthConfig({ grants: [grant], publicOrigin: input.origin, sessionSecret: "validation-only-not-a-deployment-secret" }).publicOrigin;
  } catch { throw new AccessSetupError("Use a valid actor ID, reader/writer/evaluator role, and HTTPS origin without a path or credentials."); }

  // Resolve the existing parent to prevent a symlink from routing secrets into Git.
  const output = resolve(input.out);
  const parent = await realpath(dirname(output));
  const destination = resolve(parent, basename(output));
  const root = await realpath(repositoryRoot);
  const fromRoot = relative(root, destination);
  if (!fromRoot || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`))) {
    throw new AccessSetupError("Credential files must be outside the repository, including through symlinks.");
  }
  // Exclusive creation refuses overwrites, including an existing symlink at destination.
  await mkdir(destination, { mode: 0o700 });
  await writeFile(resolve(destination, "credential.env"), `TEAM_API_URL=${origin}\nTEAM_API_TOKEN=${token}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(resolve(destination, "grant.json"), `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { directory: destination, actorId: grant.actorId, role: grant.role };
}

export async function main(args: string[]) {
  try {
    const { values } = parseArgs({ args, options: {
      actor: { type: "string" }, role: { type: "string", default: "reader" },
      origin: { type: "string" }, out: { type: "string" }, help: { type: "boolean" },
    }, strict: true, allowPositionals: false });
    if (values.help) {
      console.log("npm run access:issue -- --actor teammate.alex --role writer --origin https://your-app.example --out /absolute/private/new-directory\nRole defaults to reader. The output parent must exist. No tokens are printed; enrollment requires adding grant.json to server grants and redeploying.");
      return;
    }
    if (!values.actor || !values.origin || !values.out) throw new AccessSetupError("Required options: --actor, --origin, --out. Use --help for instructions.");
    const result = await issueCredential({ actor: values.actor, role: values.role!, origin: values.origin, out: values.out });
    console.log(`Prepared ${result.role} credential for ${result.actorId}.\nPrivate files: ${result.directory}\nAdd grant.json to TEAM_ACCESS_GRANTS and redeploy before distributing credential.env. No access has been activated.`);
  } catch (error) {
    console.error(error instanceof AccessSetupError ? error.message : "Credential preparation failed. Check options, an existing parent directory, and a new output directory. No existing credentials were overwritten; inspect any partial output privately.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main(process.argv.slice(2));
