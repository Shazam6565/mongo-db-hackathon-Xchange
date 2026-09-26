export interface MemoryChangeEvent {
  type: "memory.updated";
  lessonId: string;
  version: number;
  resumeToken: string;
}

// TODO: MongoDB Change Stream -> authenticated, scoped SSE subscribers.
// Send invalidation events, then let the extension refetch the current snapshot.
// Resume after disconnect; if the token expires, perform a full snapshot refresh.
// The skeleton refreshes on each agent run and on /team-memory, not via live push.
