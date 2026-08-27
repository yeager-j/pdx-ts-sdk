/**
 * Localization key families: text a *referenced* definition needs because of
 * the role a field puts it in, rather than because of what that definition is.
 *
 * A resource named as a crisis path's `crisis_currency` is the one case today.
 * The Ambition UI builds its text keys from the resource id at runtime, so a
 * resource that is complete on its own shows raw keys across that UI as soon
 * as a path points at it. CWT cannot state the requirement — a `localisation`
 * block describes the definition it sits on and has no conditionality on an
 * inbound reference — so the family is recorded here, and the definition walk
 * in `authoring.ts` registers and checks it.
 *
 * ## How the table below was measured
 *
 * Read from Stellaris 4.4.6's `localisation/english`, comparing vanilla's two
 * crisis currencies: a suffix both `menace_*` and `integrity_*` define is a
 * required member, one only `menace_*` defines is optional.
 *
 * `_desc`, `_produced_from`, `_upkeep_for`, and the two
 * `_*_per_pop_group_unit` suffixes are deliberately absent. Every resource
 * defines those — `energy`, `minerals`, `alloys`, `food`, `unity` and
 * `influence` all carry them — so they describe a resource, not this role.
 * The 16 required suffixes and `_crisis_description_intro` appear for no
 * resource other than `menace` and `integrity`.
 *
 * ## Which `$…$` tokens count as placeholders
 *
 * Only the uppercase tokens the game substitutes at runtime. Lowercase
 * `$…$` is a reference to another localization key, and vanilla's are
 * per-resource rather than fixed by the family: `menace_name` is
 * `"$menace$:"` and `integrity_name` is `"$integrity$:"`, so no fixed token
 * exists for that member at all.
 *
 * Extra tokens are allowed. Vanilla writes them itself — `menace_crisis_description`
 * opens with `$menace_crisis_description_intro$` — so refusing a token this
 * table does not name would refuse text shaped exactly like the game's own.
 */

import {
  resolveFixedKeyText,
  type KeyedLocalization,
  type LocalizationTranslations,
  type LocalizedText,
} from "../authoring/localization.ts";
import type { ResourceRef } from "../generated/refs.ts";
import { refId, type TypedRef } from "../script/scalar.ts";

/** One key in a localization family, and the text the game expects under it. */
export interface LocalizationFamilyMember {
  /** Authoring member carrying this key's text. */
  readonly member: string;
  /** Appended to the referenced definition's id to form the emitted key. */
  readonly suffix: string;
  /** Whether the game reads this key on a path every author ships. */
  readonly required: boolean;
  /**
   * Runtime tokens the text must carry, without their `$` delimiters or
   * format suffix: `VAL` covers `$VAL|0$` at any precision. Every supplied
   * language is checked, since a token missing from one translation is the
   * same unfindable bug as one missing from English.
   */
  readonly placeholders: readonly string[];
}

/** A family of localization keys derived from one referenced definition's id. */
export interface LocalizationKeyFamily {
  /** Family name, as the generated field metadata spells it. */
  readonly name: string;
  /** Content registry the referenced id belongs to, checked at fold time. */
  readonly registry: string;
  /** What reads this family, named when the fold refuses a missing one. */
  readonly reader: string;
  readonly members: readonly LocalizationFamilyMember[];
}

/**
 * One field's use of a localization role, recorded for the fold.
 *
 * The type-level gate refuses the obvious spellings of an owned resource, but
 * a handle, a widened item, or a raw string can still name one; only the fold
 * knows every id this build defines, so the guarantee is settled there.
 */
export interface LocalizationRoleUse {
  /** Definition naming the referenced id, e.g. `crisis_path "x_path"`. */
  readonly owner: string;
  /** Serialized field the reference was written in. */
  readonly field: string;
  /** Registry the referenced id must belong to. */
  readonly registry: string;
  /** The referenced id the family keys from. */
  readonly id: string;
  /** Whether the author supplied the family text beside the reference. */
  readonly bundled: boolean;
  /** {@link LocalizationKeyFamily.reader}, carried so the fold needs no lookup. */
  readonly reader: string;
}

/**
 * The text the Ambition UI reads for a resource used as a crisis currency.
 *
 * Vanilla evidence sits beside each member that carries placeholders; see the
 * module comment for how requiredness and the token rules were measured.
 */
