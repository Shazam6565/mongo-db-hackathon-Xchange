import { spawn } from "node:child_process";
import { join } from "node:path";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [action, ...args] = process.argv.slice(2);
const mongo = "mongodb://127.0.0.1:27419/?directConnection=true";
// Override the root .env and private hosted credentials for every local process.
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: "4317",
  STORAGE_MODE: "mongodb",
  MONGODB_URI: mongo,
  MONGODB_GATE_URI: mongo,
  MONGODB_DATABASE: "xchange_local",
  MONGODB_LABEL: "Local MongoDB",
  TEAM_ID: "xchange-team",
  PROJECT_ID: process.env.XCHANGE_LOCAL_PROJECT || "event-platform",
  TEAM_API_URL: "http://127.0.0.1:4317",
  TEAM_API_TOKEN: "local-demo-token",
  TEAM_MEMORY_ENV: join(root, ".team-memory", "local", "credential.env"),
  TEAM_TICKET: "",
  ENGINEER_ID: `agent.${userInfo().username}.pi.local`,
};

const commands = {
  dev: ["npm", ["run", "dev", ...args]],
  pi: [process.execPath, [
    join(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
    "--extension", join(root, "packages/pi-extension/src/index.ts"), ...args,
  ]],
  seed: [process.execPath, ["--import", "tsx", "apps/api/src/seed.ts",
    "corpus/xchange.json", "corpus/event-platform.json", ...args]],
  check: ["npm", ["run", "check", ...args]],
};
if (!Object.hasOwn(commands, action)) {
  console.error("Usage: node scripts/local.mjs dev|pi|seed|check [arguments]");
  process.exit(1);
}
const [command, commandArgs] = commands[action];
const child = spawn(command, commandArgs, { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(`Local ${action} failed: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
