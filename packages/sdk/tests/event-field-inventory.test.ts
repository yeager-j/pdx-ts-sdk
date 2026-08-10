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
 * (with the reason). Three ways to fail — a new field is unaccounted, a
 * vanished field leaves an acknowledgement describing nothing, and a field
 * whose *shape* moved no longer matches what was acknowledged.
 *
 * The shape, not just the name, because a name-only inventory reads partial
 * support as complete support. `desc` is a localisation scalar *and* a
 * triggered block; `picture` and `show_sound` are repeated scalars *and*
 * triggered blocks; `option.name` has a plain form and two trigger-keyed ones
 * — and the SDK surfaces the scalar arm of each. Recording one arm per field
 * would let an upstream reshape, or a new arm on a field the SDK "already
 * supports", pass silently. So each acknowledgement carries the field's full
 * arm set: `scalar`/`block`, the cardinality CWT declares, and a block's own
 * member names.
 *
 * The acknowledged sets are the reviewable artifact. On a vendor bump the diff
 * a maintainer reads is one line per field — which side it landed on, what
 * shape the rules give it, and why — rather than a re-reading of the whole
 * `.cwt` block. One consequence worth knowing: an added *option* field fails
 * twice, once in the option inventory and once in the `option` entry's arm
 * members, because it genuinely changes both.
 *
 * Hermetic: the vendored rules are in-repo, and this uses the same parser
 * codegen does, so `##`/`###` comments and `alias_name[...]` splices cannot be
 * mistaken for fields.
 */

import { readFileSync } from "node:fs";
import { cardinalityOf } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt, type CwtBlock, type CwtNode } from "@pdx-ts/codegen-cwt/cwt/parser";
import { describe, expect, it } from "vitest";

// Repo-root-relative: vitest runs from the workspace root.
const EVENTS_CWT = "vendor/cwtools-stellaris-config/config/events/events.cwt";

/**
 * One acknowledged field: the arm set the vendored rules declare for it, and
 * what the SDK does about it. The first element is machine-compared; the
 * second is for the reader.
 */
type Acknowledgement = readonly [cwtShape: string, note: string];

/**
 * Event fields the SDK authors, and the `EventDef` member that writes each.
 * `buildEvent` (`events.ts`) is the lowering; `tests/event-fields.test.ts` is
 * where the emitted bytes are pinned. Where the rules declare several arms and
 * the SDK writes one, the note says which.
 */