const CRISIS_CURRENCY_MEMBERS = [
  { member: "name", suffix: "_name", required: true, placeholders: [] },
  // menace_value: "£menace£ $VAL|0$"   integrity_value: "£integrity£ $VAL|0$"
  { member: "value", suffix: "_value", required: true, placeholders: ["VAL"] },
  // menace_current_value: "Current Value: §Y$VALUE|0$§!"   integrity_current_value: same
  { member: "currentValue", suffix: "_current_value", required: true, placeholders: ["VALUE"] },
  { member: "gaining", suffix: "_gaining", required: true, placeholders: [] },
  { member: "crisisObjective", suffix: "_crisis_objective", required: true, placeholders: [] },
  {
    member: "crisisObjectiveGained",
    suffix: "_crisis_objective_gained",
    required: true,
    placeholders: [],
  },
  // menace_crisis_objective_progress: "We have gained £menace£ $AMOUNT$ from this Crisis Objective."
  {
    member: "crisisObjectiveProgress",
    suffix: "_crisis_objective_progress",
    required: true,
    placeholders: ["AMOUNT"],
  },
  // menace_crisis_objective_reward: "$REWARD$"   integrity_crisis_objective_reward: "$REWARD$"
  {
    member: "crisisObjectiveReward",
    suffix: "_crisis_objective_reward",
    required: true,
    placeholders: ["REWARD"],
  },
  {
    member: "crisisLevelLocked",
    suffix: "_crisis_level_locked",
    required: true,
    placeholders: [],
  },
  // menace_crisis_level_unlocked: "At $LEVEL$, you get a Special Project and the rewards:\n"
  {
    member: "crisisLevelUnlocked",
    suffix: "_crisis_level_unlocked",
    required: true,
    placeholders: ["LEVEL"],
  },
  // menace_crisis_level_unlock: "Has £menace£ §Y$CURRENCY$§! Menace"
  {
    member: "crisisLevelUnlock",
    suffix: "_crisis_level_unlock",
    required: true,
    placeholders: ["CURRENCY"],
  },
  { member: "crisisLevelDesc", suffix: "_crisis_level_desc", required: true, placeholders: [] },
  {
    member: "crisisDescriptionTitle",
    suffix: "_crisis_description_title",
    required: true,
    placeholders: [],
  },
  // Only menace defines this one; integrity inlines the same prose instead.
  {
    member: "crisisDescriptionIntro",
    suffix: "_crisis_description_intro",
    required: false,
    placeholders: [],
  },
  { member: "crisisDescription", suffix: "_crisis_description", required: true, placeholders: [] },
  { member: "crisisHowtoTitle", suffix: "_crisis_howto_title", required: true, placeholders: [] },
  { member: "crisisHowto", suffix: "_crisis_howto", required: true, placeholders: [] },
] as const satisfies readonly LocalizationFamilyMember[];

type CrisisCurrencyMember = (typeof CRISIS_CURRENCY_MEMBERS)[number];

type RequiredMemberName = Extract<CrisisCurrencyMember, { readonly required: true }>["member"];
type OptionalMemberName = Extract<CrisisCurrencyMember, { readonly required: false }>["member"];

/**
 * {@link CrisisCurrencyLocalization} as the measured table alone describes it.
 *
 * Deliberately not re-exported from the package entry points: it exists so a
 * test can pin the documented interface to the table in both directions, which
 * is what lets the table stay the runtime authority while the interface carries
 * the prose an author reads.
 */
export type CrisisCurrencyFamilyShape = Readonly<Record<RequiredMemberName, LocalizedText>> &
  Readonly<Partial<Record<OptionalMemberName, LocalizedText>>>;

/**
 * The Ambition UI's text for one crisis currency, one member per key the game
 * derives from the resource id.
 *
 * Every member is required except {@link CrisisCurrencyLocalization.crisisDescriptionIntro},
 * so a family the UI would show raw keys for cannot be authored. Members whose
 * text carries a runtime value name it below; that token must survive into
 * every translation supplied for the member.
 */
