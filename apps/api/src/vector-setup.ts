// Prepares Atlas Vector Search with Automated Embedding for lesson retrieval.
//   npm run vector:setup                   backfill searchText, create/update the index
//   npm run vector:setup -- --wait         ...and wait until the index is queryable
//   npm run vector:setup -- --probe "text" ...and print the top matches with raw scores
// Atlas generates the Voyage embeddings; this script never handles a model API key.
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { MongoClient, type Document } from "mongodb";
import { lessonSearchText, type Lesson } from "@team-memory/contracts";
import { loadConfig } from "./config.js";

export function vectorIndexDefinition(model: string): Document {
  return {
    fields: [
      { type: "autoEmbed", modality: "text", path: "searchText", model },
      // Filter fields let $vectorSearch pre-filter by scope and publication status.
      { type: "filter", path: "teamId" },
      { type: "filter", path: "projectId" },
      { type: "filter", path: "status" },
    ],
  };
}

type IndexInfo = { name: string; status?: string; queryable?: boolean; latestDefinition?: Document };

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
  const settings = loadConfig(process.env);
  if (settings.mode !== "mongodb" || !settings.uri) throw new Error("vector:setup requires STORAGE_MODE=mongodb and MONGODB_URI.");
  const { index, model } = settings.vector;
  const client = new MongoClient(settings.uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const lessons = client.db(settings.database).collection<Lesson & { searchText?: string }>("lessons");

    // 1. Backfill. Updating only changed text avoids needless re-embedding.
    let updated = 0;
    for await (const lesson of lessons.find({}, { projection: { _id: 0 } })) {
      const text = lessonSearchText(lesson);
      if (lesson.searchText === text) continue;
      await lessons.updateOne({ id: lesson.id }, { $set: { searchText: text } });
      updated += 1;
    }
    console.log(`searchText: ${updated} lesson${updated === 1 ? "" : "s"} updated.`);

    // 2. Create the index, or update it when the model changed.
    const definition = vectorIndexDefinition(model);
    const [existing] = await lessons.listSearchIndexes(index).toArray() as IndexInfo[];
    if (!existing) {
      await lessons.createSearchIndex({ name: index, type: "vectorSearch", definition });
      console.log(`index ${index}: created with ${model}.`);
    } else if (JSON.stringify(existing.latestDefinition?.fields) !== JSON.stringify(definition.fields)) {
      await lessons.updateSearchIndex(index, definition);
      console.log(`index ${index}: definition updated to ${model}.`);
    } else {
      console.log(`index ${index}: up to date (${existing.status ?? "unknown status"}).`);
    }

    // 3. Optionally wait for the initial embedding build.
    if (process.argv.includes("--wait") || argument("--probe")) {
      const deadline = Date.now() + 5 * 60_000;
      for (;;) {
        const [info] = await lessons.listSearchIndexes(index).toArray() as IndexInfo[];
        if (info?.queryable) { console.log(`index ${index}: queryable (${info.status}).`); break; }
        if (Date.now() > deadline) throw new Error(`Index ${index} is not queryable after 5 minutes (status ${info?.status ?? "missing"}).`);
        console.log(`index ${index}: ${info?.status ?? "pending"}; waiting...`);
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }

    // 4. Optionally show the relevance order for a query. Uses one query embedding.
    const probe = argument("--probe");
    if (probe) {
      const results = await lessons.aggregate<{ title: string; score: number }>([
        { $vectorSearch: { index, path: "searchText", query: { text: probe }, numCandidates: 50, limit: 5,
          filter: { $and: [{ teamId: { $eq: settings.scope.teamId } }, { projectId: { $eq: settings.scope.projectId } }, { status: { $eq: "published" } }] } } },
        { $project: { _id: 0, title: 1, score: { $meta: "vectorSearchScore" } } },
      ]).toArray();
      console.log(`probe in ${settings.scope.teamId}/${settings.scope.projectId}:`);
      for (const item of results) console.log(`  ${item.score.toFixed(4)}  ${item.title}`);
      if (results.length === 0) console.log("  no published lessons matched.");
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`vector:setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