const SURFACED_EVENT_FIELDS: Readonly<Record<string, Acknowledgement>> = {
  id: ["scalar 1..1", "EventDef.id, as `<namespace>.<id>`"],
  title: ["scalar 0..1 | scalar 1..1", "EventDef.title (the 0..1 arm is subtype[hidden]'s)"],
  desc: [
    "block 0..inf {exclusive_trigger, show_sound, text, trigger} | scalar 0..1 | scalar 1..1",
    "EventDef.desc writes one scalar and EventDef.conditionalDesc writes the complete repeated block; repeated scalars are not surfaced",
  ],
  diplomatic_title: ["scalar 0..1", "EventDef.diplomaticTitle"],
  message_desc: ["scalar 0..1", "EventDef.messageDesc"],
  picture: [
    "block 0..inf {picture, trigger} | scalar 0..0 | scalar 0..inf | scalar 1..inf",
    "EventDef.picture — one scalar; neither the repetition nor the triggered-picture block is surfaced",
  ],
  show_sound: [
    "block 0..inf {sound, sound_is_advisor, trigger} | scalar 0..0 | scalar 0..inf",
    "EventDef.showSound — one scalar; the triggered show_sound block is not surfaced",
  ],
  event_picture_background: ["scalar 0..1", "EventDef.eventPictureBackground"],
  notification_event_icon: ["scalar 0..1", "EventDef.notificationEventIcon"],
  event_window_type: ["scalar 0..1", "EventDef.eventWindowType"],
  event_message_type: ["scalar 0..1", "EventDef.eventMessageType"],
  event_chain: ["scalar 0..1", "EventDef.eventChain"],
  specimen: ["scalar 0..1", "EventDef.specimen"],
  situation: ["scalar 0..1", "EventDef.situation"],
  location: ["scalar 0..0 | scalar 0..1", "EventDef.location (0..0 is subtype[hidden]'s ban)"],
  hide_window: ["scalar 0..1", "EventDef.hideWindow"],
  diplomatic: ["scalar 0..1", "EventDef.diplomatic"],
  force_open: ["scalar 0..1", "EventDef.forceOpen"],
  major: ["scalar 0..1", "EventDef.major"],
  major_trigger: ["scalar 0..1", "EventDef.majorTrigger"],
  trackable: ["scalar 0..1", "EventDef.trackable"],
  is_advisor_event: ["scalar 0..1", "EventDef.isAdvisorEvent"],
  auto_select: ["scalar 0..1", "EventDef.autoSelect"],
  auto_opens: ["scalar 0..1", "EventDef.autoOpens"],
  is_test_event: ["scalar 0..1", "EventDef.isTestEvent"],
  is_triggered_only: ["scalar 0..1", "EventDef.isTriggeredOnly"],
  fire_only_once: ["scalar 0..1", "EventDef.fireOnlyOnce"],
  archaeology: ["scalar 0..1", "EventDef.archaeology (fleet events only)"],
  first_contact: ["scalar 0..1", "EventDef.firstContact (first-contact events only)"],
  espionage_operation: [
    "scalar 0..1",
    "EventDef.espionageOperation (espionage-operation events only)",
  ],
  astral_rift: ["scalar 0..1", "EventDef.astralRift (astral-rift events only)"],
  difficulty: ["scalar 0..1", "EventDef.difficulty (astral-rift events only)"],
  trigger: ["scalar 0..1", "EventDef.trigger"],
  abort_trigger: ["scalar 0..1", "EventDef.abortTrigger"],
  abort_effect: ["scalar 0..1", "EventDef.abortEffect"],
  mean_time_to_happen: [
    "block 0..1 {alias_name[modifier_rule], days, months, years}",
    "EventDef.meanTimeToHappen — days/months/years plus `modifiers` for the splice",
  ],
  weight_multiplier: [
    "block 0..1 {alias_name[modifier_rule], factor}",
    "EventDef.weightMultiplier — factor plus `modifiers` for the splice",
  ],
  immediate: ["scalar 0..1", "EventDef.immediate"],
  after: ["scalar 0..1", "EventDef.after"],
  option: [
    "block 0..inf {ai_chance, alias_name[effect], allow, custom_gui, default_hide_option, exclusive_trigger, hide_option_if_not_allowed, icon, is_dialog_only, name, response_text, sound, tag, trigger}",
    "EventDef.options; the block's own members are the option inventory below, and the effect splice is EventOption.effects",
  ],
};

/** Event fields deliberately not surfaced, one reason each. */
const UNSURFACED_EVENT_FIELDS: Readonly<Record<string, Acknowledgement>> = {
  base: [
    "scalar 1..1",
    "event inheritance (subtype[inherited]); the SDK has no base-event concept — an author composes events in TypeScript instead",
  ],
  desc_clear: ["scalar 0..1", "clears an inherited event's desc; unreachable without `base`"],
  option_clear: ["scalar 0..1", "clears an inherited event's options; unreachable without `base`"],
  picture_clear: ["scalar 0..1", "clears an inherited event's picture; unreachable without `base`"],
  show_sound_clear: [
    "scalar 0..1",
    "clears an inherited event's show_sound; unreachable without `base`",
  ],
  trigger_clear: ["scalar 0..1", "clears an inherited event's trigger; unreachable without `base`"],
  picture_event_data: [
    "block 0..inf {city_level, graphical_culture, planet_background, portrait, room, tooltip, trigger}",
    "the triggered room/portrait/background block; the SDK surfaces the flat `picture` only",
  ],
  custom_gui: [
    "scalar 0..1",
    "diplomatic-event gui_type pointer, declared `scalar` with a CWT comment saying it needs updating; the option-level custom_gui is surfaced",
  ],
  custom_gui_option: ["scalar 0..1", "same gui_type pointer, for the diplomatic option list"],
  pre_triggers: [
    "block 0..1 {alias_name[colony_pre_trigger]} | block 0..1 {alias_name[country_pre_trigger]}",
    "the colony/carrier/country pre-trigger alias blocks; an optimization over `trigger`, which the SDK does surface",
  ],
};

