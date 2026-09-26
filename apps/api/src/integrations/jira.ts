// Adapter contract only. The MVP can use fixtures until Jira credentials exist.
export interface Ticket {
  key: string;
  summary: string;
  description: string;
  component: string | null;
  acceptanceCriteria: string[];
}

export interface TicketSource {
  getTicket(key: string): Promise<Ticket>;
  proposeTriage(key: string, changes: Pick<Ticket, "component" | "acceptanceCriteria">): Promise<void>;
}

// TODO: Jira REST v3 implementation; map descriptions to Atlassian Document Format.
// Keep proposed changes visible before writing them to a live issue.
