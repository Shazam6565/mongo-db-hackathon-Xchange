import { randomUUID } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";
import type { CandidateInput, Lesson, Scope } from "@team-memory/contracts";

export interface LessonRepository {
  list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]>;
  propose(scope: Scope, input: CandidateInput): Promise<Lesson>;
  close(): Promise<void>;
}

function makeCandidate(scope: Scope, input: CandidateInput): Lesson {
  const now = new Date().toISOString();
  return {
    ...input, ...scope, id: randomUUID(), status: "candidate", version: 1,
    origin: "submitted", createdAt: now, updatedAt: now,
  };
}

export class InMemoryLessonRepository implements LessonRepository {
  private readonly lessons: Lesson[];
  constructor(seed: Lesson[] = []) { this.lessons = structuredClone(seed); }

  async list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]> {
    return structuredClone(this.lessons
      .filter((lesson) => lesson.teamId === scope.teamId && lesson.projectId === scope.projectId)
      .filter((lesson) => !status || lesson.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100));
  }

  async propose(scope: Scope, input: CandidateInput): Promise<Lesson> {
    const candidate = makeCandidate(scope, input);
    this.lessons.push(candidate);
    return structuredClone(candidate);
  }

  async close(): Promise<void> {}
}

export class MongoLessonRepository implements LessonRepository {
  private constructor(private readonly client: MongoClient, private readonly lessons: Collection<Lesson>) {}

  static async connect(uri: string, database: string): Promise<MongoLessonRepository> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      const lessons = client.db(database).collection<Lesson>("lessons");
      await lessons.createIndex({ id: 1 }, { unique: true });
      await lessons.createIndex({ teamId: 1, projectId: 1, status: 1, updatedAt: -1 });
      return new MongoLessonRepository(client, lessons);
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async list(scope: Scope, status?: Lesson["status"]): Promise<Lesson[]> {
    return this.lessons.find(
      { ...scope, ...(status ? { status } : {}) },
      { projection: { _id: 0 } },
    ).sort({ updatedAt: -1 }).limit(100).toArray();
  }

  async propose(scope: Scope, input: CandidateInput): Promise<Lesson> {
    const candidate = makeCandidate(scope, input);
    await this.lessons.insertOne({ ...candidate });
    return candidate;
  }

  async close(): Promise<void> { await this.client.close(); }
}