/** Option fields the SDK authors, and the `EventOption` member for each. */
const SURFACED_OPTION_FIELDS: Readonly<Record<string, Acknowledgement>> = {
  name: [
    "block 1..inf {exclusive_trigger, text} | block 1..inf {text, trigger} | scalar 1..inf",
    "EventOption.name — the scalar arm only; neither trigger-keyed name form is surfaced",
  ],
  icon: ["block 0..1 {icon, icon_background, text}", "EventOption.icon (EventOptionIcon)"],
  sound: ["scalar 0..1", "EventOption.sound"],
  trigger: ["scalar 0..1", "EventOption.trigger"],
  allow: ["scalar 0..1", "EventOption.allow"],
  exclusive_trigger: ["scalar 0..1", "EventOption.exclusiveTrigger"],
  ai_chance: [
    "block 0..1 {alias_name[modifier_rule]}",
    "EventOption.aiChance — `factor` and `modifiers` both come from the modifier_rule splice",
  ],
  response_text: ["scalar 0..1", "EventOption.responseText"],
  is_dialog_only: ["scalar 0..1", "EventOption.isDialogOnly"],
  hide_option_if_not_allowed: ["scalar 0..1", "EventOption.hideIfNotAllowed"],
  default_hide_option: ["scalar 0..1", "EventOption.defaultHideOption"],
  custom_gui: ["scalar 0..1", "EventOption.customGui"],
  tag: ["scalar 0..1", "EventOption.tag"],
};

/** Option fields deliberately not surfaced. Empty: the SDK covers all of them. */
const UNSURFACED_OPTION_FIELDS: Readonly<Record<string, Acknowledgement>> = {};

/** `subtype[!hidden]` -> true. Subtype blocks hold fields of the same
 * definition, conditionally, so their contents belong to the level above. */
function isSubtype(key: string): boolean {
  return key.startsWith("subtype[");
}

/** A block's own member names, subtypes flattened the same way. */
function memberNames(nodes: readonly CwtNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== "assignment") {
      return [];
    }
    return isSubtype(node.key.text) && node.value.kind === "block"
      ? memberNames(node.value.nodes)
      : [node.key.text];
  });
}

/**
 * One declared arm, normalized: form, the cardinality CWT annotates (an
 * unannotated field is `1..1`, the rules' own default, which `cardinalityOf`
 * applies), and for a block its member names. Deduped by the caller, so two
 * subtypes declaring the identical arm read as one.
 */
function armOf(node: CwtNode & { readonly kind: "assignment" }): string {
  const cardinality = cardinalityOf(node.options);
  const range = `${cardinality.min}..${cardinality.max === null ? "inf" : cardinality.max}`;
  if (node.value.kind === "scalar") {
    return `scalar ${range}`;
  }
  const members = [...new Set(memberNames(node.value.nodes))].sort();
  return `block ${range} {${members.join(", ")}}`;
}

/**
 * Every field one definition block declares, as field name -> arm set.
 *
 * `alias_name[...]` is a splice of another rule category rather than a field
 * of this one, so it is not an inventory entry — but it stays in a block arm's
 * member list, where it is part of that block's shape (`ai_chance`'s entire
 * content arrives through one).
 */
