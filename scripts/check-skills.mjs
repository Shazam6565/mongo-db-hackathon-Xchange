import assert from "node:assert/strict";
import { readdir, readFile, readlink, realpath, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "skills");
const catalog = await readFile(join(source, "README.md"), "utf8");
const names = (await readdir(source, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.ok(names.length, "No maintained skills found");
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(file); continue; }
    if (!/\.(md|yaml)$/.test(entry.name)) continue;
    const content = await readFile(file, "utf8");
    assert.ok(!/(?:\/Users\/|\/home\/|~\/\.codex\/skills)/.test(content), `${relative(root, file)} requires a personal path`);
    if (!entry.name.endsWith(".md")) continue;
    for (const match of content.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      assert.ok(!isAbsolute(target), `${relative(root, file)} links to an absolute path`);
      const resolved = await realpath(resolve(dirname(file), target));
      const within = relative(root, resolved);
      assert.ok(!isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`), `${relative(root, file)} links outside the repository`);
    }
  }
}
for (const name of names) {
  assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(name.length <= 64 && !name.startsWith("team-lesson-"), `Invalid maintained skill name: ${name}`);
  const directory = join(source, name);
  const text = await readFile(join(directory, "SKILL.md"), "utf8");
  const frontmatter = /^---\n([\s\S]+?)\n---(?:\n|$)/.exec(text)?.[1];
  assert.ok(frontmatter, `${name}: missing YAML frontmatter`);
  assert.equal(/^name: (.+)$/m.exec(frontmatter)?.[1], name, `${name}: frontmatter name differs`);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1];
  assert.ok(description && description.length <= 1024, `${name}: missing or excessive description`);
  assert.ok(catalog.includes(`](${name}/SKILL.md)`), `${name}: missing from catalog`);
  for (const parent of [".agents/skills", ".claude/skills"]) {
    const link = join(root, parent, name);
    assert.ok((await lstat(link)).isSymbolicLink(), `${parent}/${name}: missing relative discovery link`);
    assert.ok(!isAbsolute(await readlink(link)), `${parent}/${name}: discovery link must be relative`);
    assert.equal(await realpath(link), await realpath(directory), `${parent}/${name}: wrong discovery target`);
  }
  await inspect(directory);
}
console.log(`Verified ${names.length} maintained skills, both discovery directories, and local references.`);
