/** Lowers typed event definitions into PDXScript entries. */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ModWarning } from "../diagnostics.ts";
import type { EventKindKey } from "../generated/events.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { localizationSuffix } from "../localization-key.ts";
import { underField, type ContentRefUse } from "../references.ts";
import {
  modifierDescKey,
  modifierEntry,
  registerModifierDescKey,
} from "../script/effects/modifiers.ts";
import { recordEffects, withScriptCtx } from "../script/effects/recorder.ts";
import type { Modifier, ModifierWithLoc, ScriptCtx } from "../script/effects/types.ts";
import { refId } from "../script/scalar.ts";
import type { DefinedEvent, EventDef, LocSink } from "./types.ts";

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
  refs: ContentRefUse[],
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
  loc: LocSink,
  ownerId: string,
  fieldPath: string,
  modifiers: readonly Modifier<S>[] | undefined
): string {
  const ownerKey = `${ownerId}::${fieldPath}`;
  (modifiers ?? []).forEach((modifier) => {
    if (modifier.desc === undefined) {
      return;
    }
    const { key, unstableWarning } = modifierDescKey(
      ownerId,
      fieldPath,
      modifier as ModifierWithLoc<ScopeName>
    );
    loc.register(key, modifier.desc);
    registerModifierDescKey(modifier as Modifier<ScopeName>, ownerKey, key);
    if (unstableWarning !== undefined) {
      warnings.push({ code: "unstable-desc-key", message: unstableWarning });
    }
  });
  return ownerKey;
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

export function buildEvent<S extends ScopeName, From extends ScopeName | undefined>(
  kind: EventKindKey,
  scope: S,
  namespace: string,
  def: EventDef<S, From>,
  loc: LocSink
): DefinedEvent<S, From> {
  assertEventNumber(def.id);
  // One ctx for the whole event: its `immediate`, `after`, `abort_effect` and
  // every option record separately, and all of them are this one lowering.
  return withScriptCtx<S, From, S, DefinedEvent<S, From>>({}, (ctx) =>
    lowerEvent(kind, scope, namespace, def, loc, ctx)
  );
}

function lowerEvent<S extends ScopeName, From extends ScopeName | undefined>(
  kind: EventKindKey,
  scope: S,
  namespace: string,
  def: EventDef<S, From>,
  loc: LocSink,
  ctx: ScriptCtx<S, From>
): DefinedEvent<S, From> {
  const id = `${namespace}.${def.id}`;
  const flags = windowFlags(def);
  const warnings: ModWarning[] = [];
  const refs: ContentRefUse[] = [];

  const entries: PdxEntry[] = [kv("id", id)];
  if (def.title !== undefined) {
    loc.register(`${id}.name`, def.title);
    entries.push(kv("title", `${id}.name`));
  }
  if (def.desc !== undefined) {
    loc.register(`${id}.desc`, def.desc);
    entries.push(kv("desc", `${id}.desc`));
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
    const texts =
      typeof description.text === "string" ? [description.text] : (description.text ?? []);
    for (const text of texts) {
      const key = descriptionTextIndex === 0 ? `${id}.desc` : `${id}.desc.${descriptionTextIndex}`;
      descriptionTextIndex += 1;
      loc.register(key, text);
      descriptionEntries.push(kv("text", key));
    }
    if (description.showSound !== undefined) {
      descriptionEntries.push(kv("show_sound", refId(description.showSound)));
    }
    entries.push(block("desc", descriptionEntries));
  });
  if (def.diplomaticTitle !== undefined) {
    loc.register(`${id}.diplomatic_title`, def.diplomaticTitle);
    entries.push(kv("diplomatic_title", `${id}.diplomatic_title`));
  }
  if (def.messageDesc !== undefined) {
    loc.register(`${id}.message_desc`, def.messageDesc);
    entries.push(kv("message_desc", `${id}.message_desc`));
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
    const recorded: ContentRefUse[] = [];
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
      loc,
      id,
      "mean_time_to_happen",
      mtth.modifiers
    );
    const mtthRefs: ContentRefUse[] = [];
    mtthEntries.push(...modifierRows(mtth.modifiers, mtthRefs, mtthOwnerKey));
    entries.push(block("mean_time_to_happen", mtthEntries));
    refs.push(...underField(mtthRefs, "mean_time_to_happen"));
  }
  if (def.weightMultiplier !== undefined) {
    const weight = def.weightMultiplier;
    const weightEntries: PdxEntry[] = [kv("factor", weight.factor)];
    const weightOwnerKey = registerModifierDescs(
      warnings,
      loc,
      id,
      "weight_multiplier",
      weight.modifiers
    );
    const weightRefs: ContentRefUse[] = [];
    weightEntries.push(...modifierRows(weight.modifiers, weightRefs, weightOwnerKey));
    entries.push(block("weight_multiplier", weightEntries));
    refs.push(...underField(weightRefs, "weight_multiplier"));
  }
  if (def.immediate !== undefined) {
    const recorded: ContentRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.immediate!(scope, ctx));
    entries.push(block("immediate", sink));
    refs.push(...underField(recorded, "immediate"));
  }
  if (def.after !== undefined) {
    const recorded: ContentRefUse[] = [];
    const sink = recordEffects<S>(recorded, (scope) => def.after!(scope, ctx));
    entries.push(block("after", sink));
    refs.push(...underField(recorded, "after"));
  }
  (def.options ?? []).forEach((option, index) => {
    const optionSuffix = localizationSuffix(option.name, option.key);
    const optionKey = `${id}.${optionSuffix.suffix}`;
    if (optionSuffix.usedFallback) {
      warnings.push({
        code: "unstable-option-key",
        message:
          `Event option "${id}[${index}]" has no key; its localization key uses a hash of the ` +
          "option name and will change if that text is edited. Set key to pin a stable key.",
      });
    }
    loc.register(optionKey, option.name);
    const optionEntries: PdxEntry[] = [kv("name", optionKey)];
    const where = `option[${index}]`;
    if (option.icon !== undefined) {
      const iconEntries: PdxEntry[] = [kv("icon", refId(option.icon.icon))];
      if (option.icon.iconBackground !== undefined) {
        iconEntries.push(kv("icon_background", refId(option.icon.iconBackground)));
      }
      if (option.icon.text !== undefined) {
        const textKey = `${optionKey}.icon`;
        loc.register(textKey, option.icon.text);
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
        loc,
        id,
        `option_${optionSuffix.suffix}.ai_chance`,
        option.aiChance.modifiers
      );
      const aiChanceRefs: ContentRefUse[] = [];
      aiChanceEntries.push(
        ...modifierRows(option.aiChance.modifiers, aiChanceRefs, aiChanceOwnerKey)
      );
      optionEntries.push(block("ai_chance", aiChanceEntries));
      refs.push(...underField(aiChanceRefs, `${where}.ai_chance`));
    }
    if (option.responseText !== undefined) {
      const responseKey = `${optionKey}.response`;
      loc.register(responseKey, option.responseText);
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
      const recorded: ContentRefUse[] = [];
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
    from: def.from as From,
    entry: block(kind, entries),
    refs,
    warnings,
  };
}
