import type { AgentChange, AgentChangeInput, Scope } from "@team-memory/contracts";

// Planned append-only history of changes an agent observes or proposes for a ticket.
export interface AgentChangeRepository {
  append(scope: Scope, input: AgentChangeInput): Promise<AgentChange>;
  list(scope: Scope, ticketKey?: string): Promise<AgentChange[]>;
}

// TODO: POST/GET /v1/agent-changes backed by MongoDB's agent_changes collection.
// Derive scope/identity from authenticated context and deduplicate agent event retries.
// The upcoming frontend/ reads this history through the API, not directly from MongoDB.
// Recording an observation does not publish a shared lesson or apply a ticket change.
