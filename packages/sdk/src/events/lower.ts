/** Lowers typed event definitions into PDXScript entries. */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import {
  resolveDeferredLocalization,
  type ScriptLocalizationSink,
} from "../authoring/deferred-localization.ts";
import {
  isLocalizationRef,
  localizationRef,
  resolveFixedKeyText,
  resolveLocalizedText,
  type KeyedLocalization,
  type LocalizationInput,
  type LocalizationRef,
} from "../authoring/localization.ts";
import type { ModWarning } from "../diagnostics.ts";
import type { EventKindKey } from "../generated/events.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { localizationSuffix, shortLocalizationHash } from "../localization-key.ts";
import { recordLocalization, underField, type RecordedRefUse } from "../references.ts";
import {
  modifierDescKey,
  modifierEntry,
  registerModifierDescKey,
} from "../script/effects/modifiers.ts";
import { recordEffects, withScriptCtx } from "../script/effects/recorder.ts";
import type { AmbientScopeContext, Modifier, ScriptCtx } from "../script/effects/types.ts";
import { refId } from "../script/scalar.ts";
import type { DefinedEvent, EventBodyContext, EventDef, EventOptionLoc, LocSink } from "./types.ts";

/**
 * Lowers a `WeightBlock`-shaped modifier row list, reusing the `modifier_rule`
 * writer `script/effects/modifiers.ts` already exposes rather than re-deriving it — the
 * only field-specific bits (`factor` vs. `base`, which extra scalars come
 * before the rows) stay with each call site. `ownerKey` is the same
 * `${ownerId}::${fieldPath}` token `registerModifierDescs` below registered
 * this same field's desc-bearing rows under — required so a shared row
 * object resolves its own occurrence's key at lowering (PR #16 review
 * finding 3), the same reasoning `content/lower.ts`'s `descOwnerKey` documents.
 */
function modifierRows<S extends ScopeName>(
  modifiers: readonly Modifier<S>[] | undefined,
  refs: RecordedRefUse[],
  ownerKey: string
): PdxEntry[] {
  return (modifiers ?? []).map((modifier) =>
    modifierEntry(modifier as Modifier<ScopeName>, refs, ownerKey)
  );
}

/**
 * Registers one localisation key per desc-bearing row in a modifier list, via
 * the shared derivation `modifierDescKey` (`script/effects/modifiers.ts`) — the same one
 * `content/authoring.ts`'s `collectModifierDescs` uses, so the two never drift and a
 * future fix to the derivation reaches events automatically. Must run before
 * `modifierRows` lowers the same array: `modifierEntry` throws if a row's
 * `desc` reaches it unregistered, and an event has the stable id and
 * `LocSink` a registration needs, the same as every other
 * definition-attached localization slot.
 *
 * `warnings` collects the `unstable-desc-key` entry `modifierDescKey` returns
 * when a row falls back to a content hash — see `DefinedEvent.warnings` for
 * why events carry this on the returned event rather than through a
 * `ContentAuthoring`-style callback.
 *
 * Returns the `${ownerId}::${fieldPath}` token every row on this field was
 * registered under, for the caller to hand to the matching `modifierRows`
 * call — the same per-owner-occurrence scheme `content/lower.ts`'s `descOwnerKey`
 * uses, needed so a row object reused across two fields resolves its own
 * key rather than whichever registration ran last (PR #16 review finding 3).
 */
function registerModifierDescs<S extends ScopeName>(
  warnings: ModWarning[],
  locSink: LocSink,
  ownerId: string,
  fieldPath: string,
  modifiers: readonly Modifier<S>[] | undefined
): string {
  const ownerKey = `${ownerId}::${fieldPath}`;
  (modifiers ?? []).forEach((modifier) => {
    if (modifier.desc === undefined) {
      return;
    }
    if (isLocalizationRef(modifier.desc)) {
      return;
    }
    const { key, translations, unstableWarning } = modifierDescKey(
      ownerId,
      fieldPath,
      modifier.desc
    );
    locSink.register(key, translations);
    registerModifierDescKey(modifier as Modifier<ScopeName>, ownerKey, key);
    if (unstableWarning !== undefined) {
      warnings.push({ code: "unstable-desc-key", message: unstableWarning });
    }
  });
  return ownerKey;
}

