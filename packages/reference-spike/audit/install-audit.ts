/**
 * The Install audit: reading a real game, and committing nothing that came out
 * of it except counts.
 *
 * The spike's build, tests and viewer are hermetic — they run against vendored
 * rules and the committed corpus fixture, and never need Stellaris. This is the
 * separate, maintainer-local pass the two-tier evidence decision allows: when a
 * matching install is on the machine, look at the definitions the page makes
 * claims about and check the committed evidence still describes them.
 *
 * The licensing boundary is the same one `codegen-vanilla` and the corpus
 * extractor already hold: ids, key names, counts, versions and hashes may be
 * reported; script bodies, localized text and asset data may not, and nothing
 * read here is written to a file. Everything below prints and exits.
 *
 * What an audit can and cannot do is worth being precise about. It can
 * strengthen an Observed example — "one definition writes a stage colour" is
 * better evidence when you have looked at the definition. It can hold a gap
 * open as Unresolved behavior. It cannot establish a Supported contract: only
 * the SDK surface can do that, and if the audit shows the surface is wrong the
 * answer is to fix the surface.
 *
 * Situations only. The audit reads one registry's shipped definitions with a
 * hand-written walk over `common/situations/`, and generalizing that walk to a
 * second registry is a different job from generalizing the build — nothing in
 * it is shared with the page pipeline except the snapshot it checks against.
 * The Technology page's evidence is the committed fixture and nothing else.
 *
 *   node --conditions=pdx-source audit/install-audit.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";
import { InstallNotFoundError } from "@pdx-ts/sdk";
import { locateInstall, readGameVersion } from "@pdx-ts/sdk/stellaris";

import { readRegistryEvidence } from "../src/build/corpus-evidence.ts";
import { pageById } from "../src/build/pages.ts";
import { readSnapshot } from "../src/build/snapshot.ts";

const REGISTRY_DIR = "common/situations";

interface Definition {
  readonly id: string;
  readonly file: string;
  readonly keys: readonly string[];
  readonly stages: readonly string[];
  readonly approaches: number;
}

function entries(items: readonly PdxItem[]): { key: string; value: PdxItem }[] {
  return items.flatMap((item) =>
    item.kind === "entry" ? [{ key: item.key, value: item as PdxItem }] : []
  );
}

function readDefinitions(installPath: string): Definition[] {
  const dir = path.join(installPath, REGISTRY_DIR);
  const definitions: Definition[] = [];
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()) {
    for (const item of parse(readFileSync(path.join(dir, file), "utf8")).items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      const body = item.value.items;
      const keys = entries(body).map((entry) => entry.key);
      const stagesBlock = body.find(
        (child) =>
          child.kind === "entry" && child.key === "stages" && child.value.kind === "container"
      );
      const stages =
        stagesBlock !== undefined &&
        stagesBlock.kind === "entry" &&
        stagesBlock.value.kind === "container"
          ? entries(stagesBlock.value.items).map((entry) => entry.key)
          : [];
      definitions.push({
        id: item.key,
        file,
        keys,
        stages,
        approaches: keys.filter((key) => key === "approach").length,
      });
    }
  }
  return definitions;
}

function main(): void {
  let installPath: string;
  try {
    installPath = locateInstall();
  } catch (error) {
    if (error instanceof InstallNotFoundError) {
      console.log("No Stellaris install found. The audit is optional; the spike is hermetic.");
      return;
    }
    throw error;
  }

  const build = readSnapshot(pageById("situations"));
  const installed = readGameVersion(installPath) ?? "unknown";
  const evidence = readRegistryEvidence(build.registry);

  console.log("Install audit — Situation\n");
  console.log(`  install          ${installPath}`);
  console.log(`  installed build  ${installed}`);
  console.log(`  fixture build    ${evidence.gameVersion}`);
  if (installed !== evidence.gameVersion) {
    console.log(
      "\n  The install and the committed fixture describe different builds. Everything below\n" +
        "  is an observation about the install, and cannot be compared to the fixture's counts."
    );
  }

  const definitions = readDefinitions(installPath);
  console.log(`\n  definitions      ${definitions.length} (fixture: ${evidence.definitions})`);

  // Two stages and two approaches is the shape the Verified example teaches.
  // Whether the game itself writes that shape is evidence worth having, and is
  // the kind of thing a maintainer would otherwise assume.
  const multiStage = definitions.filter((definition) => definition.stages.length > 1);
  const multiApproach = definitions.filter((definition) => definition.approaches > 1);
  console.log(`  with >1 stage    ${multiStage.length}`);
  console.log(`  with >1 approach ${multiApproach.length}`);
  const stageCounts = definitions.map((definition) => definition.stages.length);
  console.log(
    `  stages per definition: min ${Math.min(...stageCounts)}, max ${Math.max(...stageCounts)}`
  );

  // The three difficult claims, measured against the install directly.
  const writes = (key: string): Definition[] =>
    definitions.filter((definition) => definition.keys.includes(key));
  for (const key of ["picture", "total_progress", "progress_direction"]) {
    const found = writes(key);
    const fixture = evidence.fields.find((field) => field.key === key);
    console.log(
      `  ${key.padEnd(18)} ${found.length} definitions` +
        (fixture === undefined ? "" : ` (fixture: ${fixture.definitions})`)
    );
  }

  const withColor = definitions.filter(
    (definition) =>
      definition.stages.length > 0 &&
      definition.keys.includes("stages") &&
      readFileSync(path.join(installPath, REGISTRY_DIR, definition.file), "utf8").includes(
        "color ="
      )
  );
  console.log(`  files containing a stage colour: ${new Set(withColor.map((d) => d.file)).size}`);

  console.log(
    "\n  Ids and counts only. No script body, localized text or asset data is printed or\n" +
      "  written, and nothing here is committed."
  );
}

main();
