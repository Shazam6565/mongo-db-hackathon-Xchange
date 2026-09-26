import { execFile } from "node:child_process";
import type { FastifyInstance } from "fastify";

// Read-only commit history of the checkout the API process runs in, for the Timeline's Git
// layer. Author names and subjects only, never emails. A hosted function has no .git
// directory, so it reports the history as unavailable instead of failing.
export interface GitCommit { hash: string; at: string; author: string; subject: string }
export interface GitHistory { available: boolean; commits: GitCommit[]; remote: string | null; reason?: string }

const FIELD = "\x1f", RECORD = "\x1e";
function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile("git", ["-C", root, ...args], { timeout: 3000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
}
/** Only a public HTTPS GitHub URL is exposed; credentials and other hosts are dropped. */
export function githubUrl(remote: string): string | null {
  const match = /^(?:git@github\.com:|https:\/\/(?:[^@/\s]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}
export function parseLog(output: string): GitCommit[] {
  return output.split(RECORD).map(entry => entry.replace(/^\n/, "")).filter(Boolean).flatMap(entry => {
    const [hash, author = "", at = "", subject = ""] = entry.split(FIELD);
    return hash && /^[0-9a-f]{40}$/.test(hash) && Number.isFinite(Date.parse(at)) ? [{ hash, author, at: new Date(at).toISOString(), subject }] : [];
  });
}
export function registerGitHistory(api: FastifyInstance, root = process.cwd()) {
  let cached: { at: number; value: GitHistory } | null = null;
  api.get("/git", async () => {
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    let value: GitHistory;
    try {
      const log = await git(root, ["log", "--max-count=300", `--pretty=format:%H${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`]);
      const remote = await git(root, ["remote", "get-url", "origin"]).then(githubUrl, () => null);
      value = { available: true, commits: parseLog(log), remote };
    } catch {
      value = { available: false, commits: [], remote: null, reason: "Git history is available when the API runs in a repository checkout." };
    }
    cached = { at: Date.now(), value };
    return value;
  });
}
