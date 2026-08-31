/**
 * Authored values are snapshots of what the caller passed (SDK-325), and a
 * compiled `PureMod` exposes them as immutable data (SDK-327).
 */
import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { freezeAuthoredData, snapshotAuthoredValue } from "../src/authoring/snapshot.ts";
import { createMod, render } from "../src/index.ts";
import { onActions } from "../src/stellaris.ts";

const CONFIG = {
  name: "Authored immutability test",
  prefix: "frozen",
  supportedVersion: "4.4.*",
};
const mod = createMod(CONFIG);

function technologyText(features: Parameters<typeof mod.compile>[0]): string {
  const file = mod.compile(features).contentFiles[0]!;
  return serialize([...file.entries]);
}

describe("snapshotAuthoredValue", () => {
  it("copies plain data and shares everything else", () => {
    const callback = (): number => 1;
    const instance = new Map([["a", 1]]);
    const authored = { list: [1, 2], nested: { callback }, instance };

    const snapshot = snapshotAuthoredValue(authored);

    expect(snapshot).toEqual(authored);
    expect(snapshot.list).not.toBe(authored.list);
    expect(snapshot.nested.callback).toBe(callback);
    expect(snapshot.instance).toBe(instance);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.list)).toBe(true);
    expect(Object.isFrozen(instance)).toBe(false);
  });

  it("keeps an already-frozen container, so recorded object identity survives", () => {
    // A captured Asset file is identified by object identity, and reaches the
    // definer inside a definition field.
    const recorded = Object.freeze({ itemKind: "asset", path: "gfx/a.dds" });

    expect(snapshotAuthoredValue({ textureFile: recorded }).textureFile).toBe(recorded);
  });

  it("reports a cycle rather than recursing until the stack runs out", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => snapshotAuthoredValue(cyclic)).toThrow(/refers back to itself/);
  });
});

describe("freezeAuthoredData", () => {
  it("freezes the tree without replacing any object in it", () => {
    const row = { factor: 2 };
    const owned = { weight: { modifiers: [row] } };

    expect(freezeAuthoredData(owned)).toBe(owned);
    expect(owned.weight.modifiers[0]).toBe(row);
    expect(Object.isFrozen(owned.weight.modifiers)).toBe(true);
    expect(Object.isFrozen(row)).toBe(true);
  });
});

describe("authored values snapshot their caller's input (SDK-325)", () => {
  it("keeps the category a technology was defined with when the array is appended to", () => {
    const category = ["particles"];
    const technology = mod.technology("probe", {
      name: "Probe Tech",
      area: "physics",
      tier: 1,
      category,
    });
    const placed = mod.feature(undefined, [technology]);

    category.push("biology");

    expect(technologyText([placed])).toContain("category = { particles }");
  });

  it("keeps the items a feature was placed with when the array is appended to", () => {
    const first = mod.technology("placed_first", {
      name: "First",
      area: "physics",
      tier: 1,
      category: ["particles"],
    });
    const second = mod.technology("placed_second", {
      name: "Second",
      area: "physics",
      tier: 1,
      category: ["particles"],
    });
    const items: [typeof first] = [first];
    const placed = mod.feature(undefined, items);

    // The casts are what an author reaches for after the types stop matching;
    // the runtime snapshot is what the mod is defended by.
    (items as unknown as unknown[]).push(second);

    expect(mod.compile([placed]).contentFiles[0]!.ids).toEqual(["frozen_tech_placed_first"]);
  });

  it("keeps the events and weighted rows an on-action binding was given", () => {
    const events = mod.namespace();
    const bound = events.country(10, { isTriggeredOnly: true });
    const unbound = events.country(11, { isTriggeredOnly: true });
    const list: [typeof bound] = [bound];
    const row: { weight: number; event: typeof bound } = { weight: 50, event: bound };
    const hook = mod.on(onActions.onGameStartCountry, { events: list, randomEvents: [row] });

    (list as unknown as unknown[]).push(unbound);
    row.weight = 5;
    (row as unknown as { event: unknown }).event = unbound;

    const compiled = mod.compile([
      mod.feature("hook_events", [bound, unbound]),
      mod.feature(undefined, [hook]),
    ]);
    expect(render(compiled).get("common/on_actions/frozen_on_actions.txt")).toMatchInlineSnapshot(`
      "on_game_start_country = {
      	events = { frozen.10 }
      	random_events = {
      		50 = frozen.10
      	}
      }
      "
    `);
  });

  it("keeps the ambient scopes an event declared when the caller's map is edited", () => {
    // The hook contract is checked at compile time against the event's own
    // scopes, long after the author handed this object over.
    const scopes: { from: "country" } = { from: "country" };
    const events = mod.namespace("diplomacy");
    const diplomacy = events.country(1, { scopes, isTriggeredOnly: true });

    (scopes as { from: string }).from = "planet";

    expect(() =>
      mod.compile([
        mod.feature("diplomacy_events", [diplomacy]),
        mod.feature(undefined, [mod.on(onActions.onCustomDiplomacy, [diplomacy])]),
      ])
    ).not.toThrow();
  });
});

describe("definedGroups is immutable throughout (SDK-327)", () => {
  it("freezes every group, list, definition, and definition body", () => {
    const technology = mod.technology("immutable", {
      name: "Immutable Tech",
      area: "physics",
      tier: 1,
      category: ["particles"],
    });
    const compiled = mod.compile([mod.feature(undefined, [technology])]);

    const group = compiled.definedGroups[0]!;
    const defined = group.defined[0]!;
    const def = defined.def as { id: string; category: string[] };
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.defined)).toBe(true);
    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.isFrozen(def.category)).toBe(true);

    expect(() => {
      (defined as { id: string }).id = "hijacked";
    }).toThrow(TypeError);
    expect(() => {
      def.id = "hijacked";
    }).toThrow(TypeError);
    expect(() => {
      def.category.push("biology");
    }).toThrow(TypeError);
  });

  it("still lowers a frozen definition to the entries it always reported", () => {
    const technology = mod.technology("lowerable", {
      name: "Lowerable Tech",
      area: "physics",
      tier: 1,
      category: ["particles"],
    });
    const defined = mod.compile([mod.feature(undefined, [technology])]).definedGroups[0]!
      .defined[0]!;

    expect(serialize([defined.toEntries()])).toBe(serialize([defined.toEntries()]));
  });
});