/**
 * A conditional description's `text` as the list of entries it emits.
 *
 * The member takes one text or several, and a language record is itself an
 * object, so the arms are told apart by `Array.isArray` rather than by
 * "not a string".
 */
function conditionalDescTexts(
  text: LocalizationInput | readonly LocalizationInput[] | undefined
): readonly LocalizationInput[] {
  if (text === undefined) {
    return [];
  }
  return Array.isArray(text) ? (text as readonly LocalizationInput[]) : [text as LocalizationInput];
}

/**
 * Resolves one event text slot to the key its emitted entry stores, and the
 * reference `event.loc` reports for it.
 *
 * A reference is emitted as it stands and registers nothing: its text lives
 * wherever it was authored. It is still *recorded*, so a standalone
 * `mod.localization()` item consumed here is placed by the Feature that placed
 * this event and refused when another capability minted it (SDK-306) — the
 * same treatment a key-typed content field gives one.
 *
 * Inline text keys off `<event id>.<slot>`, which is fixed, so a `key` pin
 * would name a key nothing reads; `resolveFixedKeyText` says so rather than
 * dropping it.
 *
 * @param derivedKey - The key inline text is registered and emitted under.
 * @param position - Names the slot in a refusal, e.g. `Event "x.1" title`.
 * @param field - Dotted PDXScript key path recorded with a consumed item.
 */
function eventText(
  locSink: LocSink,
  refs: RecordedRefUse[],
  input: LocalizationInput,
  derivedKey: string,
  position: string,
  field: string
): LocalizationRef {
  if (isLocalizationRef(input)) {
    recordLocalization(refs, input, field);
    return input;
  }
  locSink.register(derivedKey, resolveFixedKeyText(input, position, derivedKey));
  return localizationRef(derivedKey);
}

/** An option's effective `name` reference and the stem its child text hangs off. */
interface OptionName {
  /** The reference the option's `name` writes, and `loc.options[i].name` reports. */
  readonly nameRef: LocalizationRef;
  /** The suffix under the event id that the option's child keys are built from. */
  readonly suffix: string;
  /** Whether the suffix hashes English text the author can still edit. */
  readonly unstable: boolean;
}

/**
 * Resolves an option's `name` to the key it emits and the stem its children use.
 *
 * Inline text keeps the existing behaviour exactly: the key pin, or a hash of
 * the English name, becomes both the emitted key's suffix and the child stem.
 * A reference is emitted as it stands, so the option has no suffix of its own;
 * hashing the referenced key gives it one that is still event-owned, since
 * defining `<other mod's key>.response` would write into that mod's namespace.
 */
function optionName(
  name: LocalizationInput,
  id: string,
  refs: RecordedRefUse[],
  where: string
): OptionName {
  if (isLocalizationRef(name)) {
    recordLocalization(refs, name, `${where}.name`);
    return { nameRef: name, suffix: shortLocalizationHash(name.key), unstable: false };
  }
  const resolved = resolveLocalizedText(name);
  const suffix = localizationSuffix(resolved.translations.english, resolved.key);
  return {
    nameRef: localizationRef(`${id}.${suffix.suffix}`),
    suffix: suffix.suffix,
    unstable: suffix.usedFallback,
  };
}

/**
 * SDK-internal cast for the four kind-gated window flags: `EventDef`
 * conditions their types on `S` so a wrong-kind `defineXEvent` call is a
 * compile error, but that makes them `S extends "fleet" ? boolean : never`
 * — a deferred conditional inside this generic function, where `S` is not
 * yet a literal. The cast reads them back as plain optional fields; the
 * compile-time guarantee already happened at the call site that built `def`.
 */