function fieldShapes(block: CwtBlock): Map<string, string> {
  const arms = new Map<string, Set<string>>();
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
      arms.set(key, (arms.get(key) ?? new Set<string>()).add(armOf(node)));
    }
  };
  walk(block.nodes);
  return new Map([...arms].map(([key, set]) => [key, [...set].sort().join(" | ")]));
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
 * sets — every name on exactly one side, and every shape as recorded.
 */
function expectAcknowledged(
  what: string,
  declared: ReadonlyMap<string, string>,
  surfaced: Readonly<Record<string, Acknowledgement>>,
  unsurfaced: Readonly<Record<string, Acknowledgement>>
): void {
  const acknowledged = new Map<string, Acknowledgement>([
    ...Object.entries(surfaced),
    ...Object.entries(unsurfaced),
  ]);

  const unaccounted = [...declared.keys()].filter((field) => !acknowledged.has(field)).sort();
  expect(
    unaccounted,
    `the vendored rules declare ${what} fields nothing in this SDK accounts for. Each one is ` +
      `either a field to surface on the authoring type (add it to events.ts and to the ` +
      `SURFACED table here) or one to decline (add it to the UNSURFACED table with the ` +
      `reason). Both belong in the same review as the vendor bump that introduced them.\n` +
      unaccounted.map((field) => `  ${field}: ${declared.get(field)!}`).join("\n")
  ).toEqual([]);

  const stale = [...acknowledged.keys()].filter((field) => !declared.has(field)).sort();
  expect(
    stale,
    `these ${what} fields are acknowledged here but the vendored rules no longer declare them ` +
      `— renamed or removed upstream, so what the SDK emits for them (or the reason it does ` +
      `not) describes a rule that is gone`
  ).toEqual([]);

  const reshaped = [...declared]
    .filter(([field, shape]) => {
      const entry = acknowledged.get(field);
      return entry !== undefined && entry[0] !== shape;
    })
    .map(
      ([field, shape]) =>
        `  ${field}\n    rules:        ${shape}\n    acknowledged: ${acknowledged.get(field)![0]}`
    );
  expect(
    reshaped,
    `these ${what} fields changed shape upstream — an arm was added, removed, or recast. The ` +
      `SDK may now be surfacing a form the rules no longer admit, or missing one they added; ` +
      `decide which, adjust events.ts if it needs it, and record the new shape here.\n` +
      reshaped.join("\n")
  ).toEqual([]);

  const both = Object.keys(surfaced).filter((field) => unsurfaced[field] !== undefined);
  expect(both, `these ${what} fields are listed as both surfaced and not surfaced`).toEqual([]);
}

describe("the event surface against the vendored events.cwt", () => {
  const event = eventDefinitionBlock();
  const eventFields = fieldShapes(event);
  const optionBlock = blockOf(event, "option");

  it("reads a field inventory out of the vendored rules at all", () => {
    // Non-vacuity: an extraction that quietly returned nothing would satisfy
    // every "is acknowledged" assertion below.
    expect(eventFields.size).toBeGreaterThan(20);
    expect(optionBlock).toBeDefined();
  });

  it("records every arm where the rules declare more than one", () => {
    // The gap this gate had: names alone read `desc` — a localisation scalar
    // and a repeated triggered block — as one supported thing. If the
    // extraction ever collapses back to one arm per field, these say so.
    for (const field of ["desc", "picture", "show_sound"]) {
      expect(eventFields.get(field), `${field} should declare several arms`).toContain(" | ");
    }
    expect(fieldShapes(optionBlock!).get("name")).toContain(" | ");
  });

  it("accounts for every event field the rules declare, and its shape", () => {
    expectAcknowledged("event", eventFields, SURFACED_EVENT_FIELDS, UNSURFACED_EVENT_FIELDS);
  });

  it("accounts for every option field the rules declare, and its shape", () => {
    expectAcknowledged(
      "event option",
      fieldShapes(optionBlock!),
      SURFACED_OPTION_FIELDS,
      UNSURFACED_OPTION_FIELDS
    );
  });
});
