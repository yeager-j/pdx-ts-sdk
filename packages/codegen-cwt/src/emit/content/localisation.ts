/**
 * The localisation subsystem of the content-type emitter: collapsing a
 * registry's declared localisation entries onto one member per TS field name,
 * and rendering the interface members and runtime metadata that plan yields.
 * Shared by the top-level emission and the repeated-struct emission, which
 * lower their localisation tables through the same plan.
 */

import type { ContentType } from "../../cwt/rules.ts";
import { Emitter } from "../../emit/typescript.ts";
import { camelCase, docComment } from "../../naming.ts";
import { REQUIRED_LOCALISATION, SYNTHETIC_LOCALISATION } from "../../overlay/index.ts";
import { member as renderMember } from "../../render/writer.ts";
import type { FieldOmissionRow } from "./field-rows.ts";

/** One canonical localisation slot and its resolved authoring requiredness. */
export interface LocalisationPlanEntry {
  /** The vendored localisation slot name. */
  readonly key: string;
  /** The localisation key pattern. */
  readonly pattern: string;
  /** Whether CWT marks the slot optional. */
  readonly optional: boolean;
  /** The enclosing CWT subtype, or `null` for a type-level slot. */
  readonly subtype: string | null;
  /** Whether the authoring surface requires this slot. */
  readonly authoringRequired: boolean;
}

/** Canonical localisation slots and their resolved authoring decisions. */
export interface LocalisationPlan {
  /** One surviving localisation declaration per generated authoring member. */
  readonly entries: readonly LocalisationPlanEntry[];
  /** Duplicate or non-static declarations omitted from the generated surface. */
  readonly aliases: readonly FieldOmissionRow[];
}

/**
 * The identity-localisation convention for a repeated-struct field with no
 * vendored `type[...]` of its own: the record key doubles as a required
 * localisation key (`$`), with an optional `<key>_desc` (`$_desc`). Shaped as
 * a `ContentType` so it flows through `planLocalisation`/`localisationMembers`
 * unchanged rather than needing a second code path.
 */
export function syntheticIdentityLocalisation(typeName: string): ContentType {
  return {
    name: typeName,
    path: null,
    nameField: null,
    keyFilter: null,
    subtypes: [],
    localisation: [
      { key: "name", pattern: "$", required: true, optional: false, subtype: null },
      { key: "desc", pattern: "$_desc", required: false, optional: true, subtype: null },
    ],
  };
}

/**
 * The sibling boolean member that waives a localisation slot, for a slot the
 * rules require only of the definitions one subtype covers.
 *
 * `swapped_tradition`'s `name = "$"` is declared inside
 * `subtype[not_inheriting_name]`, whose own body — `## cardinality = 0..0
 * inherit_name = yes` — says the subtype covers every swap that does *not*
 * write `inherit_name`. So the slot is required unless `inheritName` is set,
 * which is neither CWT's unconditional `## required` nor the plain optional a
 * flattened reading of the same table produces. `readLocalisation` keeps the
 * provenance and `absentUnless` states the discriminator; this joins them.
 *
 * A slot the rules explicitly mark `## optional` states its own requiredness
 * and is left alone — `flavor` and `effects` sit in the same subtype blocks.
 *
 * The shipped data agrees with the reading: of 195 vanilla `tradition_swap`
 * blocks, 131 write no `inherit_name` and all 131 carry a `name`; 6 of 9
 * ascension-perk swaps likewise. Nothing shipped omits the slot while
 * requiring it — the failure this closes is the SDK writing a raw key to the
 * game with no warning when an author does.
 */
function conditionalRequirement(type: ContentType, entry: LocalisationPlanEntry): string | null {
  if (entry.subtype === null || entry.optional) {
    return null;
  }
  const subtype = type.subtypes.find((candidate) => candidate.name === entry.subtype);
  if (subtype?.absentUnless == null) {
    return null;
  }
  return camelCase(subtype.absentUnless);
}

/**
 * Plans one authoring slot per static, id-keyed localisation member. The first declaration wins
 * when patterns or generated member names collide; later declarations are reported as aliases.
 *
 * Entries without a `$` placeholder describe data paths rather than static localisation slots and
 * are reported as collapsed. Synthetic slots fill only names no declared slot already claims.
 */
