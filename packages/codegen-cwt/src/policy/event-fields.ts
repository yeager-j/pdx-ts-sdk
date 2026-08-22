import { createHash } from "node:crypto";

import { armShape, ruleTypeSignature, scopeSignature } from "../cwt/fingerprint.ts";
import type { RuleField } from "../cwt/model.ts";
import type { RuleSet } from "../cwt/rules.ts";
import { docComment } from "../naming.ts";
import { EVENT_RULE_SIGNATURES, OPTION_RULE_SIGNATURES } from "./event-field-signatures.ts";

interface EventFieldMember {
  readonly member: string;
  readonly type: string;
  readonly required?: true;
}

export interface EventFieldPolicyEntry {
  readonly scriptKey: string;
  readonly shape: string;
  readonly disposition: "supported" | "partial" | "unsupported";
  readonly reason: string;
  readonly unsupportedForms?: readonly string[];
  /** Complete canonical CWT arm signature, attached after validation. */
  readonly ruleSignature?: string;
  readonly members?: readonly EventFieldMember[];
  /** An alias splice rather than a named field in the CWT block. */
  readonly synthetic?: true;
}

const supported = (
  scriptKey: string,
  shape: string,
  member: string,
  type: string,
  reason: string,
  required = false
): EventFieldPolicyEntry => ({
  scriptKey,
  shape,
  disposition: "supported",
  reason,
  members: [{ member, type, ...(required ? { required: true as const } : {}) }],
});

const partial = (
  scriptKey: string,
  shape: string,
  member: string,
  type: string,
  reason: string,
  unsupportedForms: readonly string[],
  required = false
): EventFieldPolicyEntry => ({
  ...supported(scriptKey, shape, member, type, reason, required),
  disposition: "partial",
  unsupportedForms,
});

