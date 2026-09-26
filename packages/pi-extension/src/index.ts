import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemorySnapshotSchema, renderMemory, type CandidateInput } from "@team-memory/contracts";

const CUSTOM_TYPE = "team-memory-snapshot";

export default function teamMemoryExtension(pi: ExtensionAPI) {
  const apiUrl = (process.env.TEAM_API_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");
  const token = process.env.TEAM_API_TOKEN ?? "local-demo-token";

  async function api(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${apiUrl}/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Team memory API returned ${response.status}`);
    return response.json();
  }

  async function refresh(ctx: ExtensionContext): Promise<string> {
    const snapshot = MemorySnapshotSchema.parse(await api("/memory"));
    const memory = renderMemory(snapshot);
    const directory = join(ctx.cwd, ".team-memory");
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `MEMORY.${randomUUID()}.tmp`);
    await writeFile(temporary, memory, "utf8");
    await rename(temporary, join(directory, "MEMORY.md"));
    return memory;
  }

  pi.registerCommand("team-memory", {
    description: "Refresh the generated .team-memory/MEMORY.md from shared published lessons",
    handler: async (_args, ctx) => {
      await refresh(ctx);
      if (ctx.hasUI) ctx.ui.notify("Shared team memory refreshed.", "info");
    },
  });

  pi.registerCommand("share-lesson", {
    description: "Propose a lesson: /share-lesson Title | Lesson | TICKET-123",
    handler: async (args, ctx) => {
      const [title, lesson, ticket] = args.split("|").map((part) => part.trim());
      if (!title || !lesson || !ticket) throw new Error("Use: /share-lesson Title | Lesson | TICKET-123");
      const candidate: CandidateInput = {
        title, lesson, authorId: process.env.ENGINEER_ID ?? "engineer-a",
        appliesTo: [],
        evidence: [{ kind: "ticket", reference: ticket, summary: "Engineer-submitted candidate; evidence requires validation." }],
        proposedChange: { instructions: [lesson], verificationSteps: [], suggestedTools: [] },
      };
      await api("/lessons", candidate);
      if (ctx.hasUI) ctx.ui.notify("Candidate submitted. It will not be shared until validated and published.", "info");
    },
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    let content: string;
    try {
      content = `Shared project knowledge follows. Check applicability against the current ticket and code.\n${await refresh(ctx)}`;
    } catch {
      // Do not inject stale cached memory when the server cannot confirm current state.
      content = "Shared team memory is unavailable for this run. Continue with local context.";
      if (ctx.hasUI) ctx.ui.notify("Team memory unavailable; local work can continue.", "warning");
    }
    return { message: { customType: CUSTOM_TYPE, content, display: false } };
  });

  pi.on("context", async (event) => {
    // Keep one current snapshot so old/retracted lessons do not accumulate in context.
    const last = event.messages.findLastIndex((message) =>
      message.role === "custom" && message.customType === CUSTOM_TYPE);
    return { messages: event.messages.filter((message, index) =>
      message.role !== "custom" || message.customType !== CUSTOM_TYPE || index === last) };
  });

  // TODO: Extract evidence-backed candidates from tool_result and engineer corrections.
  // TODO: Subscribe to scoped SSE invalidations and refresh at a safe model-call boundary.
  // TODO: Apply evaluated harness versions (instructions, tool presets, verification steps).
}
