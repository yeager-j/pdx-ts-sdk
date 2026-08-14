/**
 * Writes every page's committed Reference snapshot, or checks they are current.
 *
 * A snapshot is the producer contribution stand-in: committed, reviewed with
 * whatever change moved it, and the only thing the viewer reads. The viewer
 * never runs the probe — a reference app that regenerated its own facts at
 * display time would have no reviewable artifact at all.
 *
 *   node --conditions=pdx-source src/build/cli.ts            writes them
 *   node --conditions=pdx-source src/build/cli.ts --check    fails if stale
 */

import { readFileSync, writeFileSync } from "node:fs";

import { assembleReferenceBuild } from "./assemble.ts";
import { PAGES } from "./pages.ts";
import { snapshotFileOf } from "./snapshot.ts";

function main(): void {
  const check = process.argv.includes("--check");
  const stale: string[] = [];

  for (const page of PAGES) {
    const build = assembleReferenceBuild(page);
    const next = `${JSON.stringify(build, null, 2)}\n`;
    const file = snapshotFileOf(page);

    if (!check) {
      writeFileSync(file, next, "utf8");
      console.log(
        `wrote ${page.snapshotPath} — ` +
          `${build.claims.length} derived claims, ${build.conventions.length} curated conventions, ` +
          `${build.fields.length} fields, ${build.stories.length} stories ` +
          `(${build.stories.filter((story) => story.origin === "recipe").length} from a Recipe)`
      );
      console.log(
        `  sdk ${build.identity.sdkVersion} · cwt ${build.identity.cwtCommit.slice(0, 12)} · ` +
          `docs ${build.identity.docsRevision} · corpus ${build.identity.corpusGameVersion} · ` +
          `ids ${build.identity.vanillaIdsVersion}`
      );
      continue;
    }

    let current: string;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      stale.push(`${page.snapshotPath} (missing)`);
      continue;
    }
    if (current !== next) {
      stale.push(page.snapshotPath);
    }
  }

  if (!check) {
    return;
  }
  if (stale.length > 0) {
    console.error(
      `these committed Reference snapshots no longer match what the sources project:\n` +
        stale.map((entry) => `  ${entry}`).join("\n") +
        "\nRegenerate and review the diff as a documentation change:\n" +
        "  npm run snapshot -w @pdx-ts/reference-spike"
    );
    process.exit(1);
  }
  console.log(`Reference snapshots are current (${PAGES.length} pages).`);
}

main();