const EVENT_FIELDS: readonly EventFieldPolicyEntry[] = [
  supported("id", "scalar 1..1", "id", "number", "numeric id within the event namespace", true),
  supported("title", "scalar 0..1 | scalar 1..1", "title", "string", "localized title"),
  {
    ...supported(
      "desc",
      "block 0..inf {exclusive_trigger, show_sound, text, trigger} | scalar 0..1 | scalar 1..1",
      "desc",
      "string",
      "one scalar plus the complete repeated conditional-description block"
    ),
    members: [
      { member: "desc", type: "string" },
      { member: "conditionalDesc", type: "readonly EventTriggeredDescription<S>[]" },
    ],
  },
  supported(
    "diplomatic_title",
    "scalar 0..1",
    "diplomaticTitle",
    "string",
    "diplomatic-screen title"
  ),
  supported("message_desc", "scalar 0..1", "messageDesc", "string", "message-feed description"),
  partial(
    "picture",
    "block 0..inf {picture, trigger} | scalar 0..0 | scalar 0..inf | scalar 1..inf",
    "picture",
    "SpriteRef | string",
    "one scalar picture arm",
    ["repeated scalar picture values", "triggered picture blocks"]
  ),
  partial(
    "show_sound",
    "block 0..inf {sound, sound_is_advisor, trigger} | scalar 0..0 | scalar 0..inf",
    "showSound",
    "SoundEffectRef | string",
    "one scalar sound arm",
    ["repeated scalar sound values", "triggered show_sound blocks"]
  ),
  supported(
    "event_picture_background",
    "scalar 0..1",
    "eventPictureBackground",
    "SpriteRef | string",
    "event-window background"
  ),
  supported(
    "notification_event_icon",
    "scalar 0..1",
    "notificationEventIcon",
    "SpriteRef | string",
    "notification-feed icon"
  ),
  supported(
    "event_window_type",
    "scalar 0..1",
    "eventWindowType",
    "EventWindowType",
    "closed event-window enum"
  ),
  supported(
    "event_message_type",
    "scalar 0..1",
    "eventMessageType",
    "MessageTypeRef | string",
    "message-type reference"
  ),
  supported(
    "event_chain",
    "scalar 0..1",
    "eventChain",
    "EventChainRef | string",
    "event-chain reference"
  ),
  supported("specimen", "scalar 0..1", "specimen", "SpecimenRef | string", "specimen reference"),
  supported(
    "situation",
    "scalar 0..1",
    "situation",
    "EventSituation<S, From>",
    "situation scope value"
  ),
  supported(
    "location",
    "scalar 0..0 | scalar 0..1",
    "location",
    "EventLocation<S, From>",
    "event window location"
  ),
  ...[
    ["hide_window", "hideWindow"],
    ["diplomatic", "diplomatic"],
    ["force_open", "forceOpen"],
    ["major", "major"],
    ["trackable", "trackable"],
    ["is_advisor_event", "isAdvisorEvent"],
    ["auto_select", "autoSelect"],
    ["auto_opens", "autoOpens"],
    ["is_test_event", "isTestEvent"],
    ["is_triggered_only", "isTriggeredOnly"],
    ["fire_only_once", "fireOnlyOnce"],
  ].map(([key, member]) =>
    supported(key!, "scalar 0..1", member!, "boolean", "CWT boolean event field")
  ),
  /**
   * `subtype[major]` is an attribute subtype driven by `major`, not the event
   * kind, so this is deliberately not conditioned on `S`. CWT's example
   * filters the other countries that receive the event, once per candidate
   * recipient. That makes the nested trigger country-scoped independently of
   * the scope in which the major event itself runs.
   */
  supported(
    "major_trigger",
    "block 0..1 {alias_name[trigger]}",
    "majorTrigger",
    'Trigger<"country">',
    "recipient-country visibility gate"
  ),
  /**
   * `archaeology` is declared only under `subtype[fleet]`; vanilla dig-stage
   * events require it to render in the excavation window. Conditioning it on
   * `S` preserves that event-kind restriction in the generated interface.
   */
  supported(
    "archaeology",
    "scalar 0..1",
    "archaeology",
    'S extends "fleet" ? boolean : never',
    "fleet-event window flag"
  ),
  supported(
    "first_contact",
    "scalar 0..1",
    "firstContact",
    'S extends "first_contact" ? boolean : never',
    "first-contact window flag"
  ),
  supported(
    "espionage_operation",
    "scalar 0..1",
    "espionageOperation",
    'S extends "espionage_operation" ? boolean : never',
    "espionage-operation window flag"
  ),
  supported(
    "astral_rift",
    "scalar 0..1",
    "astralRift",
    'S extends "astral_rift" ? boolean : never',
    "astral-rift window flag"
  ),
  supported(
    "difficulty",
    "scalar 0..1",
    "difficulty",
    'S extends "astral_rift" ? number : never',
    "astral-rift difficulty"
  ),
  supported(
    "trigger",
    "block 0..1 {alias_name[trigger]}",
    "trigger",
    "Trigger<S>",
    "event visibility gate"
  ),
  supported(
    "abort_trigger",
    "block 0..1 {alias_name[trigger]}",
    "abortTrigger",
    "Trigger<S>",
    "event cancellation gate"
  ),
  supported(
    "abort_effect",
    "block 0..1 {alias_name[effect]}",
    "abortEffect",
    "EventEffect<S, From>",
    "effects run on abort"
  ),
  supported(
    "mean_time_to_happen",
    "block 0..1 {alias_name[modifier_rule], days, months, years}",
    "meanTimeToHappen",
    "MeanTimeToHappen<S>",
    "non-triggered scheduling weight"
  ),
  supported(
    "weight_multiplier",
    "block 0..1 {alias_name[modifier_rule], factor}",
    "weightMultiplier",
    "WeightMultiplier<S>",
    "triggered scheduling weight"
  ),
  supported(
    "immediate",
    "block 0..1 {alias_name[effect]}",
    "immediate",
    "EventEffect<S, From>",
    "immediate effect splice"
  ),
  supported(
    "after",
    "block 0..1 {alias_name[effect]}",
    "after",
    "EventEffect<S, From>",
    "after effect splice"
  ),
  supported(
    "option",
    "block 0..inf {ai_chance, alias_name[effect], allow, custom_gui, default_hide_option, exclusive_trigger, hide_option_if_not_allowed, icon, is_dialog_only, name, response_text, sound, tag, trigger}",
    "options",
    "ReadonlyArray<EventOption<S, From>>",
    "repeated event options"
  ),
  ...[
    ["base", "event inheritance is deliberately replaced by TypeScript composition"],
    ["desc_clear", "unreachable without event inheritance"],
    ["option_clear", "unreachable without event inheritance"],
    ["picture_clear", "unreachable without event inheritance"],
    ["show_sound_clear", "unreachable without event inheritance"],
    ["trigger_clear", "unreachable without event inheritance"],
  ].map(([scriptKey, reason]) => ({
    scriptKey: scriptKey!,
    shape: scriptKey === "base" ? "scalar 1..1" : "scalar 0..1",
    disposition: "unsupported" as const,
    reason: reason!,
  })),
  {
    scriptKey: "picture_event_data",
    shape:
      "block 0..inf {city_level, graphical_culture, planet_background, portrait, room, tooltip, trigger}",
    disposition: "unsupported",
    reason: "the SDK surfaces the flat picture arm only",
  },
  {
    scriptKey: "custom_gui",
    shape: "scalar 0..1",
    disposition: "unsupported",
    reason: "diplomatic-event gui pointer remains underspecified in CWT",
  },
  {
    scriptKey: "custom_gui_option",
    shape: "scalar 0..1",
    disposition: "unsupported",
    reason: "diplomatic option-list gui pointer remains underspecified in CWT",
  },
  {
    scriptKey: "pre_triggers",
    shape:
      "block 0..1 {alias_name[colony_pre_trigger]} | block 0..1 {alias_name[country_pre_trigger]}",
    disposition: "unsupported",
    reason: "optimization aliases; the ordinary trigger field is surfaced",
  },
];

