import { describe, expect, it } from "vitest";

import { defineHelloGalaxy } from "../examples/hello-galaxy/mod.ts";
import { render } from "../src/index.ts";

// Top-level await: the example discovers its content from the filesystem, so
// the file set is only known after the import walk. Rendering here rather than
// inside the describe keeps the per-file golden loop below a plain `for`.
const files = render(await defineHelloGalaxy());

describe("hello-galaxy example mod", () => {
  it("renders the expected file set", () => {
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/hello_galaxy_technology.txt",
      "events/hello_galaxy_events.txt",
      "localisation/english/hello_galaxy_l_english.yml",
    ]);
  });

  it("starts the localization file with a UTF-8 BOM", () => {
    const loc = files.get("localisation/english/hello_galaxy_l_english.yml")!;
    expect(loc.charCodeAt(0)).toBe(0xfeff);
    expect(loc.slice(1)).toMatch(/^l_english:\n/);
  });

  for (const [relPath, content] of files) {
    it(`matches the golden file for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/hello-galaxy/${relPath.replaceAll("/", "__")}`
      );
    });
  }
});
