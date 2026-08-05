/**
 * Compile-time coverage for SDK-46's subtype-conditional window flags and the
 * `location` FROM-closure: `archaeology`/`firstContact`/`espionageOperation`/
 * `astralRift`/`difficulty` are typed `S extends "<kind>" ? T : never` on
 * `EventDef`, so passing one to the wrong `defineXEvent` is a compile error
 * rather than a silently-ignored field. `location`'s `(ctx) => ctx.from` form
 * rides the same undeclared-FROM guard as every other FROM-aware field.
 */

import { describe, it } from "vitest";

import { createMod } from "../src/index.ts";
import { hasAutomationSetting, hasEventChain } from "../src/script/triggers.ts";

function events(prefix: string) {
  return createMod({ name: "Event fields", prefix, supportedVersion: "4.4.*" }).namespace();
}

describe("subtype-conditional EventDef fields (SDK-46)", () => {
  it("accepts archaeology only on defineFleetEvent", () => {
    const eventNamespace = events("event_fields_types_a");
    eventNamespace.fleet(1, { hideWindow: true, archaeology: true });
    eventNamespace.country(2, {
      hideWindow: true,
      // @ts-expect-error — archaeology is only legal on a fleet_event (subtype[fleet], events.cwt:501)
      archaeology: true,
    });
  });

  it("accepts firstContact only on defineFirstContactEvent", () => {
    const eventNamespace = events("event_fields_types_b");
    eventNamespace.firstContact(1, { hideWindow: true, firstContact: true });
    eventNamespace.fleet(2, {
      hideWindow: true,
      // @ts-expect-error — firstContact is only legal on a first_contact_event (subtype[first_contact])
      firstContact: true,
    });
  });

  it("accepts espionageOperation only on defineEspionageOperationEvent", () => {
    const eventNamespace = events("event_fields_types_c");
    eventNamespace.espionageOperation(1, { hideWindow: true, espionageOperation: true });
    eventNamespace.country(2, {
      hideWindow: true,
      // @ts-expect-error — espionageOperation is only legal on an espionage_operation_event
      espionageOperation: true,
    });
  });

  it("accepts astralRift and difficulty only on defineAstralRiftEvent", () => {
    const eventNamespace = events("event_fields_types_d");
    eventNamespace.astralRift(1, { hideWindow: true, astralRift: true, difficulty: 2 });
    eventNamespace.ship(2, {
      hideWindow: true,
      // @ts-expect-error — astralRift is only legal on an astral_rift_event (subtype[astral_rift])
      astralRift: true,
    });
    eventNamespace.ship(3, {
      hideWindow: true,
      // @ts-expect-error — difficulty is only legal on an astral_rift_event (subtype[astral_rift])
      difficulty: 2,
    });
  });

  it("lets diplomatic (an attribute subtype, not a kind-gated one) apply to any event kind", () => {
    const eventNamespace = events("event_fields_types_e");
    eventNamespace.country(1, { hideWindow: true, diplomatic: true });
    eventNamespace.fleet(2, { hideWindow: true, diplomatic: true });
  });

  it("requires a declared FROM before location can read ctx.from", () => {
    const eventNamespace = events("event_fields_types_f");
    eventNamespace.fleet(1, {
      from: "archaeological_site",
      hideWindow: true,
      location: (ctx) => ctx.from,
    });
    eventNamespace.fleet(2, {
      hideWindow: true,
      // @ts-expect-error — this event declared no `from:`; ctx.from is an inert sentinel, not a ScopeRef
      location: (ctx) => ctx.from,
    });
  });

  it("requires a declared FROM before situation can read ctx.from", () => {
    const eventNamespace = events("event_fields_types_g");
    eventNamespace.fleet(1, {
      from: "situation",
      hideWindow: true,
      situation: (ctx) => ctx.from,
    });
    eventNamespace.fleet(2, {
      hideWindow: true,
      // @ts-expect-error — this event declared no `from:`; ctx.from is an inert sentinel, not a ScopeRef
      situation: (ctx) => ctx.from,
    });
  });
});

describe("PR #15 review follow-ups (SDK-46)", () => {
  it("requires weightMultiplier.factor (events.cwt:448, unannotated cardinality is 1..1)", () => {
    const eventNamespace = events("event_fields_types_h");
    eventNamespace.country(1, {
      hideWindow: true,
      isTriggeredOnly: true,
      weightMultiplier: { factor: 5 },
    });
    eventNamespace.country(2, {
      hideWindow: true,
      isTriggeredOnly: true,
      // @ts-expect-error — factor is required on weight_multiplier (events.cwt:448); the block has
      // no other member the rules mark 1..1, so omitting it would silently serialize a
      // rule-invalid event.
      weightMultiplier: { modifiers: [] },
    });
  });

  it("scopes majorTrigger to country independently of S (events.cwt:419-425: it filters recipient countries, not the event's own scope)", () => {
    const eventNamespace = events("event_fields_types_i");
    // A country-only predicate is legal here even on a fleet event, because
    // major_trigger runs once per candidate recipient country, not in the
    // fleet event's own scope.
    eventNamespace.fleet(1, {
      hideWindow: true,
      major: true,
      majorTrigger: hasEventChain("event_fields_chain"),
    });
    eventNamespace.fleet(2, {
      hideWindow: true,
      major: true,
      // @ts-expect-error — a fleet-only predicate is not legal here: major_trigger evaluates
      // against each candidate recipient country, not the fleet event's own scope.
      majorTrigger: hasAutomationSetting("passive"),
    });
  });
});