const OPTION_FIELDS: readonly EventFieldPolicyEntry[] = [
  partial(
    "name",
    "block 1..inf {exclusive_trigger, text} | block 1..inf {text, trigger} | scalar 1..inf",
    "name",
    "string",
    "one localized scalar name arm",
    ["repeated scalar names", "triggered name blocks"],
    true
  ),
  supported(
    "icon",
    "block 0..1 {icon, icon_background, text}",
    "icon",
    "EventOptionIcon",
    "complete icon block"
  ),
  supported("sound", "scalar 0..1", "sound", "string", "raw sound key"),
  supported(
    "trigger",
    "block 0..1 {alias_name[trigger]}",
    "trigger",
    "Trigger<S>",
    "visibility gate"
  ),
  supported(
    "allow",
    "block 0..1 {alias_name[trigger]}",
    "allow",
    "Trigger<S>",
    "availability gate"
  ),
  supported(
    "exclusive_trigger",
    "block 0..1 {alias_name[trigger]}",
    "exclusiveTrigger",
    "Trigger<S>",
    "exclusive visibility gate"
  ),
  supported(
    "ai_chance",
    "block 0..1 {alias_name[modifier_rule]}",
    "aiChance",
    "AiChance<S>",
    "modifier-rule AI weighting"
  ),
  supported("response_text", "scalar 0..1", "responseText", "string", "localized response text"),
  supported("is_dialog_only", "scalar 0..1", "isDialogOnly", "boolean", "dialog-only flag"),
  supported(
    "hide_option_if_not_allowed",
    "scalar 0..1",
    "hideIfNotAllowed",
    "boolean",
    "allow-gated hiding"
  ),
  supported("default_hide_option", "scalar 0..1", "defaultHideOption", "boolean", "default hiding"),
  supported("custom_gui", "scalar 0..1", "customGui", "string", "option gui pointer"),
  supported("tag", "scalar 0..1", "tag", "string", "event-option tag"),
  {
    scriptKey: "alias_name[effect]",
    shape: "splice",
    disposition: "supported",
    reason: "the option block's effect splice",
    members: [{ member: "effects", type: "EventEffect<S, From>" }],
    synthetic: true,
  },
];

function armSignature(field: RuleField): string {
  const cardinality = `${field.cardinality.min}..${field.cardinality.max ?? "inf"}`;
  return `${cardinality}:${field.comparison ? "comparison" : "assignment"}:${scopeSignature(field)}:${ruleTypeSignature(field.type)}`;
}

