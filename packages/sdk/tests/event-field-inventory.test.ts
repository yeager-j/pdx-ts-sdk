/**
 * The drift gate for the hand-written event surface (`events.ts`).
 *
 * `EventDef`/`EventOption` are hand-written against `events/events.cwt`, field
 * by field, each carrying its CWT line in a doc comment. Nothing connected the
 * two: a vendor bump that added a field, or reshaped one, changed nothing
 * anywhere — no codegen output moved, no snapshot moved, and the omission was
 * invisible until someone re-read the rules by hand.
 *
 * So the inventory is re-derived here on every run and diffed against the
 * acknowledged sets below. A field the vendored rules declare must be in
 * exactly one of them: surfaced (with the member that surfaces it) or not
 * (with the reason). Both directions fail — a new field is unaccounted, and a
 * field that disappears leaves an acknowledgement describing nothing.
 *
 * The acknowledged sets are the reviewable artifact. On a vendor bump the diff
 * a maintainer reads is one line per field, saying which side it landed on and
 * why, rather than a re-reading of the whole `.cwt` block.
 *
 * Hermetic: the vendored rules are in-repo, and this uses the same parser
 * codegen does, so `##`/`###` comments and `alias_name[...]` splices cannot be
 * mistaken for fields.
 */

import { readFileSync } from "node:fs";
import { parseCwt, type CwtBlock, type CwtNode } from "@pdx-ts/codegen-cwt/cwt/parser";
import { describe, expect, it } from "vitest";

// Repo-root-relative: vitest runs from the workspace root.
const EVENTS_CWT = "vendor/cwtools-stellaris-config/config/events/events.cwt";

/**
 * Event fields the SDK authors, and the `EventDef` member that writes each.
 * `buildEvent` (`events.ts`) is the lowering; `tests/event-fields.test.ts` is
 * where the emitted bytes are pinned.
 */
const SURFACED_EVENT_FIELDS: Readonly<Record<string, string>> = {
  id: "EventDef.id, as `<namespace>.<id>`",
  title: "EventDef.title",
  desc: "EventDef.desc",
  diplomatic_title: "EventDef.diplomaticTitle",
  message_desc: "EventDef.messageDesc",
  picture: "EventDef.picture",
  show_sound: "EventDef.showSound",
  event_picture_background: "EventDef.eventPictureBackground",
  notification_event_icon: "EventDef.notificationEventIcon",
  event_window_type: "EventDef.eventWindowType",
  event_message_type: "EventDef.eventMessageType",
  event_chain: "EventDef.eventChain",
  specimen: "EventDef.specimen",
  situation: "EventDef.situation",
  location: "EventDef.location",
  hide_window: "EventDef.hideWindow",
  diplomatic: "EventDef.diplomatic",
  force_open: "EventDef.forceOpen",
  major: "EventDef.major",
  major_trigger: "EventDef.majorTrigger",
  trackable: "EventDef.trackable",
  is_advisor_event: "EventDef.isAdvisorEvent",
  auto_select: "EventDef.autoSelect",
  auto_opens: "EventDef.autoOpens",
  is_test_event: "EventDef.isTestEvent",
  is_triggered_only: "EventDef.isTriggeredOnly",
  fire_only_once: "EventDef.fireOnlyOnce",
  archaeology: "EventDef.archaeology (fleet events only)",
  first_contact: "EventDef.firstContact (first-contact events only)",
  espionage_operation: "EventDef.espionageOperation (espionage-operation events only)",
  astral_rift: "EventDef.astralRift (astral-rift events only)",
  difficulty: "EventDef.difficulty (astral-rift events only)",
  trigger: "EventDef.trigger",
  abort_trigger: "EventDef.abortTrigger",
  abort_effect: "EventDef.abortEffect",
  mean_time_to_happen: "EventDef.meanTimeToHappen",
  weight_multiplier: "EventDef.weightMultiplier",
  immediate: "EventDef.immediate",
  after: "EventDef.after",
  option: "EventDef.options (see the option inventory below)",
};

/** Event fields deliberately not surfaced, one reason each. */
const UNSURFACED_EVENT_FIELDS: Readonly<Record<string, string>> = {
  base: "event inheritance (subtype[inherited]); the SDK has no base-event concept — an author composes events in TypeScript instead",
  desc_clear: "clears an inherited event's desc; unreachable without `base`",
  option_clear: "clears an inherited event's options; unreachable without `base`",
  picture_clear: "clears an inherited event's picture; unreachable without `base`",
  show_sound_clear: "clears an inherited event's show_sound; unreachable without `base`",
  trigger_clear: "clears an inherited event's trigger; unreachable without `base`",
  picture_event_data:
    "the triggered room/portrait/background block; the SDK surfaces the flat `picture` only",
  custom_gui:
    "diplomatic-event gui_type pointer, declared `scalar` with a CWT comment saying it needs updating; the option-level custom_gui is surfaced",
  custom_gui_option: "same gui_type pointer, for the diplomatic option list",
  pre_triggers:
    "the colony/carrier/country pre-trigger alias block; an optimization over `trigger`, which the SDK does surface",
};

