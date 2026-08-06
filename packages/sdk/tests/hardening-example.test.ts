import { join } from "node:path";
import { declareFrom, fixture, renderFired } from "@pdx-ts/sdk-testing";
import { describe, expect, it } from "vitest";

import { defineHardening } from "../../../examples/hardening/mod.ts";
import { render } from "../src/index.ts";
import { load } from "../src/stellaris/vanilla/load.ts";

const vanilla = load({
  installPath: join(import.meta.dirname, "../../../fixtures/fake-install"),
  cache: false,
});
const hardening = defineHardening(vanilla);
const files = render(hardening.mod);

describe("hardening example", () => {
  it("renders every implemented registry, on-actions, events, localization, and the patch", () => {
    const patchPath = hardening.mod.patchPlans[0]!.relPath;
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pdx_hardening_technology.txt",
      "common/buildings/pdx_hardening_buildings.txt",
      "common/traditions/pdx_hardening_traditions.txt",
      "common/tradition_categories/pdx_hardening_tradition_categories.txt",
      "common/council_agendas/pdx_hardening_council_agendas.txt",
      "common/edicts/pdx_hardening_edicts.txt",
      "events/pdx_hardening_events.txt",
      "common/on_actions/pdx_hardening_on_actions.txt",
      "localisation/english/pdx_hardening_l_english.yml",
      patchPath,
    ]);
    expect(
      new Set([...files.keys()].map((path) => path.split("/").slice(0, -1).join("/")))
    ).toEqual(
      new Set([
        "",
        "common/technology",
        "common/buildings",
        "common/traditions",
        "common/tradition_categories",
        "common/council_agendas",
        "common/edicts",
        "events",
        "common/on_actions",
        "localisation/english",
      ])
    );
  });

  for (const [relPath, content] of files) {
    it(`matches the hardening golden for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/hardening/${relPath.replaceAll("/", "__")}`
      );
    });
  }

  it("runs the calibrated event chain through the production evaluator", () => {
    const world = fixture(
      {
        countries: [{ name: "player", planets: [{ name: "homeworld" }] }],
      },
      {
        events: [
          hardening.entryEvent,
          declareFrom(hardening.delayedA, "planet"),
          hardening.delayedB,
          hardening.cascade,
          hardening.expiredTargetProbe,
        ],
      }
    );
    const player = world.country(0);
    const homeworld = player.planet(0);

    world.fire(hardening.entryEvent, player);
    world.advance(1);

    expect(world.log).toEqual([
      "PDX_HARDENING_ENTRY",
      "PDX_HARDENING_TARGET_AVAILABLE_IN_ENTRY",
      "PDX_HARDENING_ORDER_B",
      "PDX_HARDENING_ORDER_A",
      "PDX_HARDENING_FROM_OVERRIDE_IS_PLANET",
      "PDX_HARDENING_ORDER_C",
    ]);
    expect(world.fired[2]?.from).toEqual(homeworld.id);
    expect(renderFired(world)).toMatchInlineSnapshot(`
      "[day 0] pdx_hardening.1 @ country(0) "player" via harness
      [day 1] pdx_hardening.3 @ country(0) "player" from country(0) "player" via effect
      [day 1] pdx_hardening.2 @ country(0) "player" from planet(0.0) "homeworld" via effect
      [day 1] pdx_hardening.4 @ country(0) "player" from country(0) "player" via effect"
    `);

    expect(() => world.fire(hardening.expiredTargetProbe, player)).toThrow(
      /event target "pdx_hardening_chain_planet" was never saved/
    );
    expect(world.log).not.toContain("PDX_HARDENING_TARGET_STILL_AVAILABLE_AFTER_CHAIN");
  });
});