function fieldShapes(fields: readonly RuleField[]): Map<string, string> {
  const arms = new Map<string, Set<string>>();
  const visit = (items: readonly RuleField[]): void => {
    for (const field of items) {
      if (field.key.kind === "subtype") {
        if (field.type.kind === "block") visit(field.type.fields);
      } else if (field.key.kind === "name") {
        arms.set(field.key.name, (arms.get(field.key.name) ?? new Set()).add(armShape(field)));
      }
    }
  };
  visit(fields);
  return new Map([...arms].map(([key, values]) => [key, [...values].sort().join(" | ")]));
}

function fieldSignatures(fields: readonly RuleField[]): Map<string, string> {
  const arms = new Map<string, Set<string>>();
  const visit = (items: readonly RuleField[]): void => {
    for (const field of items) {
      if (field.key.kind === "subtype") {
        if (field.type.kind === "block") visit(field.type.fields);
      } else if (field.key.kind === "name") {
        arms.set(field.key.name, (arms.get(field.key.name) ?? new Set()).add(armSignature(field)));
      }
    }
  };
  visit(fields);
  return new Map([...arms].map(([key, values]) => [key, [...values].sort().join(" | ")]));
}

function signatureHash(signature: string): string {
  return createHash("sha256").update(signature).digest("hex");
}

export function eventFieldRuleSignatures(rules: RuleSet): {
  event: ReadonlyMap<string, string>;
  option: ReadonlyMap<string, string>;
} {
  const body = rules.bodies.get("event");
  if (body === undefined) throw new Error("events.cwt declares no event body");
  const option = blockFields(body.fields, "option");
  if (option.length === 0) throw new Error("events.cwt declares no option block");
  return { event: fieldSignatures(body.fields), option: fieldSignatures(option) };
}

function blockFields(fields: readonly RuleField[], name: string): readonly RuleField[] {
  for (const field of fields) {
    if (field.key.kind === "subtype" && field.type.kind === "block") {
      const nested = blockFields(field.type.fields, name);
      if (nested.length > 0) return nested;
    } else if (
      field.key.kind === "name" &&
      field.key.name === name &&
      field.type.kind === "block"
    ) {
      return field.type.fields;
    }
  }
  return [];
}

function validate(
  what: string,
  declaredSignatures: ReadonlyMap<string, string>,
  declaredShapes: ReadonlyMap<string, string>,
  policy: readonly EventFieldPolicyEntry[],
  expectedSignatures: Readonly<Record<string, string>>
): void {
  const byKey = new Map(policy.map((entry) => [entry.scriptKey, entry]));
  const missing = [...declaredSignatures.keys()].filter((key) => !byKey.has(key));
  const stale = [...byKey]
    .filter(([, entry]) => !entry.synthetic)
    .map(([key]) => key)
    .filter((key) => !declaredSignatures.has(key));
  const signatureKeys = Object.keys(expectedSignatures);
  const missingSignatures = [...declaredSignatures.keys()].filter(
    (key) => expectedSignatures[key] === undefined
  );
  const staleSignatures = signatureKeys.filter((key) => !declaredSignatures.has(key));
  const reshaped = [...declaredSignatures].filter(
    ([key, signature]) => expectedSignatures[key] !== signatureHash(signature)
  );
  const staleShapeDescriptions = [...declaredShapes].filter(
    ([key, shape]) => byKey.get(key)?.shape !== shape
  );
  if (
    missing.length ||
    stale.length ||
    missingSignatures.length ||
    staleSignatures.length ||
    reshaped.length ||
    staleShapeDescriptions.length
  ) {
    throw new Error(
      `${what} field policy disagrees with events.cwt` +
        (missing.length ? `; unowned: ${missing.join(", ")}` : "") +
        (stale.length ? `; stale: ${stale.join(", ")}` : "") +
        (missingSignatures.length ? `; missing signatures: ${missingSignatures.join(", ")}` : "") +
        (staleSignatures.length ? `; stale signatures: ${staleSignatures.join(", ")}` : "") +
        (reshaped.length
          ? `; reshaped: ${reshaped
              .map(
                ([key, signature]) =>
                  `${key} (${signature}; actual hash ${signatureHash(signature)}; policy hash ${expectedSignatures[key]})`
              )
              .join(", ")}`
          : "") +
        (staleShapeDescriptions.length
          ? `; stale shape descriptions: ${staleShapeDescriptions
              .map(([key, shape]) => `${key} (${shape}; policy ${byKey.get(key)!.shape})`)
              .join(", ")}`
          : "")
    );
  }
}

