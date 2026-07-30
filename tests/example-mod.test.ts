import { describe, expect, it } from "vitest";

import { defineHelloGalaxy } from "../examples/hello-galaxy/mod.ts";

describe("hello-galaxy example mod", () => {
  const files = defineHelloGalaxy().render();

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
