import { describe, expect, it } from "vitest";

import { defineHelloGalaxy } from "../../../examples/hello-galaxy/mod.ts";
import { render } from "../src/index.ts";

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
      "localisation/english/hello_galaxy_l_english.yml",
    ]);
  });

  it("fans one feature module out across the registries it touched", () => {
    // `content/resonance.ts` holds technologies and events; the stem is the
    // module's basename and the directory is the registry's, so the single
    // feature module lands in two registry directories under one name.
    expect([...files.keys()].filter((key) => key.endsWith("hello_galaxy_resonance.txt"))).toEqual([
      "common/technology/hello_galaxy_resonance.txt",
      "events/hello_galaxy_resonance.txt",
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

/**
 * Layout is not identity, sharpened.
 *
 * The example used to be shaped like the output — `resonance/technology.ts`,
 * `resonance/events.ts`, `amplifiers/technology.ts` — and emitted two files
 * named after the *registries*: `hello_galaxy_technology.txt` and
 * `hello_galaxy_events.txt`. Restructuring it into feature modules moved every
 * definition into a differently named file. The claim under test is that the
 * move changed only *where* things are written, never *what* they are: the
 * same technology ids, the same namespace, the same event ids, the same
 * localization bytes.
 *
 * The expectations below are the frozen pre-restructure record, taken from the
 * goldens at 56cfa27. They are hardcoded rather than fetched from git so the
 * test is readable and self-contained; a legitimate future content change to
 * the example is supposed to fail here and be re-frozen deliberately.
 */
const PRE_FANOUT_TECHNOLOGY_KEYS = [
  "hello_galaxy_tech_amplifier_1",
  "hello_galaxy_tech_amplifier_2",
  "hello_galaxy_tech_amplifier_3",
  "hello_galaxy_tech_amplifier_4",
  "hello_galaxy_tech_amplifier_5",
  "hello_galaxy_tech_resonance_theory",
  "hello_galaxy_tech_resonance_weapons",
];

const PRE_FANOUT_LOCALISATION =
  "﻿l_english:\n" +
  ' hello_galaxy_tech_amplifier_1:0 "Attuned Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_2:0 "Harmonic Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_3:0 "Coherent Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_4:0 "Superradiant Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_amplifier_5:0 "Transcendent Resonance Amplifiers"\n' +
  ' hello_galaxy_tech_resonance_theory:0 "Crystal Resonance Theory"\n' +
  ' hello_galaxy_tech_resonance_theory_desc:0 "The lattice hums at frequencies we are only beginning to hear."\n' +
  ' hello_galaxy_tech_resonance_weapons:0 "Resonance Disruptors"\n' +
  ' hello_galaxy_tech_resonance_weapons_desc:0 "Weaponized harmonics that shatter hulls from within."\n' +
  ' hello_galaxy.1.name:0 "The Hum Returns"\n' +
  ' hello_galaxy.1.desc:0 "Deep in the lattice, something answers back."\n' +
  ' hello_galaxy.1.a:0 "Fascinating."\n' +
  ' hello_galaxy.2.name:0 "Aftershock"\n' +
  ' hello_galaxy.2.desc:0 "The crystal hum lingers over this world."\n' +
  ' hello_galaxy.2.a:0 "Noted."\n';

describe("restructuring hello-galaxy into feature modules preserved its identity", () => {
  it("emits the same set of technologies, redistributed across two files", () => {
    const technologyFiles = [...files]
      .filter(([relPath]) => relPath.startsWith("common/technology/"))
      .map(([, content]) => content);
    expect(technologyFiles).toHaveLength(2);
    const keys = technologyFiles
      .flatMap((content) => [...content.matchAll(/^(\w+) = \{$/gm)])
      .map((match) => match[1]!)
      .sort();
    expect(keys).toEqual(PRE_FANOUT_TECHNOLOGY_KEYS);
  });

  it("keeps the event namespace and its ids, which saves persist", () => {
    // Event identity is authored at `namespace(...)`, so the renamed event file
    // carries the same header and the same full ids it always did.
    const events = files.get("events/hello_galaxy_resonance.txt")!;
    expect(events.startsWith("namespace = hello_galaxy\n")).toBe(true);
    expect([...events.matchAll(/^\tid = (\S+)$/gm)].map((match) => match[1])).toEqual([
      "hello_galaxy.1",
      "hello_galaxy.2",
    ]);
  });

  it("emits localization byte-identical to the pre-restructure golden", () => {
    // Localization rides with definitions and is keyed by id, so regrouping
    // definitions into different files cannot touch a byte of it — including
    // the order, which follows content and not layout.
    expect(files.get("localisation/english/hello_galaxy_l_english.yml")).toBe(
      PRE_FANOUT_LOCALISATION
    );
  });
});