export interface CrisisCurrencyLocalization {
  /** The currency's label where a value is shown beside it, as in `"Resolve:"`. */
  readonly name: LocalizedText;
  /** One currency amount with its icon. Must carry `$VAL|0$`. */
  readonly value: LocalizedText;
  /** The stockpile readout in the crisis panel. Must carry `$VALUE|0$`. */
  readonly currentValue: LocalizedText;
  /** How the player earns the currency, shown in its tooltip. */
  readonly gaining: LocalizedText;
  /** Heading over the objective list, as in `"Archive Objectives"`. */
  readonly crisisObjective: LocalizedText;
  /** Label on the amount an objective awarded, as in `"Resolve gained"`. */
  readonly crisisObjectiveGained: LocalizedText;
  /** Confirmation that an objective paid out. Must carry `$AMOUNT$`. */
  readonly crisisObjectiveProgress: LocalizedText;
  /** Wrapper around one objective's reward line. Must carry `$REWARD$`. */
  readonly crisisObjectiveReward: LocalizedText;
  /** Heading over an unreached level's requirements. */
  readonly crisisLevelLocked: LocalizedText;
  /** Heading over a reached level's rewards. Must carry `$LEVEL$`. */
  readonly crisisLevelUnlocked: LocalizedText;
  /** One level's currency requirement. Must carry `$CURRENCY$`. */
  readonly crisisLevelUnlock: LocalizedText;
  /** How the player advances between levels. */
  readonly crisisLevelDesc: LocalizedText;
  /** The path's title in the crisis panel, as in `"Galactic Nemesis"`. */
  readonly crisisDescriptionTitle: LocalizedText;
  /** The path's flavour body under that title. */
  readonly crisisDescription: LocalizedText;
  /** The path's mechanical heading, as in `"Menace & Engine"`. */
  readonly crisisHowtoTitle: LocalizedText;
  /** The path's mechanical body under that heading. */
  readonly crisisHowto: LocalizedText;
  /**
   * Optional opening paragraph. Vanilla's `menace` composes it into
   * {@link CrisisCurrencyLocalization.crisisDescription} with
   * `$<currency-id>_crisis_description_intro$`; `integrity` defines no such
   * key and inlines the prose instead.
   */
  readonly crisisDescriptionIntro?: LocalizedText;
}

/**
 * A resource whose crisis-currency text already exists — vanilla's own, or
 * another mod's.
 *
 * The two absent properties are what exclude a resource this build defines:
 * a `DefinedContent` carries `def` and a `ContentHandleBase` carries
 * `handleKind`, and both of those need the bundle. Neither is the whole
 * guarantee — an owned resource widened to `ResourceRef`, or named as a raw
 * string, wears neither — which is why the fold checks the referenced id
 * against every id this build defines.
 */
type ForeignResourceRef = ResourceRef & {
  readonly def?: never;
  readonly handleKind?: never;
};

/**
 * A crisis path's currency: the resource, plus the Ambition UI text keyed from
 * its id where this build owns that text.
 *
 * A resource defined by this mod must come as the bundle — vanilla ships no
 * keys for it, and a partial family shows raw keys through the Ambition UI. A
 * vanilla reference stands alone, and takes the bundle only to restate that
 * text. A plain string is unchecked, for a resource from another mod.
 *
 * @example
 * ```ts
 * mod.crisisPath("archive", {
 *   crisisCurrency: {
 *     resource: resolve,
 *     localization: { name: "Resolve:", value: "£resolve£ $VAL|0$", ... },
 *   },
 *   levels: [firstLevel],
 *   objectives: [archiveRecovered],
 * });
 * ```
 */
export type CrisisCurrencyRole =
  | ForeignResourceRef
  | string
  | {
      /** Resource the path spends and shows; its id keys every member below. */
      readonly resource: ResourceRef | string;
      readonly localization: CrisisCurrencyLocalization;
    };

/** Every family a generated field's `localizationFamily` may name. */
export const LOCALIZATION_KEY_FAMILIES: ReadonlyMap<string, LocalizationKeyFamily> = new Map([
  [
    "crisis_currency",
    {
      name: "crisis_currency",
      registry: "resource",
      reader: "The Ambition UI",
      members: CRISIS_CURRENCY_MEMBERS,
    },
  ],
]);

/** An authored role bundle, before its members have been checked. */
interface RoleBundle {
  readonly resource: unknown;
  readonly localization?: unknown;
}

/**
 * Whether an authored value is a role bundle rather than a bare reference.
 *
 * `resource` alone settles it: no reference carries that property, and a
 * bundle missing its `localization` has to reach the member checks below
 * rather than being lowered as though it were a reference.
 */
function isRoleBundle(value: unknown): value is RoleBundle {
  return typeof value === "object" && value !== null && "resource" in value;
}

/**
 * Whether a referenced value is a definition this build makes, by the two
 * shapes authoring hands out: a placed `ContentItem` and a minted handle.
 *
 * Shape rather than id, because this decides the layer during the definition
 * walk, before the fold has the id census. A raw string naming an owned id
 * reads as foreign here and is refused outright at fold time, so the two
 * checks never disagree about a mod that builds.
 */
