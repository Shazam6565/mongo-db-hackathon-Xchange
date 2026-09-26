import { mkdir, writeFile, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ENGINEER_ID_HEADER, MemorySnapshotSchema, renderMemory, type CandidateInput, type MemorySnapshot, type Ticket,
} from "@team-memory/contracts";

const CUSTOM_TYPE = "team-memory-snapshot";
// Session entry recording the ticket this session works on. Kept out of model context.
const TICKET_ENTRY = "team-memory-ticket";

// The team's hosted workspace. A local owner API needs TEAM_API_URL=http://127.0.0.1:4317.
export const HOSTED_API_URL = "https://mongo-db-hackathon-xchange.vercel.app";
const SETTING_KEYS = ["TEAM_API_URL", "TEAM_API_TOKEN", "ENGINEER_ID", "TEAM_TICKET"] as const;
type Settings = Partial<Record<(typeof SETTING_KEYS)[number], string>>;

// Settings come from the Pi process environment, falling back to a private credential file:
// TEAM_MEMORY_ENV, or ~/.team-memory/credential.env (the file `npm run access:issue` creates).
// Only the keys above are read, so a file with other secrets does not leak into the extension.
export function loadSettings(env: NodeJS.ProcessEnv = process.env): { settings: Settings; source: string | null } {
  const file = env.TEAM_MEMORY_ENV?.trim() || join(homedir(), ".team-memory", "credential.env");
  const fromFile: Settings = {};
  let source: string | null = null;
  if (existsSync(file)) {
    source = file;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      const key = match?.[1] as (typeof SETTING_KEYS)[number] | undefined;
      if (!key || !SETTING_KEYS.includes(key)) continue;
      fromFile[key] = match![2]!.replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const settings: Settings = {};
  for (const key of SETTING_KEYS) {
    const value = env[key]?.trim() || fromFile[key]?.trim();
    if (value) settings[key] = value;
  }
  return { settings, source };
}

// Tokens go only to HTTPS origins, or plain HTTP on this machine for the local owner API.
export function resolveApiUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !["/", ""].includes(url.pathname)) {
    throw new Error("TEAM_API_URL must be an origin such as https://team.example.app, without a path, query or credentials.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Use HTTPS for a remote TEAM_API_URL.");
  return url.origin;
}

type ShareArguments = {
  title: string; lesson: string; appliesTo?: string[]; ticket?: string; evidence?: string; verificationSteps?: string[]; replaces?: string[];
};
const ARRAY_KEYS = ["appliesTo", "verificationSteps", "replaces"] as const;
const TEXT_KEYS = ["ticket", "evidence"] as const;

// Some models flatten later arguments into an earlier list, e.g.
// verificationSteps: ["step", "appliesTo", "notifications", "replaces", "<id>"].
// Split such lists at argument names so those values are not silently lost.
export function repairFlattenedArguments(input: ShareArguments): ShareArguments {
  const names = new Set<string>([...ARRAY_KEYS, ...TEXT_KEYS]);
  const result: ShareArguments = { ...input };
  for (const key of ARRAY_KEYS) {
    const items = input[key];
    if (!items?.some((item) => names.has(item.trim()))) continue;
    const parts: Record<string, string[]> = { [key]: [] };
    let current: string = key;
    for (const item of items) {
      if (names.has(item.trim())) { current = item.trim(); parts[current] ??= []; continue; }
      parts[current]!.push(item);
    }
    result[key] = parts[key];
    for (const [name, values] of Object.entries(parts)) {
      if (name === key || values.length === 0) continue;
      if ((ARRAY_KEYS as readonly string[]).includes(name)) {
        const arrayKey = name as (typeof ARRAY_KEYS)[number];
        result[arrayKey] = [...(result[arrayKey] ?? []), ...values];
      } else {
        const textKey = name as (typeof TEXT_KEYS)[number];
        result[textKey] ||= values.join(" ");
      }
    }
  }
  return result;
}