function windowFlags(def: object): {
  readonly archaeology?: boolean;
  readonly firstContact?: boolean;
  readonly espionageOperation?: boolean;
  readonly astralRift?: boolean;
  readonly difficulty?: number;
} {
  return def as never;
}

export function assertEventNumber(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new RangeError(`Event id ${String(id)} must be a non-negative safe integer`);
  }
}

export function buildEvent<S extends ScopeName, Context extends AmbientScopeContext>(
  kind: EventKindKey,
  scope: S,
  namespace: string,
  def: EventDef<S, Context>,
  locSink: LocSink
): DefinedEvent<S, Context> {
  assertEventNumber(def.id);
  // One ctx for the whole event: its `immediate`, `after`, `abort_effect` and
  // every option record separately, and all of them are this one lowering.
  const scopes = eventScopes(def.scopes);
  const bodyScopes = scopes as EventBodyContext<S, Context>;
  return withScriptCtx<S, typeof bodyScopes, DefinedEvent<S, Context>>({}, (ctx) =>
    lowerEvent<S, Context>(kind, scope, namespace, def, locSink, ctx)
  );
}

function lowerEvent<S extends ScopeName, Context extends AmbientScopeContext>(
  kind: EventKindKey,
  scope: S,
  namespace: string,
  def: EventDef<S, Context>,
  locSink: LocSink,
  ctx: ScriptCtx<S, EventBodyContext<S, Context>>
): DefinedEvent<S, Context> {
  const id = `${namespace}.${def.id}`;
  const flags = windowFlags(def);
  const warnings: ModWarning[] = [];
  const refs: RecordedRefUse[] = [];

  const entries: PdxEntry[] = [kv("id", id)];
  // Filled beside each registration below, so a reference and the entry it
  // points at are minted from one spelling of the key.
  const eventRefs: { title?: LocalizationRef; desc?: LocalizationRef } = {};
  const optionRefs: EventOptionLoc[] = [];
  if (def.title !== undefined) {
    const ref = eventText(locSink, refs, def.title, `${id}.name`, `Event "${id}" title`, "title");
    entries.push(kv("title", ref.key));
    eventRefs.title = ref;
  }
  if (def.desc !== undefined) {
    const ref = eventText(locSink, refs, def.desc, `${id}.desc`, `Event "${id}" desc`, "desc");
    entries.push(kv("desc", ref.key));
    eventRefs.desc = ref;
  }
  let descriptionTextIndex = def.desc === undefined ? 0 : 1;
  (def.conditionalDesc ?? []).forEach((description, index) => {
    const descriptionEntries: PdxEntry[] = [];
    const where = `desc[${index}]`;
    if (description.trigger !== undefined) {
      descriptionEntries.push(block("trigger", [...description.trigger.entries]));
      refs.push(...underField(description.trigger.refs, `${where}.trigger`));
    }
    if (description.exclusiveTrigger !== undefined) {
      descriptionEntries.push(
        block("exclusive_trigger", [...description.exclusiveTrigger.entries])
      );
      refs.push(...underField(description.exclusiveTrigger.refs, `${where}.exclusive_trigger`));
    }
    const texts = conditionalDescTexts(description.text);
    for (const text of texts) {
      const key = descriptionTextIndex === 0 ? `${id}.desc` : `${id}.desc.${descriptionTextIndex}`;
      descriptionTextIndex += 1;
      const ref = eventText(
        locSink,
        refs,
        text,
        key,
        `Event "${id}" ${where} text`,
        `${where}.text`
      );
      descriptionEntries.push(kv("text", ref.key));
    }
    if (description.showSound !== undefined) {
      descriptionEntries.push(kv("show_sound", refId(description.showSound)));
    }
    entries.push(block("desc", descriptionEntries));
  });
  if (def.diplomaticTitle !== undefined) {
    const ref = eventText(
      locSink,
      refs,
      def.diplomaticTitle,
      `${id}.diplomatic_title`,
      `Event "${id}" diplomaticTitle`,
      "diplomatic_title"
    );
    entries.push(kv("diplomatic_title", ref.key));
  }
  if (def.messageDesc !== undefined) {
    const ref = eventText(
      locSink,
      refs,
      def.messageDesc,
      `${id}.message_desc`,
      `Event "${id}" messageDesc`,
      "message_desc"
    );
    entries.push(kv("message_desc", ref.key));
  }
  if (def.picture !== undefined) {
    entries.push(kv("picture", refId(def.picture)));
  }
  if (def.showSound !== undefined) {
    entries.push(kv("show_sound", refId(def.showSound)));
  }
  if (def.eventPictureBackground !== undefined) {
    entries.push(kv("event_picture_background", refId(def.eventPictureBackground)));
  }
  if (def.notificationEventIcon !== undefined) {
    entries.push(kv("notification_event_icon", refId(def.notificationEventIcon)));
  }
  if (def.eventWindowType !== undefined) {
    entries.push(kv("event_window_type", def.eventWindowType));
  }
  if (def.eventMessageType !== undefined) {
    entries.push(kv("event_message_type", refId(def.eventMessageType)));
  }
  if (def.eventChain !== undefined) {
    entries.push(kv("event_chain", refId(def.eventChain)));
  }
  if (def.specimen !== undefined) {
    entries.push(kv("specimen", refId(def.specimen)));
  }
  if (def.situation !== undefined) {
    const situation = typeof def.situation === "function" ? def.situation(ctx) : def.situation;
    entries.push(kv("situation", situation.path));
  }
  if (def.location !== undefined) {
    const location = typeof def.location === "function" ? def.location(ctx) : def.location;
    entries.push(kv("location", location.path));
  }
  if (def.hideWindow === true) {
    entries.push(kv("hide_window", true));
  }
  if (def.diplomatic === true) {
    entries.push(kv("diplomatic", true));
  }
  if (def.forceOpen === true) {
    entries.push(kv("force_open", true));
  }
  if (def.major === true) {
    entries.push(kv("major", true));
  }
  if (def.trackable === true) {
    entries.push(kv("trackable", true));
  }
  if (def.isAdvisorEvent === true) {
    entries.push(kv("is_advisor_event", true));
  }
  if (def.autoSelect === true) {
    entries.push(kv("auto_select", true));
  }
  if (def.autoOpens === true) {
    entries.push(kv("auto_opens", true));
  }
  if (def.isTestEvent === true) {
    entries.push(kv("is_test_event", true));
  }
  if (def.isTriggeredOnly === true) {
    entries.push(kv("is_triggered_only", true));
  }
  if (def.fireOnlyOnce === true) {
    entries.push(kv("fire_only_once", true));
  }
  if (flags.archaeology === true) {
    entries.push(kv("archaeology", true));
  }
  if (flags.firstContact === true) {
    entries.push(kv("first_contact", true));
  }
  if (flags.espionageOperation === true) {
    entries.push(kv("espionage_operation", true));
  }
  if (flags.astralRift === true) {
    entries.push(kv("astral_rift", true));
  }
  if (flags.difficulty !== undefined) {
    entries.push(kv("difficulty", flags.difficulty));
  }
  if (def.trigger !== undefined) {
    entries.push(block("trigger", [...def.trigger.entries]));
    refs.push(...underField(def.trigger.refs, "trigger"));
  }
  if (def.majorTrigger !== undefined) {
    entries.push(block("major_trigger", [...def.majorTrigger.entries]));
    refs.push(...underField(def.majorTrigger.refs, "major_trigger"));
  }
  if (def.abortTrigger !== undefined) {
    entries.push(block("abort_trigger", [...def.abortTrigger.entries]));
    refs.push(...underField(def.abortTrigger.refs, "abort_trigger"));
  }
  if (def.abortEffect !== undefined) {
    const recorded: RecordedRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.abortEffect!(scope, ctx));
    entries.push(block("abort_effect", sink));
    refs.push(...underField(recorded, "abort_effect"));
  }
  if (def.meanTimeToHappen !== undefined) {
    const mtth = def.meanTimeToHappen;
    const mtthEntries: PdxEntry[] = [];
    if (mtth.years !== undefined) {
      mtthEntries.push(kv("years", mtth.years));
    }
    if (mtth.months !== undefined) {
      mtthEntries.push(kv("months", mtth.months));
    }
    if (mtth.days !== undefined) {
      mtthEntries.push(kv("days", mtth.days));
    }
    const mtthOwnerKey = registerModifierDescs(
      warnings,
      locSink,
      id,
      "mean_time_to_happen",
      mtth.modifiers
    );
    const mtthRefs: RecordedRefUse[] = [];
    mtthEntries.push(...modifierRows(mtth.modifiers, mtthRefs, mtthOwnerKey));
    entries.push(block("mean_time_to_happen", mtthEntries));
    refs.push(...underField(mtthRefs, "mean_time_to_happen"));
  }
  if (def.weightMultiplier !== undefined) {
    const weight = def.weightMultiplier;
    const weightEntries: PdxEntry[] = [kv("factor", weight.factor)];
    const weightOwnerKey = registerModifierDescs(
      warnings,
      locSink,
      id,
      "weight_multiplier",
      weight.modifiers
    );
    const weightRefs: RecordedRefUse[] = [];
    weightEntries.push(...modifierRows(weight.modifiers, weightRefs, weightOwnerKey));
    entries.push(block("weight_multiplier", weightEntries));
    refs.push(...underField(weightRefs, "weight_multiplier"));
  }
  if (def.immediate !== undefined) {
    const recorded: RecordedRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.immediate!(scope, ctx));
    entries.push(block("immediate", sink));
    refs.push(...underField(recorded, "immediate"));
  }
  if (def.after !== undefined) {
    const recorded: RecordedRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.after!(scope, ctx));
    entries.push(block("after", sink));
    refs.push(...underField(recorded, "after"));
  }
  (def.options ?? []).forEach((option, index) => {
    const where = `option[${index}]`;
    // An option has no id, so its child text — the icon caption, the response,
    // every AI-chance modifier desc — hangs off a stem the option derives.
    // A referenced name gives that stem no suffix of its own, and defining
    // children under the referenced key's namespace would write into whatever
    // mod owns it, so the stem hashes the key instead and stays event-owned.
    const { nameRef, suffix, unstable } = optionName(option.name, id, refs, where);
    if (unstable) {
      warnings.push({
        code: "unstable-option-key",
        message:
          `Event option "${id}[${index}]" has no key; its localization key uses a hash of the ` +
          "English option name and will change if that text is edited. Set name.key to pin a " +
          "stable key.",
      });
    }
    if (!isLocalizationRef(option.name)) {
      locSink.register(nameRef.key, resolveLocalizedText(option.name).translations);
    }
    const childStem = `${id}.${suffix}`;
    optionRefs.push(Object.freeze({ name: nameRef }));
    const optionEntries: PdxEntry[] = [kv("name", nameRef.key)];
    if (option.icon !== undefined) {
      const iconEntries: PdxEntry[] = [kv("icon", refId(option.icon.icon))];
      if (option.icon.iconBackground !== undefined) {
        iconEntries.push(kv("icon_background", refId(option.icon.iconBackground)));
      }
      if (option.icon.text !== undefined) {
        const iconRef = eventText(
          locSink,
          refs,
          option.icon.text,
          `${childStem}.icon`,
          `Event "${id}" ${where} icon text`,
          `${where}.icon.text`
        );
        iconEntries.push(kv("text", iconRef.key));
      }
      optionEntries.push(block("icon", iconEntries));
    }
    if (option.sound !== undefined) {
      optionEntries.push(kv("sound", option.sound));
    }
    if (option.trigger !== undefined) {
      optionEntries.push(block("trigger", [...option.trigger.entries]));
      refs.push(...underField(option.trigger.refs, `${where}.trigger`));
    }
    if (option.allow !== undefined) {
      optionEntries.push(block("allow", [...option.allow.entries]));
      refs.push(...underField(option.allow.refs, `${where}.allow`));
    }
    if (option.exclusiveTrigger !== undefined) {
      optionEntries.push(block("exclusive_trigger", [...option.exclusiveTrigger.entries]));
      refs.push(...underField(option.exclusiveTrigger.refs, `${where}.exclusive_trigger`));
    }
    if (option.aiChance !== undefined) {
      const aiChanceEntries: PdxEntry[] = [];
      if (option.aiChance.factor !== undefined) {
        aiChanceEntries.push(kv("factor", option.aiChance.factor));
      }
      const aiChanceOwnerKey = registerModifierDescs(
        warnings,
        locSink,
        id,
        `option_${suffix}.ai_chance`,
        option.aiChance.modifiers
      );
      const aiChanceRefs: RecordedRefUse[] = [];
      aiChanceEntries.push(
        ...modifierRows(option.aiChance.modifiers, aiChanceRefs, aiChanceOwnerKey)
      );
      optionEntries.push(block("ai_chance", aiChanceEntries));
      refs.push(...underField(aiChanceRefs, `${where}.ai_chance`));
    }
    if (option.responseText !== undefined) {
      const responseRef = eventText(
        locSink,
        refs,
        option.responseText,
        `${childStem}.response`,
        `Event "${id}" ${where} responseText`,
        `${where}.response_text`
      );
      optionEntries.push(kv("response_text", responseRef.key));
    }
    if (option.isDialogOnly === true) {
      optionEntries.push(kv("is_dialog_only", true));
    }
    if (option.hideIfNotAllowed === true) {
      optionEntries.push(kv("hide_option_if_not_allowed", true));
    }
    if (option.defaultHideOption === true) {
      optionEntries.push(kv("default_hide_option", true));
    }
    if (option.customGui !== undefined) {
      optionEntries.push(kv("custom_gui", option.customGui));
    }
    if (option.tag !== undefined) {
      optionEntries.push(kv("tag", option.tag));
    }
    if (option.effects !== undefined) {
      const recorded: RecordedRefUse[] = [];
      const sink = recordEffects<S>(recorded, (scope) => option.effects!(scope, ctx));
      optionEntries.push(...sink);
      refs.push(...underField(recorded, where));
    }
    entries.push(block("option", optionEntries));
  });

  // Every trigger and effect spliced above is resolved here, once, against the
  // event id: an event is a single identity with no nested owners, so one pass
  // over the finished body keys the same script the same way whichever slot of
  // this event it was spliced into.
  const scriptLocalization: KeyedLocalization[] = [];
  const resolved = resolveDeferredLocalization(entries, id, {
    into: scriptLocalization,
    warn: (warning) => warnings.push(warning),
  } satisfies ScriptLocalizationSink);
  for (const { key, translations } of scriptLocalization) {
    locSink.register(key, translations);
  }

  return {
    kind: "event-ref",
    scope,
    id,
    scopes: eventScopes(def.scopes),
    entry: block(kind, [...resolved]),
    loc: Object.freeze({ ...eventRefs, options: Object.freeze(optionRefs) }),
    refs,
    warnings,
  };
}

/**
 * The event's ambient scopes as a value of its own. Copied because the hook
 * contract `on()` checks reads this map long after the event was defined, and
 * the author still holds whatever they passed as `scopes`.
 */
function eventScopes<Context extends AmbientScopeContext>(scopes: Context | undefined): Context {
  return Object.freeze({ ...scopes }) as Context;
}