function isOwnDefinition(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { readonly itemKind?: unknown; readonly handleKind?: unknown };
  return candidate.itemKind === "content" || candidate.handleKind === "content-handle";
}

const PLACEHOLDER_PATTERN = /\$([^$|]+)(?:\|[^$]*)?\$/g;

/** The runtime token names a localized string carries, format suffixes dropped. */
function placeholderTokens(text: string): Set<string> {
  return new Set([...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!));
}

function assertPlaceholders(
  member: LocalizationFamilyMember,
  translations: LocalizationTranslations,
  position: string
): void {
  if (member.placeholders.length === 0) {
    return;
  }
  for (const [language, text] of Object.entries(translations)) {
    const present = placeholderTokens(text);
    const missing = member.placeholders.filter((token) => !present.has(token));
    if (missing.length > 0) {
      throw new Error(
        `${position} "${member.member}" is missing ${missing.map((token) => `"$${token}$"`).join(", ")} ` +
          `in ${language}. The game substitutes ` +
          `${member.placeholders.map((token) => `"$${token}$"`).join(", ")} into this text, and ` +
          "shows nothing in their place when they are absent."
      );
    }
  }
}

/** Where in a definition one localization role was authored. */
export interface LocalizationRoleSite {
  /** Registry of the definition naming the reference. */
  readonly ownerType: string;
  /** Id of the definition naming the reference. */
  readonly ownerId: string;
  /** Serialized field path the reference was written in. */
  readonly fieldPath: string;
}

/**
 * Resolves an authored role value to the reference the definition body emits,
 * registering the referenced id's key family when the author supplied one.
 *
 * The bundle collapses to its `resource` on the way out, so the field lowers
 * and collects references exactly as a bare reference does.
 *
 * Text for a resource this build does not define is registered on the
 * `replace` layer, because those keys already exist — vanilla's `menace_*`,
 * another mod's — and `localisation/replace/` is the only thing that decides a
 * localisation winner. Nothing is lost when the key exists nowhere else: the
 * replace directory is an ordinary localisation source the game reads with
 * priority, not an override that needs something to override.
 *
 * @param familyName - Family named by the field's generated `localizationFamily`.
 * @param into - Collects one entry per supplied member, keyed by the referenced id.
 * @param roleUses - Collects the use itself, for the fold's completeness check.
 */
export function resolveLocalizationRole(
  value: unknown,
  familyName: string,
  site: LocalizationRoleSite,
  into: KeyedLocalization[],
  roleUses: LocalizationRoleUse[]
): unknown {
  const position = `${site.ownerType}.${site.fieldPath} for "${site.ownerId}"`;
  const family = LOCALIZATION_KEY_FAMILIES.get(familyName);
  if (family === undefined) {
    throw new Error(`${position} names localization family "${familyName}", which does not exist`);
  }
  const bundled = isRoleBundle(value);
  const reference = bundled ? value.resource : value;
  const id = refId(reference as TypedRef<string> | string);
  if (typeof id === "string" && id !== "") {
    roleUses.push({
      owner: `${site.ownerType} "${site.ownerId}"`,
      field: site.fieldPath,
      registry: family.registry,
      id,
      bundled,
      reader: family.reader,
    });
  }
  if (!bundled) {
    return value;
  }
  const localization = value.localization;
  if (typeof localization !== "object" || localization === null) {
    throw new Error(`${position} supplies a resource without its "localization" text`);
  }
  if (typeof id !== "string" || id === "") {
    throw new Error(`${position} supplies a bundle whose "resource" names nothing`);
  }
  const layer = isOwnDefinition(reference) ? "ordinary" : "replace";
  const supplied = localization as Readonly<Record<string, LocalizedText | undefined>>;
  for (const member of family.members) {
    const text = supplied[member.member];
    if (text === undefined) {
      if (member.required) {
        throw new Error(
          `${position} is missing required localization "${member.member}". The game reads ` +
            `"${id}${member.suffix}" from the resource id, and shows the raw key when it is absent.`
        );
      }
      continue;
    }
    const key = `${id}${member.suffix}`;
    const translations = resolveFixedKeyText(text, `${position} "${member.member}"`, key);
    assertPlaceholders(member, translations, position);
    into.push({ key, translations, layer });
  }
  return reference;
}
