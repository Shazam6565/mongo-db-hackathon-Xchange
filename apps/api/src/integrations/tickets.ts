import type { Scope, Ticket } from "@team-memory/contracts";

// Planned API/storage boundary for the team's own ticket frontend.
export interface TicketRepository {
  list(scope: Scope): Promise<Ticket[]>;
  getTicket(scope: Scope, key: string): Promise<Ticket | null>;
  proposeTriage(scope: Scope, key: string, changes: Pick<Ticket, "component" | "acceptanceCriteria">): Promise<void>;
}

// TODO: MongoDB persistence and scoped ticket routes for frontend/ and Pi.
// Record proposals in the change log; they do not imply a ticket was already updated.
