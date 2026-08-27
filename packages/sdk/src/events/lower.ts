/** Lowers typed event definitions into PDXScript entries. */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import {
  localizationRef,
  resolveFixedKeyText,
  resolveLocalizedText,
  type LocalizationRef,
  type LocalizedText,
} from "../authoring/localization.ts";
import type { ModWarning } from "../diagnostics.ts";
import type { EventKindKey } from "../generated/events.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { localizationSuffix } from "../localization-key.ts";
import { underField, type RecordedRefUse } from "../references.ts";
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
  text: LocalizedText | readonly LocalizedText[] | undefined
): readonly LocalizedText[] {
  if (text === undefined) {
    return [];
  }
  return Array.isArray(text) ? (text as readonly LocalizedText[]) : [text as LocalizedText];
}

/**
 * Registers one text slot whose localization key the event's own id fixes.
 *
 * Every slot below is keyed off `<event id>.<slot>`, so a `key` pin on the
 * text would name a key nothing reads; `resolveFixedKeyText` says so rather
 * than dropping it. `position` names the slot in that refusal.
 */
function registerEventText(
  locSink: LocSink,
  key: string,
  text: LocalizedText,
  position: string
): void {
  locSink.register(key, resolveFixedKeyText(text, position, key));
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
    const key = `${id}.name`;
    registerEventText(locSink, key, def.title, `Event "${id}" title`);
    entries.push(kv("title", key));
    eventRefs.title = localizationRef(key);
  }
  if (def.desc !== undefined) {
    const key = `${id}.desc`;
    registerEventText(locSink, key, def.desc, `Event "${id}" desc`);
    entries.push(kv("desc", key));
    eventRefs.desc = localizationRef(key);
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
      registerEventText(locSink, key, text, `Event "${id}" ${where} text`);
      descriptionEntries.push(kv("text", key));
    }
    if (description.showSound !== undefined) {
      descriptionEntries.push(kv("show_sound", refId(description.showSound)));
    }
    entries.push(block("desc", descriptionEntries));
  });
  if (def.diplomaticTitle !== undefined) {
    const key = `${id}.diplomatic_title`;
    registerEventText(locSink, key, def.diplomaticTitle, `Event "${id}" diplomaticTitle`);
    entries.push(kv("diplomatic_title", key));
  }
  if (def.messageDesc !== undefined) {
    const key = `${id}.message_desc`;
    registerEventText(locSink, key, def.messageDesc, `Event "${id}" messageDesc`);
    entries.push(kv("message_desc", key));
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
    const name = resolveLocalizedText(option.name);
    const optionSuffix = localizationSuffix(name.translations.english, name.key);
    const optionKey = `${id}.${optionSuffix.suffix}`;
    if (optionSuffix.usedFallback) {
      warnings.push({
        code: "unstable-option-key",
        message:
          `Event option "${id}[${index}]" has no key; its localization key uses a hash of the ` +
          "English option name and will change if that text is edited. Set name.key to pin a " +
          "stable key.",
      });
    }
    locSink.register(optionKey, name.translations);
    optionRefs.push(Object.freeze({ name: localizationRef(optionKey) }));
    const optionEntries: PdxEntry[] = [kv("name", optionKey)];
    const where = `option[${index}]`;
    if (option.icon !== undefined) {
      const iconEntries: PdxEntry[] = [kv("icon", refId(option.icon.icon))];
      if (option.icon.iconBackground !== undefined) {
        iconEntries.push(kv("icon_background", refId(option.icon.iconBackground)));
      }
      if (option.icon.text !== undefined) {
        const textKey = `${optionKey}.icon`;
        registerEventText(locSink, textKey, option.icon.text, `Event "${id}" ${where} icon text`);
        iconEntries.push(kv("text", textKey));
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
        `option_${optionSuffix.suffix}.ai_chance`,
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
      const responseKey = `${optionKey}.response`;
      registerEventText(
        locSink,
        responseKey,
        option.responseText,
        `Event "${id}" ${where} responseText`
      );
      optionEntries.push(kv("response_text", responseKey));
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

  return {
    kind: "event-ref",
    scope,
    id,
    scopes: eventScopes(def.scopes),
    entry: block(kind, entries),
    loc: Object.freeze({ ...eventRefs, options: Object.freeze(optionRefs) }),
    refs,
    warnings,
  };
}

function eventScopes<Context extends AmbientScopeContext>(scopes: Context | undefined): Context {
  return (scopes ?? {}) as Context;
}