export function planLocalisation(emitter: Emitter, type: ContentType): LocalisationPlan {
  const byPattern = new Map<string, ContentType["localisation"][number]>();
  const byMember = new Map<string, ContentType["localisation"][number]>();
  const aliases: FieldOmissionRow[] = [];
  const collapse = (
    dropped: ContentType["localisation"][number],
    canonical: ContentType["localisation"][number]
  ): void => {
    aliases.push({
      path: `${type.name}.localisation.${dropped.key}`,
      kind: "collapsed",
      reason: `(${dropped.pattern}) duplicates ${canonical.key} at ${canonical.pattern}`,
    });
  };

  for (const entry of type.localisation) {
    if (!entry.pattern.includes("$")) {
      aliases.push({
        path: `${type.name}.localisation.${entry.key}`,
        kind: "collapsed",
        reason: `(${entry.pattern}) has no \`$\` id placeholder — not a static <id>-keyed slot, excluded`,
      });
      continue;
    }
    const member = camelCase(entry.key);
    const patternMatch = byPattern.get(entry.pattern);
    if (patternMatch !== undefined) {
      collapse(entry, patternMatch);
      continue;
    }
    const memberMatch = byMember.get(member);
    if (memberMatch !== undefined) {
      collapse(entry, memberMatch);
      continue;
    }
    byPattern.set(entry.pattern, entry);
    byMember.set(member, entry);
  }
  for (const [path, synthetic] of SYNTHETIC_LOCALISATION) {
    const [typeName, member] = path.split(".");
    if (typeName !== type.name || byMember.has(member!)) {
      continue;
    }
    emitter.overlayAudit.applied("SYNTHETIC_LOCALISATION", path);
    byMember.set(member!, {
      key: member!,
      pattern: synthetic.pattern,
      required: false,
      optional: true,
      subtype: null,
    });
  }
  const entries = [...byMember.values()].map((entry) => {
    const member = camelCase(entry.key);
    const requiredKey = `${type.name}.${member}`;
    const overlayRequired = REQUIRED_LOCALISATION.has(requiredKey);
    if (overlayRequired) {
      emitter.overlayAudit.applied("REQUIRED_LOCALISATION", requiredKey);
    }
    return {
      key: entry.key,
      pattern: entry.pattern,
      optional: entry.optional,
      subtype: entry.subtype,
      authoringRequired: entry.required || overlayRequired,
    };
  });
  return { entries, aliases };
}

/** Renders a content type's localisation slots as generated interface members. */
export function localisationMembers(
  emitter: Emitter,
  type: ContentType,
  plan = planLocalisation(emitter, type)
): string {
  return plan.entries
    .map((entry) => {
      const field = camelCase(entry.key);
      const pattern = entry.pattern.replace("$", "<id>");
      return renderMember({
        name: field,
        type: emitter.use("LocalizedText"),
        optional: !entry.authoringRequired,
        docs: [
          `Display text emitted to localization under \`${pattern}\`.`,
          "A bare string is the English shorthand.",
        ],
      });
    })
    .join("");
}

/**
 * Renders a content type's localisation slots as the `XLoc` type its items
 * carry — one reference per slot, from the same plan the authoring members
 * come from, so a slot an author can write and a slot they can reference are
 * always the same set.
 *
 * A type alias rather than an interface: `contentLocalizationRefs` narrows a
 * record of references, and only an alias carries the implicit index signature
 * that constraint reads.
 */
export function localisationRefType(
  emitter: Emitter,
  type: ContentType,
  typeName: string,
  plan: LocalisationPlan
): string {
  const members = plan.entries
    .map((entry) =>
      renderMember({
        name: camelCase(entry.key),
        type: emitter.use("LocalizationRef"),
        readonly: true,
        optional: false,
        docs: [`The \`${entry.pattern.replace("$", "<id>")}\` key.`],
      })
    )
    .join("");
  return (
    docComment([
      `The localization keys one \`${type.name}\` mints, as references.`,
      "Every slot is present whether or not the definition supplied its text:",
      "the key follows from the id alone.",
    ]) + `export type ${typeName}Loc = {\n${members}};\n\n`
  );
}

/**
 * `pointers` maps a localisation member to the body member the game actually
 * reads its text through, for the synthetic slots that have one. Passed in
 * rather than looked up, because it is a *result* of projection the body: the
 * pointer is the renamed body field, and the rename is only known once the
 * field loop has run. See `renamedOffLocalisation` (`content-type.ts`).
 */
export function localisationMetadata(
  emitter: Emitter,
  type: ContentType,
  plan = planLocalisation(emitter, type),
  pointers: ReadonlyMap<string, string> = new Map()
): string {
  return (
    "[\n" +
    plan.entries
      .map((entry) => {
        const member = camelCase(entry.key);
        const conditional = conditionalRequirement(type, entry);
        const requiredUnless =
          conditional === null ? "" : `, requiredUnless: ${JSON.stringify(conditional)}`;
        const pointer = pointers.get(member);
        const pointerMember =
          pointer === undefined ? "" : `, pointerMember: ${JSON.stringify(pointer)}`;
        return (
          `  { member: ${JSON.stringify(member)}, pattern: ${JSON.stringify(entry.pattern)}, ` +
          `required: ${entry.authoringRequired}${requiredUnless}${pointerMember} },\n`
        );
      })
      .join("") +
    "]"
  );
}
