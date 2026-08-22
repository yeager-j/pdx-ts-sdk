import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = path.resolve(packageDir, "../..");
const sdkSourceDir = path.join(repositoryDir, "packages/sdk/src");
const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const sdkDocsRevision = await hashTree(sdkSourceDir);
const output = [
  "/** This file is generated and ignored. See scripts/generate-version.mjs. */",
  `export const VERSION = ${JSON.stringify(manifest.version)};`,
  `export const SDK_DOCS_REVISION = ${JSON.stringify(sdkDocsRevision)};`,
  "",
].join("\n");
const docsOutput = [
  "/** This file is generated and ignored. See packages/create-stellaris-mod/scripts/generate-version.mjs. */",
  `export const SDK_DOCS_REVISION = ${JSON.stringify(sdkDocsRevision)};`,
  "",
].join("\n");

const generatedPath = path.join(packageDir, "src/generated/package-version.ts");
const docsGeneratedPath = path.join(
  repositoryDir,
  "packages/docs-site/lib/generated/sdk-docs-revision.ts"
);

await mkdir(path.dirname(generatedPath), { recursive: true });
await mkdir(path.dirname(docsGeneratedPath), { recursive: true });
await writeFile(generatedPath, output);
await writeFile(docsGeneratedPath, docsOutput);

async function hashTree(root) {
  const files = await listFiles(root);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort();
}