export default function teamMemoryExtension(pi: ExtensionAPI) {
  const { settings, source } = loadSettings();
  let apiUrl: string | null = null;
  let configError: string | null = null;
  try { apiUrl = resolveApiUrl(settings.TEAM_API_URL ?? HOSTED_API_URL); }
  catch (error) { configError = error instanceof Error ? error.message : "Invalid TEAM_API_URL."; }
  const remote = apiUrl !== null && apiUrl.startsWith("https:");
  // The local demo token only works against a local owner API; a remote team API needs a real token.
  const token = settings.TEAM_API_TOKEN ?? (remote ? undefined : "local-demo-token");
  if (!configError && !token) configError = "Set TEAM_API_TOKEN (or add it to your team-memory credential file).";
  // Local owner-mode label only; a hosted API derives identity from the token.
  const engineerId = (settings.ENGINEER_ID ?? userInfo().username).replace(/[^\w.-]/g, "-").slice(0, 100) || "engineer";
  // Optional starting ticket; /ticket changes it for the session.
  let ticketKey: string | null = settings.TEAM_TICKET ?? null;

  async function api(path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    if (configError || !apiUrl || !token) throw new Error(`Team memory is not configured: ${configError ?? "missing API settings"}`);
    const response = await fetch(`${apiUrl}/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        // Consumption label for the audit log. The API token still decides access.
        [ENGINEER_ID_HEADER]: engineerId,
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // Vector search embeds the query in Atlas, and a hosted API may cold-start.
      signal: AbortSignal.timeout(10000),
      // Never follow a redirect with the bearer token.
      redirect: "error",
    });
    if (!response.ok) {
      const hint = response.status === 401 ? " (token missing, invalid or revoked)" : response.status === 403 ? " (your role does not allow this)" : "";
      throw new Error(`Team memory API returned ${response.status}${hint}`);
    }
    return response.json();
  }

  pi.registerCommand("team-access", {
    description: "Show which team API, identity, role and project this Pi session uses",
    handler: async (_args, ctx) => {
      const access = await api("/access") as { mode: string; actorId: string; role: string; scope: { teamId: string; projectId: string } };
      const message = `${apiUrl} · ${access.mode} mode · ${access.actorId} (${access.role}) · ${access.scope.teamId}/${access.scope.projectId}` +
        (source ? ` · settings from ${source}` : "");
      if (remote && access.mode !== "team") throw new Error("This remote API is not using team authentication. Do not use it.");
      if (ctx.hasUI) ctx.ui.notify(message, "info");
    },
  });

  function showTicket(ctx: ExtensionContext) {
    if (ctx.hasUI) ctx.ui.setStatus("team-memory", ticketKey ? `ticket ${ticketKey}` : undefined);
  }

  // Semantic search when there is something to search for; otherwise the recent snapshot.
  async function fetchMemory(query: string): Promise<MemorySnapshot> {
    const text = query.trim();
    if (!text && !ticketKey) return MemorySnapshotSchema.parse(await api("/memory"));
    return MemorySnapshotSchema.parse(await api("/memory/search", {
      query: text || "Current ticket",
      ...(ticketKey ? { ticketKey } : {}),
    }));
  }

  async function refresh(ctx: ExtensionContext, query: string): Promise<{ memory: string; snapshot: MemorySnapshot }> {
    const snapshot = await fetchMemory(query);
    const memory = renderMemory(snapshot);
    const directory = join(ctx.cwd, ".team-memory");
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `MEMORY.${randomUUID()}.tmp`);
    await writeFile(temporary, memory, "utf8");
    await rename(temporary, join(directory, "MEMORY.md"));
    return { memory, snapshot };
  }

  pi.on("session_start", async (_event, ctx) => {
    // Restore the ticket chosen on this branch, so resume/fork keep the right context.
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === TICKET_ENTRY) {
        const data = entry.data as { key?: string | null } | undefined;
        ticketKey = data?.key ?? null;
      }
    }
    showTicket(ctx);
    if (configError && ctx.hasUI) ctx.ui.notify(`Team memory is not configured: ${configError}`, "warning");
  });

  pi.registerCommand("ticket", {
    description: "Set the ticket this session works on: /ticket DEMO-118 (or /ticket clear)",
    handler: async (args, ctx) => {
      const wanted = args.trim();
      if (!wanted) {
        if (ctx.hasUI) ctx.ui.notify(ticketKey ? `Current ticket: ${ticketKey}` : "No ticket set. Use /ticket KEY.", "info");
        return;
      }
      if (wanted.toLowerCase() === "clear") {
        ticketKey = null;
        pi.appendEntry(TICKET_ENTRY, { key: null });
        showTicket(ctx);
        if (ctx.hasUI) ctx.ui.notify("Ticket cleared. Memory search uses your messages only.", "info");
        return;
      }
      const { tickets } = await api("/tickets") as { tickets: Ticket[] };
      const ticket = tickets.find((item) => item.key.toLowerCase() === wanted.toLowerCase());
      if (!ticket) throw new Error(`Ticket ${wanted} is not in this project.`);
      ticketKey = ticket.key;
      pi.appendEntry(TICKET_ENTRY, { key: ticket.key });
      showTicket(ctx);
      if (ctx.hasUI) ctx.ui.notify(`Working on ${ticket.key}: ${ticket.summary}`, "info");
    },
  });

  pi.registerCommand("team-memory", {
    description: "Refresh .team-memory/MEMORY.md: /team-memory [search text]; uses the current ticket",
    handler: async (args, ctx) => {
      const { snapshot } = await refresh(ctx, args);
      const mode = snapshot.retrieval?.mode === "vector" ? "vector search" : "recent lessons";
      if (ctx.hasUI) ctx.ui.notify(`Shared team memory refreshed (${mode}, ${snapshot.lessons.length} lesson${snapshot.lessons.length === 1 ? "" : "s"}).`, "info");
    },
  });

  // Publishes immediately to shared memory in MongoDB. There is no review step.
  async function shareLesson(raw: {
    title: string; lesson: string; appliesTo?: string[]; ticket?: string; evidence?: string; verificationSteps?: string[]; replaces?: string[];
  }): Promise<{ id: string; title: string }> {
    const input = repairFlattenedArguments(raw);
    const reference = input.ticket?.trim() || ticketKey || "unspecified";
    const candidate: CandidateInput = {
      title: input.title.trim().slice(0, 160),
      lesson: input.lesson.trim().slice(0, 4000),
      authorId: engineerId,
      appliesTo: (input.appliesTo ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 20),
      evidence: [{
        kind: "ticket", reference,
        summary: (input.evidence?.trim() || "Shared by an agent while working on this ticket; not independently verified.").slice(0, 2000),
      }],
      proposedChange: {
        instructions: [input.lesson.trim().slice(0, 2000)],
        verificationSteps: (input.verificationSteps ?? []).map((step) => step.trim().slice(0, 500)).filter(Boolean).slice(0, 10),
        suggestedTools: [],
      },
    };
    const replaces = (input.replaces ?? []).map((id) => id.trim()).filter(Boolean).slice(0, 10);
    return await api("/lessons/share", { ...candidate, replaces }, { "idempotency-key": randomUUID() }) as { id: string; title: string };
  }

  pi.registerTool({
    name: "share_lesson",
    label: "Share lesson",
    description: "Publish a reusable lesson to the team's shared memory in MongoDB. Every engineer's agent receives it on their next message.",
    promptSnippet: "share_lesson: publish a reusable, confirmed finding to the team's shared memory",
    promptGuidelines: [
      "When you confirm something another engineer would benefit from (a root cause, a check that mattered, a wrong assumption that was corrected), call share_lesson once with a short title and 1-3 actionable sentences.",
      "Share only findings confirmed by code, tests, logs or the engineer. Do not share secrets, credentials, private conversation or speculation. Do not re-share a lesson already in shared team memory.",
      "If a finding corrects or updates a lesson already in shared team memory, share the corrected lesson and pass the outdated lesson's ID in replaces, so no agent keeps loading the old version.",
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 160, description: "Short, specific title" }),
      lesson: Type.String({ minLength: 1, maxLength: 4000, description: "What to do or check, and when it applies" }),
      appliesTo: Type.Optional(Type.Array(Type.String(), { maxItems: 20, description: "Components it applies to, e.g. notifications" })),
      ticket: Type.Optional(Type.String({ description: "Ticket key; defaults to the session's current ticket" })),
      evidence: Type.Optional(Type.String({ maxLength: 2000, description: "What confirmed it: test, log, file or engineer statement" })),
      verificationSteps: Type.Optional(Type.Array(Type.String(), { maxItems: 10, description: "Steps to confirm the lesson applies" })),
      replaces: Type.Optional(Type.Array(Type.String(), { maxItems: 10, description: "IDs of shared-memory lessons this one corrects; they stop being loaded" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const shared = await shareLesson(params);
      if (ctx.hasUI) ctx.ui.notify(`Shared with the team: ${shared.title}`, "info");
      return {
        content: [{ type: "text", text: `Published lesson ${shared.id} to shared team memory. Other agents receive it on their next message.` }],
        details: undefined,
      };
    },
  });

  pi.registerCommand("share-lesson", {
    description: "Publish a lesson to shared memory: /share-lesson Title | Lesson | TICKET-123 [| component, component]",
    handler: async (args, ctx) => {
      const [title, lesson, ticket, appliesTo] = args.split("|").map((part) => part.trim());
      if (!title || !lesson) throw new Error("Use: /share-lesson Title | Lesson | TICKET-123 [| component, component]");
      const shared = await shareLesson({ title, lesson, ticket, appliesTo: appliesTo?.split(",") });
      if (ctx.hasUI) ctx.ui.notify(`Shared with the team: ${shared.title}`, "info");
    },
  });

  // Runs once per user message: retrieve lessons relevant to the ticket and this message.
  pi.on("before_agent_start", async (event, ctx) => {
    let content: string;
    try {
      const { memory, snapshot } = await refresh(ctx, event.prompt);
      content = `Shared project knowledge follows. Check applicability against the current ticket and code.\n${memory}`;
      if (snapshot.retrieval?.mode === "recent" && ctx.hasUI) {
        ctx.ui.notify("Team memory is not ranked for this message (vector search unavailable); using recent lessons.", "warning");
      }
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

  // TODO: Send scoped ticket observations/change events to the API for MongoDB storage
  // and display in apps/dashboard. Logging an observation must not automatically publish it.
  // TODO: Extract evidence-backed candidates from tool_result and engineer corrections.
  // TODO: Subscribe to scoped SSE invalidations and refresh at a safe model-call boundary.
  // TODO: Apply evaluated harness versions (instructions, tool presets, verification steps).
}
