/**
 * `discoverContent`: the filesystem walk, the classification of a module's
 * exports, and what the errors say when a module exports the wrong thing.
 *
 * Two kinds of evidence. The committed fixture under
 * `tests/fixtures/content-discovery/` is the happy path end to end — feature
 * modules in, a rendered mod out — and everything else is written into a fresh
 * temp directory per test. Fresh is not optional: `import()` caches by URL, so
 * a mutated-and-reimported module would keep serving its first version.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildMod, discoverContent, render, type ModConfig } from "../src/index.ts";

const FIXTURE = join(import.meta.dirname, "fixtures/content-discovery");
const SDK = join(import.meta.dirname, "../src/index.ts");

const config: ModConfig = {
  name: "Discovery Probe",
  prefix: "pp_disco",
  supportedVersion: "4.0.*",
};

const temps: string[] = [];

/** A fresh directory holding the given modules; never reused, never mutated. */
function moduleTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pdx-discover-"));
  temps.push(dir);
  for (const [relPath, source] of Object.entries(files)) {
    const target = join(dir, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
  return dir;
}

/** An import of the SDK by absolute path — what a temp-dir module needs. */
function sdk(names: string): string {
  return `import { ${names} } from ${JSON.stringify(SDK)};\n`;
}

function tech(id: string, extra = ""): string {
  return (
    `defineTechnology({ id: "${id}", name: "${id}", cost: 1000, area: "physics", ` +
    `tier: 1, category: "particles"${extra} })`
  );
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("discoverContent over the committed fixture", () => {
  it("names one collection per module, in logical path order", async () => {
    const collections = await discoverContent(FIXTURE);
    expect(collections.map((entry) => entry.file)).toEqual([
      "technology",
      "expansion",
      "technology",
    ]);
    expect(collections.map((entry) => entry.items.length)).toEqual([1, 5, 1]);
  });

  it("accepts a directory URL as well as a path", async () => {
    const fromUrl = await discoverContent(new URL("fixtures/content-discovery/", import.meta.url));
    const fromPath = await discoverContent(FIXTURE);
    expect(render(buildMod(config, fromUrl))).toEqual(render(buildMod(config, fromPath)));
  });

  it("builds and renders the whole mod from the tree", async () => {
    const files = render(buildMod(config, await discoverContent(FIXTURE)));
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pp_disco_expansion.txt",
      "common/technology/pp_disco_technology.txt",
      "events/pp_disco_expansion.txt",
      "common/on_actions/pp_disco_on_actions.txt",
      "localisation/english/pp_disco_l_english.yml",
    ]);
    for (const [relPath, content] of files) {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/discovery/${relPath.replaceAll("/", "__")}`
      );
    }
  });

  it("fans one feature module out to every registry it defined into", async () => {
    // `expansion.ts` is a whole feature — technologies, events, and the hook
    // that fires them — so its one stem reaches two registry directories under
    // the same name, plus the on-action file every hook shares.
    const files = render(buildMod(config, await discoverContent(FIXTURE)));
    expect([...files.keys()]).toContain("common/technology/pp_disco_expansion.txt");
    expect([...files.keys()]).toContain("events/pp_disco_expansion.txt");
    expect(
      [...files.get("common/technology/pp_disco_expansion.txt")!.matchAll(/^(\w+) = \{$/gm)].map(
        (match) => match[1]
      )
    ).toEqual(["pp_disco_tech_beacon_network", "pp_disco_tech_survey_doctrine"]);
    expect(files.get("events/pp_disco_expansion.txt")).toContain("namespace = pp_disco");
  });

  it("merges the two feature folders' technology.ts into one registry file", async () => {
    const files = render(buildMod(config, await discoverContent(FIXTURE)));
    const technology = files.get("common/technology/pp_disco_technology.txt")!;
    expect([...technology.matchAll(/^(\w+) = \{$/gm)].map((match) => match[1])).toEqual([
      "pp_disco_tech_chorus_rites",
      "pp_disco_tech_vigil_cadence",
    ]);
  });

  it("keeps the author's event order inside one on() call", async () => {
    const files = render(buildMod(config, await discoverContent(FIXTURE)));
    const hooks = files.get("common/on_actions/pp_disco_on_actions.txt")!;
    expect(hooks.indexOf("pp_disco.1")).toBeLessThan(hooks.indexOf("pp_disco.2"));
  });
});

describe("discoverContent walking a tree", () => {
  it("ignores everything that is not a .ts module", async () => {
    const dir = moduleTree({
      "technology.ts": sdk("defineTechnology") + `export const a = ${tech("pp_disco_tech_a")};\n`,
      "notes.md": "# not a module\n",
      "data.json": '{ "not": "a module" }',
      "technology.txt": "not a module either",
    });
    const collections = await discoverContent(dir);
    expect(collections.map((entry) => entry.file)).toEqual(["technology"]);
  });

  it("flattens exported arrays and collects an item exported twice once", async () => {
    const dir = moduleTree({
      "technology.ts":
        sdk("defineTechnology") +
        `export const a = ${tech("pp_disco_tech_a")};\n` +
        `export const rest = [${tech("pp_disco_tech_b")}, [${tech("pp_disco_tech_c")}]];\n` +
        `export const alsoA = [a];\n`,
    });
    const [collected] = await discoverContent(dir);
    expect(collected!.items).toHaveLength(3);
  });

  it("collects a default export", async () => {
    const dir = moduleTree({
      "technology.ts": sdk("defineTechnology") + `export default ${tech("pp_disco_tech_a")};\n`,
    });
    const [collected] = await discoverContent(dir);
    expect(collected!.items).toHaveLength(1);
  });

  it("merges same-basename modules from different folders, in path order", async () => {
    const dir = moduleTree({
      "zeta/technology.ts":
        sdk("defineTechnology") + `export const z = ${tech("pp_disco_tech_z")};\n`,
      "alpha/technology.ts":
        sdk("defineTechnology") + `export const a = ${tech("pp_disco_tech_a")};\n`,
    });
    const collections = await discoverContent(dir);
    expect(collections.map((entry) => entry.file)).toEqual(["technology", "technology"]);
    expect(
      collections.flatMap((entry) => entry.items.map((item) => (item as { id: string }).id))
    ).toEqual(["pp_disco_tech_a", "pp_disco_tech_z"]);
    const files = render(buildMod(config, collections));
    expect([...files.keys()]).toContain("common/technology/pp_disco_technology.txt");
  });

  it("renders identically from two trees whose files were written in opposite order", async () => {
    const modules = {
      "alpha/technology.ts":
        sdk("defineTechnology") + `export const a = ${tech("pp_disco_tech_a")};\n`,
      "beta/technology.ts":
        sdk("defineTechnology") + `export const b = ${tech("pp_disco_tech_b")};\n`,
      "gamma/technology.ts":
        sdk("defineTechnology") + `export const g = ${tech("pp_disco_tech_g")};\n`,
    };
    const forwards = moduleTree(modules);
    const backwards = moduleTree(Object.fromEntries(Object.entries(modules).reverse()));
    const first = render(buildMod(config, await discoverContent(forwards)));
    const second = render(buildMod(config, await discoverContent(backwards)));
    expect([...second]).toEqual([...first]);
  });
});

describe("discoverContent rejecting a module it cannot place", () => {
  it("refuses a module that exports nothing it recognizes", async () => {
    const dir = moduleTree({ "technology.ts": "export const version = 3;\nexport {};\n" });
    await expect(discoverContent(dir)).rejects.toThrow(
      /technology\.ts exports "version", which is not something a definer returned/
    );
  });

  it("refuses a module with no exports at all", async () => {
    const dir = moduleTree({ "technology.ts": "const unused = 1;\nexport {};\n" });
    await expect(discoverContent(dir)).rejects.toThrow(
      /technology\.ts exports nothing the SDK recognizes/
    );
  });

  it("names the offending export inside an exported array", async () => {
    const dir = moduleTree({
      "technology.ts":
        sdk("defineTechnology") +
        `export const all = [${tech("pp_disco_tech_a")}, "tech_lasers_2"];\n`,
    });
    await expect(discoverContent(dir)).rejects.toThrow(
      /technology\.ts exports "all", which is not something a definer returned/
    );
  });

  it("tells an author who exported the namespace handle to export its events", async () => {
    const dir = moduleTree({
      "events.ts":
        sdk("namespace") +
        `export const events = namespace("pp_disco");\n` +
        `export const first = events.defineCountryEvent({ id: 1, title: "T", desc: "D", isTriggeredOnly: true, options: [{ name: "ok" }] });\n`,
    });
    await expect(discoverContent(dir)).rejects.toThrow(
      /exports "events", the namespace handle for events in "pp_disco"\. Export the events it defined/
    );
  });

  it("refuses a filename that cannot be a file stem, naming the module", async () => {
    const dir = moduleTree({
      "my-technology.ts":
        sdk("defineTechnology") + `export const a = ${tech("pp_disco_tech_a")};\n`,
    });
    await expect(discoverContent(dir)).rejects.toThrow(
      /my-technology\.ts names the file it emits, so its basename is the file stem: Collection file stem "my-technology" must be lowercase snake_case/
    );
  });
});

describe("re-exporting across discovered modules", () => {
  it("is a duplicate definition, because export is registration", async () => {
    const dir = moduleTree({
      "technology.ts": sdk("defineTechnology") + `export const a = ${tech("pp_disco_tech_a")};\n`,
      "reexport.ts": `export { a } from "./technology.ts";\n`,
    });
    const collections = await discoverContent(dir);
    expect(collections.map((entry) => entry.file)).toEqual(["reexport", "technology"]);
    expect(() => buildMod(config, collections)).toThrow(
      `Duplicate technology id "pp_disco_tech_a"`
    );
  });
});
