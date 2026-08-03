/**
 * Compile-time coverage for SDK-46's subtype-conditional window flags and the
 * `location` FROM-closure: `archaeology`/`firstContact`/`espionageOperation`/
 * `astralRift`/`difficulty` are typed `S extends "<kind>" ? T : never` on
 * `EventDef`, so passing one to the wrong `defineXEvent` is a compile error
 * rather than a silently-ignored field. `location`'s `(ctx) => ctx.from` form
 * rides the same undeclared-FROM guard as every other FROM-aware field.
 */

import { describe, it } from "vitest";

import { namespace } from "../src/index.ts";

describe("subtype-conditional EventDef fields (SDK-46)", () => {
  it("accepts archaeology only on defineFleetEvent", () => {
    const events = namespace("event_fields_types_a");
    events.defineFleetEvent({ id: 1, hideWindow: true, archaeology: true });
    events.defineCountryEvent({
      id: 2,
      hideWindow: true,
      // @ts-expect-error — archaeology is only legal on a fleet_event (subtype[fleet], events.cwt:501)
      archaeology: true,
    });
  });

  it("accepts firstContact only on defineFirstContactEvent", () => {
    const events = namespace("event_fields_types_b");
    events.defineFirstContactEvent({ id: 1, hideWindow: true, firstContact: true });
    events.defineFleetEvent({
      id: 2,
      hideWindow: true,
      // @ts-expect-error — firstContact is only legal on a first_contact_event (subtype[first_contact])
      firstContact: true,
    });
  });

  it("accepts espionageOperation only on defineEspionageOperationEvent", () => {
    const events = namespace("event_fields_types_c");
    events.defineEspionageOperationEvent({ id: 1, hideWindow: true, espionageOperation: true });
    events.defineCountryEvent({
      id: 2,
      hideWindow: true,
      // @ts-expect-error — espionageOperation is only legal on an espionage_operation_event
      espionageOperation: true,
    });
  });

  it("accepts astralRift and difficulty only on defineAstralRiftEvent", () => {
    const events = namespace("event_fields_types_d");
    events.defineAstralRiftEvent({ id: 1, hideWindow: true, astralRift: true, difficulty: 2 });
    events.defineShipEvent({
      id: 2,
      hideWindow: true,
      // @ts-expect-error — astralRift is only legal on an astral_rift_event (subtype[astral_rift])
      astralRift: true,
    });
    events.defineShipEvent({
      id: 3,
      hideWindow: true,
      // @ts-expect-error — difficulty is only legal on an astral_rift_event (subtype[astral_rift])
      difficulty: 2,
    });
  });

  it("lets diplomatic (an attribute subtype, not a kind-gated one) apply to any event kind", () => {
    const events = namespace("event_fields_types_e");
    events.defineCountryEvent({ id: 1, hideWindow: true, diplomatic: true });
    events.defineFleetEvent({ id: 2, hideWindow: true, diplomatic: true });
  });

  it("requires a declared FROM before location can read ctx.from", () => {
    const events = namespace("event_fields_types_f");
    events.defineFleetEvent({
      id: 1,
      from: "archaeological_site",
      hideWindow: true,
      location: (ctx) => ctx.from,
    });
    events.defineFleetEvent({
      id: 2,
      hideWindow: true,
      // @ts-expect-error — this event declared no `from:`; ctx.from is an inert sentinel, not a ScopeRef
      location: (ctx) => ctx.from,
    });
  });
});
