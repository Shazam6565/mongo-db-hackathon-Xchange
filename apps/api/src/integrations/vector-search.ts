import type { Lesson, Scope } from "@team-memory/contracts";

export interface LessonRetriever {
  search(scope: Scope, query: string, limit: number): Promise<Lesson[]>;
}

// TODO: Embed the ticket text and query Atlas Vector Search.
// Filter by authorized teamId/projectId AND status=published before retrieval.
// Version and component compatibility must be checked before context injection.
// Index dimensions must match the selected embedding model; see infra/mongodb/README.md.