export function createEventFieldPolicy(rules: RuleSet): {
  event: readonly EventFieldPolicyEntry[];
  option: readonly EventFieldPolicyEntry[];
} {
  const body = rules.bodies.get("event");
  if (body === undefined) throw new Error("events.cwt declares no event body");
  const signatures = eventFieldRuleSignatures(rules);
  validate(
    "event",
    signatures.event,
    fieldShapes(body.fields),
    EVENT_FIELDS,
    EVENT_RULE_SIGNATURES
  );
  const option = blockFields(body.fields, "option");
  if (option.length === 0) throw new Error("events.cwt declares no option block");
  if (!option.some((field) => field.key.kind === "aliasName" && field.key.category === "effect")) {
    throw new Error("events.cwt option block no longer splices alias_name[effect]");
  }
  validate(
    "event option",
    signatures.option,
    fieldShapes(option),
    OPTION_FIELDS,
    OPTION_RULE_SIGNATURES
  );
  const attachSignature = (
    entry: EventFieldPolicyEntry,
    declared: ReadonlyMap<string, string>
  ) => ({
    ...entry,
    ruleSignature: entry.synthetic ? entry.shape : declared.get(entry.scriptKey)!,
  });
  return {
    event: EVENT_FIELDS.map((entry) => attachSignature(entry, signatures.event)),
    option: OPTION_FIELDS.map((entry) => attachSignature(entry, signatures.option)),
  };
}

function interfaceMembers(policy: readonly EventFieldPolicyEntry[]): string {
  return policy
    .filter((entry) => entry.disposition !== "unsupported")
    .flatMap((entry) =>
      (entry.members ?? []).map(
        (member) =>
          docComment([entry.reason], "  ") +
          `  readonly ${member.member}${member.required ? "" : "?"}: ${member.type};\n`
      )
    )
    .join("");
}

function ledger(name: string, policy: readonly EventFieldPolicyEntry[]): string {
  return (
    `export const ${name} = [\n` +
    policy
      .map(
        (entry) =>
          `  ${JSON.stringify({ scriptKey: entry.scriptKey, shape: entry.shape, ruleSignature: entry.ruleSignature, disposition: entry.disposition, reason: entry.reason, ...(entry.unsupportedForms === undefined ? {} : { unsupportedForms: entry.unsupportedForms }) })},\n`
      )
      .join("") +
    "] as const;\n"
  );
}

export function emitEventFieldProtocol(policy: ReturnType<typeof createEventFieldPolicy>): string {
  return (
    'import type { ScopeObjOf } from "./effects.ts";\n' +
    'import type { EventChainRef, MessageTypeRef, SoundEffectRef, SpecimenRef, SpriteRef } from "./refs.ts";\n' +
    'import type { ScopeName } from "./scopes.ts";\n' +
    'import type { ScriptCtx } from "../script/effects/types.ts";\n' +
    'import type { Trigger } from "../script/trigger-core.ts";\n' +
    'import type { AiChance, EventLocation, EventOption, EventOptionIcon, EventSituation, EventTriggeredDescription, EventWindowType, MeanTimeToHappen, WeightMultiplier } from "../events/types.ts";\n\n' +
    "type EventEffect<S extends ScopeName, From extends ScopeName | undefined> = (scope: ScopeObjOf<S>, ctx: ScriptCtx<S, From>) => void;\n\n" +
    docComment(["Event authoring fields projected from the reviewed CWT support policy."]) +
    "export interface GeneratedEventFields<S extends ScopeName, From extends ScopeName | undefined> {\n" +
    interfaceMembers(policy.event) +
    "}\n\n" +
    docComment(["Event option authoring fields projected from the reviewed CWT support policy."]) +
    "export interface GeneratedEventOptionFields<S extends ScopeName, From extends ScopeName | undefined> {\n" +
    interfaceMembers(policy.option) +
    "}\n\n" +
    ledger("EVENT_FIELD_SUPPORT", policy.event) +
    "\n" +
    ledger("EVENT_OPTION_FIELD_SUPPORT", policy.option)
  );
}