/** Option fields the SDK authors, and the `EventOption` member for each. */
const SURFACED_OPTION_FIELDS: Readonly<Record<string, string>> = {
  name: "EventOption.name",
  icon: "EventOption.icon",
  sound: "EventOption.sound",
  trigger: "EventOption.trigger",
  allow: "EventOption.allow",
  exclusive_trigger: "EventOption.exclusiveTrigger",
  ai_chance: "EventOption.aiChance",
  response_text: "EventOption.responseText",
  is_dialog_only: "EventOption.isDialogOnly",
  hide_option_if_not_allowed: "EventOption.hideIfNotAllowed",
  default_hide_option: "EventOption.defaultHideOption",
  custom_gui: "EventOption.customGui",
  tag: "EventOption.tag",
};

/** Option fields deliberately not surfaced. Empty: the SDK covers all of them. */
const UNSURFACED_OPTION_FIELDS: Readonly<Record<string, string>> = {};

/** `subtype[!hidden]` -> true. Subtype blocks hold fields of the same
 * definition, conditionally, so their contents belong to the level above. */
function isSubtype(key: string): boolean {
  return key.startsWith("subtype[");
}

/**
 * The field names one definition block declares, subtypes flattened in.
 *
 * Deliberately a set of names and nothing else: what the SDK has to react to
 * is a name appearing or disappearing. `alias_name[...]` is a splice of
 * another rule category rather than a field, and the effect splice at the
 * bottom of `option` is exactly what `EventOption.effects` records.
 */
function fieldNames(block: CwtBlock): Set<string> {
  const names = new Set<string>();
  const walk = (nodes: readonly CwtNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "assignment") {
        continue;
      }
      const key = node.key.text;
      if (isSubtype(key)) {
        if (node.value.kind === "block") {
          walk(node.value.nodes);
        }
        continue;
      }
      if (key.startsWith("alias_name[")) {
        continue;
      }
      names.add(key);
    }
  };
  walk(block.nodes);
  return names;
}

/** The block a named field carries, looked up the same subtype-flattened way. */
function blockOf(block: CwtBlock, field: string): CwtBlock | undefined {
  let found: CwtBlock | undefined;
  const walk = (nodes: readonly CwtNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "assignment") {
        continue;
      }
      if (isSubtype(node.key.text) && node.value.kind === "block") {
        walk(node.value.nodes);
      } else if (node.key.text === field && node.value.kind === "block") {
        found ??= node.value;
      }
    }
  };
  walk(block.nodes);
  return found;
}

function eventDefinitionBlock(): CwtBlock {
  const { nodes } = parseCwt(readFileSync(EVENTS_CWT, "utf8"), EVENTS_CWT);
  for (const node of nodes) {
    if (node.kind === "assignment" && node.key.text === "event" && node.value.kind === "block") {
      return node.value;
    }
  }
  throw new Error(
    `${EVENTS_CWT} declares no top-level \`event = { ... }\` block — the vendored rules moved ` +
      `the event definition, and this gate cannot read them`
  );
}

/**
 * Asserts an extracted inventory is exactly covered by its two acknowledged
 * sets, in both directions.
 */
function expectAcknowledged(
  what: string,
  declared: ReadonlySet<string>,
  surfaced: Readonly<Record<string, string>>,
  unsurfaced: Readonly<Record<string, string>>
): void {
  const acknowledged = new Set([...Object.keys(surfaced), ...Object.keys(unsurfaced)]);

  const unaccounted = [...declared].filter((field) => !acknowledged.has(field)).sort();
  expect(
    unaccounted,
    `the vendored rules declare ${what} fields nothing in this SDK accounts for. Each one is ` +
      `either a field to surface on the authoring type (add it to events.ts and to the ` +
      `SURFACED table here) or one to decline (add it to the UNSURFACED table with the ` +
      `reason). Both belong in the same review as the vendor bump that introduced them.`
  ).toEqual([]);

  const stale = [...acknowledged].filter((field) => !declared.has(field)).sort();
  expect(
    stale,
    `these ${what} fields are acknowledged here but the vendored rules no longer declare them ` +
      `— renamed or removed upstream, so what the SDK emits for them (or the reason it does ` +
      `not) describes a rule that is gone`
  ).toEqual([]);

  const both = Object.keys(surfaced).filter((field) => unsurfaced[field] !== undefined);
  expect(both, `these ${what} fields are listed as both surfaced and not surfaced`).toEqual([]);
}

describe("the event surface against the vendored events.cwt", () => {
  const event = eventDefinitionBlock();
  const eventFields = fieldNames(event);
  const optionBlock = blockOf(event, "option");

  it("reads a field inventory out of the vendored rules at all", () => {
    // Non-vacuity: an extraction that quietly returned nothing would satisfy
    // every "is acknowledged" assertion below.
    expect(eventFields.size).toBeGreaterThan(20);
    expect(optionBlock).toBeDefined();
  });

  it("accounts for every event field the rules declare", () => {
    expectAcknowledged("event", eventFields, SURFACED_EVENT_FIELDS, UNSURFACED_EVENT_FIELDS);
  });

  it("accounts for every option field the rules declare", () => {
    expectAcknowledged(
      "event option",
      fieldNames(optionBlock!),
      SURFACED_OPTION_FIELDS,
      UNSURFACED_OPTION_FIELDS
    );
  });
});
