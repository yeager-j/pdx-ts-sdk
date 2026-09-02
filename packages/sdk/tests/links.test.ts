/**
 * The value form of the generated scope links (SDK-94).
 *
 * Each link is one symbol with two forms: the condition wrapper the trigger
 * side has always had, and a path builder that navigates from a scope value to
 * the link's output scope. The second is what makes `root.owner` and
 * `capital_scope` — the second-most-common shape in shipped script after a
 * bare `this` — authorable at all.
 */

import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { createMod, render } from "../src/index.ts";
import { recordEffects, withScriptCtx } from "../src/script/effects/recorder.ts";
import type { ScriptCtx } from "../src/script/effects/types.ts";
import { capitalScope, hasCountryFlag, hasTechnology, owner } from "../src/script/triggers.ts";

// Kept past its authoring call on purpose: the assertions below read paths and
// build triggers, which is the pure side of a ctx and stays usable anywhere.
const ctx = withScriptCtx<
  "country",
  { readonly root: "country"; readonly from: "country" },
  ScriptCtx<"country", { readonly root: "country"; readonly from: "country" }>
>({}, (ctx) => ctx);

describe("scope links as value builders", () => {
  it("navigates from ROOT, which the game writes absolutely", () => {
    expect(owner(ctx.root).path).toBe("root.owner");
    expect(ctx.root.path).toBe("root");
  });

  it("writes a relative base bare, the way vanilla does", () => {
    // `capital_scope`, never `this.capital_scope`.
    expect(capitalScope(ctx.self).path).toBe("capital_scope");
  });

  it("chains with no extra mechanism", () => {
    expect(owner(capitalScope(ctx.root)).path).toBe("root.capital_scope.owner");
  });

  it("preserves absoluteness rather than conferring it", () => {
    // `from.owner` still names the same scope wherever it is written, so it
    // stays openable; `owner` off `this` does not, and must not.
    expect("effects" in owner(ctx.from)).toBe(true);
    expect("effects" in owner(ctx.self)).toBe(false);
  });

  it("opens a navigated absolute ref where the author wrote it", () => {
    // Opened inside the authoring call that made the ctx, as an author's
    // effect closure always is.
    const sink = withScriptCtx<
      "country",
      { readonly root: "country"; readonly from: "country" },
      PdxEntry[]
    >({}, (ctx) =>
      recordEffects<"country">([], (country) => {
        country.log("outer");
        owner(ctx.from).effects((c) => c.log("from's owner"));
      })
    );

    expect(serialize(sink)).toBe(`log = outer

from.owner = {
	log = "from's owner"
}
`);
  });

  it("still builds the trigger form on the same symbol", () => {
    expect(serialize([...owner(hasCountryFlag("ascended")).entries])).toBe(
      "owner = {\n\thas_country_flag = ascended\n}\n"
    );
  });

  it("rejects a dangling reference wrapped in a scope-link trigger", () => {
    const mod = createMod({
      name: "Dangling scope-link reference",
      prefix: "dangling_link",
      supportedVersion: "4.0.*",
    });
    const undefinedTechnology = mod.technologyHandle("never_defined");
    const perk = mod.ascensionPerk("present", {
      name: "Present",
      potential: owner(hasTechnology(undefinedTechnology)),
    });

    expect(() => mod.compile([mod.feature("perks", [perk])])).toThrow(/no such technology/);
  });

  it("resolves a reference wrapped in a scope-link trigger when its definition is present", () => {
    const mod = createMod({
      name: "Resolved scope-link reference",
      prefix: "resolved_link",
      supportedVersion: "4.0.*",
    });
    const technology = mod.technologyHandle("defined");
    const perk = mod.ascensionPerk("present", {
      name: "Present",
      potential: owner(hasTechnology(technology)),
    });
    const definedTechnology = technology.define({
      name: "Defined",
      cost: 100,
      weight: 100,
      area: "physics",
      tier: 1,
      category: "particles",
    });

    expect(() => mod.compile([mod.feature("perks", [perk, definedTechnology])])).not.toThrow();
  });

  it("lowers a navigated scope into an effect argument, end to end", () => {
    const mod = createMod({
      name: "Scope link tests",
      prefix: "links",
      supportedVersion: "4.0.*",
    });
    const events = mod.namespace();
    const project = mod.specialProject("crystal_survey", {
      name: "Survey the Crystal Signal",
      cost: 250,
      eventScope: "planet_event",
    });
    const enable = events.country(1, {
      isTriggeredOnly: true,
      hideWindow: true,
      immediate: (country, eventCtx) => {
        country.enableSpecialProject({
          name: project,
          owner: owner(eventCtx.root),
          location: capitalScope(eventCtx.root),
        });
      },
    });

    const rendered = render(mod.compile([mod.feature("navigation", [project, enable])])).get(
      "events/links_navigation.txt"
    )!;

    expect(rendered).toContain("owner = root.owner");
    expect(rendered).toContain("location = root.capital_scope");
  });
});
