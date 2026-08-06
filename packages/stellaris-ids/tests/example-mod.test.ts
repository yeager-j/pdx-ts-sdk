/**
 * The showcase example, rendered and frozen.
 *
 * It lives in this package's project rather than the SDK's because the example
 * imports `@pdx-ts/stellaris-ids/triggers` — the setup a real mod author has —
 * and a module augmentation is global to a TypeScript program. The root program
 * has to stay package-absent so `packages/sdk/tests/vanilla-refs.test-d.ts` can
 * assert the unchecked degradation, so the example compiles here instead.
 *
 * What it pins is identity, not just bytes: hello-galaxy's content ids,
 * explicitly authored event namespace, and localization keys are frozen with
 * its feature layout, because emission order is a function of content rather
 * than source layout.
 */

import { render } from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { defineHelloGalaxy } from "../../../examples/hello-galaxy/mod.ts";

// Top-level await: the example discovers its content from the filesystem, so
// the file set is only known after the import walk. Rendering here rather than
// inside the describe keeps the per-file golden loop below a plain `for`.
const files = render(await defineHelloGalaxy());

describe("hello-galaxy example mod", () => {
  it("renders the expected file set", () => {
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/hello_galaxy_amplifiers.txt",
      "common/technology/hello_galaxy_resonance.txt",
      "events/hello_galaxy_resonance.txt",
      "localisation/english/hello_galaxy_amplifiers_l_english.yml",
      "localisation/english/hello_galaxy_resonance_l_english.yml",
    ]);
  });

  it("fans one feature module out across the registries it touched", () => {
    // `content/resonance.ts` holds technologies and events; its authored stem
    // is shared across registries, so the single feature lands in two registry
    // directories under one name.
    expect([...files.keys()].filter((key) => key.endsWith("hello_galaxy_resonance.txt"))).toEqual([
      "common/technology/hello_galaxy_resonance.txt",
      "events/hello_galaxy_resonance.txt",
    ]);
  });

  it("starts the localization file with a UTF-8 BOM", () => {
    const localizationFiles = [...files]
      .filter(([path]) => path.startsWith("localisation/english/"))
      .map(([, content]) => content);
    expect(localizationFiles).toHaveLength(2);
    for (const localization of localizationFiles) {
      expect(localization.charCodeAt(0)).toBe(0xfeff);
      expect(localization.slice(1)).toMatch(/^l_english:\n/);
    }
  });

  for (const [relPath, content] of files) {
    it(`matches the golden file for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/hello-galaxy/${relPath.replaceAll("/", "__")}`
      );
    });
  }
});

/**
 * Feature layout is not event identity, sharpened.
 *
 * The example used to be shaped like the output — `resonance/technology.ts`,
 * `resonance/events.ts`, `amplifiers/technology.ts` — and emitted two files
 * named after the *registries*: `hello_galaxy_technology.txt` and
 * `hello_galaxy_events.txt`. Restructuring it into feature modules moved every
 * definition into a differently named file. The claim under test is that the
 * feature owns where things are written while `mod.namespace("resonance")`
 * owns the persistent event identity.
 *
 * The expectations below are the frozen example record. They are hardcoded
 * rather than fetched from git so the test is readable and self-contained; a
 * legitimate future content change is supposed to fail here and be re-frozen
 * deliberately.
 */
const EXAMPLE_TECHNOLOGY_KEYS = [
  "hello_galaxy_tech_amplifier_1",
  "hello_galaxy_tech_amplifier_2",
  "hello_galaxy_tech_amplifier_3",
  "hello_galaxy_tech_amplifier_4",
  "hello_galaxy_tech_amplifier_5",
  "hello_galaxy_tech_resonance_theory",
  "hello_galaxy_tech_resonance_weapons",
];

const AMPLIFIERS_LOCALIZATION =
  "﻿l_english:\n" +
  ' hello_galaxy_tech_amplifier_1:0 "Attuned Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_2:0 "Harmonic Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_3:0 "Coherent Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_4:0 "Superradiant Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_5:0 "Transcendent Resonance Amplifiers"\n';

const RESONANCE_LOCALIZATION =
  "﻿l_english:\n" +
  ' hello_galaxy_resonance.1.a:0 "Fascinating."\n' +
  ' hello_galaxy_resonance.1.desc:0 "Deep in the lattice, something answers back."\n' +
  ' hello_galaxy_resonance.1.name:0 "The Hum Returns"\n' +
  ' hello_galaxy_resonance.2.a:0 "Noted."\n' +
  ' hello_galaxy_resonance.2.desc:0 "The crystal hum lingers over this world."\n' +
  ' hello_galaxy_resonance.2.name:0 "Aftershock"\n' +
  ' hello_galaxy_tech_resonance_theory:0 "Crystal Resonance Theory"\n' +
  ' hello_galaxy_tech_resonance_theory_desc:0 "The lattice hums at frequencies we are only beginning to hear."\n' +
  ' hello_galaxy_tech_resonance_weapons:0 "Resonance Disruptors"\n' +
  ' hello_galaxy_tech_resonance_weapons_desc:0 "Weaponized harmonics that shatter hulls from within."\n';

describe("hello-galaxy preserves its authored feature identity", () => {
  it("emits the same set of technologies, redistributed across two files", () => {
    const technologyFiles = [...files]
      .filter(([relPath]) => relPath.startsWith("common/technology/"))
      .map(([, content]) => content);
    expect(technologyFiles).toHaveLength(2);
    const keys = technologyFiles
      .flatMap((content) => [...content.matchAll(/^(\w+) = \{$/gm)])
      .map((match) => match[1]!)
      .sort();
    expect(keys).toEqual(EXAMPLE_TECHNOLOGY_KEYS);
  });

  it("keeps the event namespace and its ids, which saves persist", () => {
    // The feature stem picks the file while the explicit namespace owns these
    // persistent ids; moving the source module can change the former, not the
    // latter.
    const events = files.get("events/hello_galaxy_resonance.txt")!;
    expect(events.startsWith("namespace = hello_galaxy_resonance\n")).toBe(true);
    expect([...events.matchAll(/^\tid = (\S+)$/gm)].map((match) => match[1])).toEqual([
      "hello_galaxy_resonance.1",
      "hello_galaxy_resonance.2",
    ]);
  });

  it("emits localization byte-identical to each authored feature contract", () => {
    // Localization rides with definitions and is keyed by the same explicit
    // ids, including their authored namespace.
    expect(files.get("localisation/english/hello_galaxy_amplifiers_l_english.yml")).toBe(
      AMPLIFIERS_LOCALIZATION
    );
    expect(files.get("localisation/english/hello_galaxy_resonance_l_english.yml")).toBe(
      RESONANCE_LOCALIZATION
    );
  });
});
