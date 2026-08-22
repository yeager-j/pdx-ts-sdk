/**
 * The localisation subsystem of the content-type emitter: collapsing a
 * registry's declared localisation entries onto one member per TS field name,
 * and rendering the interface members and runtime metadata that plan yields.
 * Shared by the top-level emission and the repeated-struct emission, which
 * lower their localisation tables through the same plan.
 */

import type { ContentType } from "../../cwt/rules.ts";
import { camelCase } from "../../naming.ts";
import { REQUIRED_LOCALISATION, SYNTHETIC_LOCALISATION } from "../../overlay/index.ts";
import { Emitter } from "../../render/emitter.ts";
import type { FieldOmissionRow } from "../../render/field-rows.ts";
import { member as renderMember } from "../../render/writer.ts";

export interface LocalisationPlan {
  readonly entries: ContentType["localisation"];
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
function conditionalRequirement(
  type: ContentType,
  entry: ContentType["localisation"][number]
): string | null {
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
 * Collapses declared localisation entries onto one member per TS field name.
 *
 * A pattern with no `$` id placeholder is not a static `<id>`-keyed slot at
 * all — CWT also uses this position for data-path pointers like `job`'s
 * `condition_string = swappable_data/default/condition_string`, meaning "read
 * this nested field's value instead of a localisation key". The SDK's writer
 * only knows how to substitute an id into `$`, so those entries are excluded
 * outright rather than emitted as a member no definition could satisfy
 * correctly.
 *
 * Two distinct collisions occur among what remains: the same *pattern*
 * declared under two keys (`council_agenda_name` and `name` both writing
 * `council_agenda_$_name`), and the same *member* name declared with two
 * patterns. Emitting one interface member per surviving entry means either
 * collision left standing would be a duplicate TypeScript property, so the
 * first-declared entry wins and the rest collapse to aliases.
 *
 * {@link SYNTHETIC_LOCALISATION} adds slots the rules never declare at all,
 * after the rules-derived collapse — a synthetic row never displaces a real
 * declared slot, it only fills a gap one leaves.
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
  return { entries: [...byMember.values()], aliases };
}

export function localisationMembers(
  emitter: Emitter,
  type: ContentType,
  plan = planLocalisation(emitter, type)
): string {
  return plan.entries
    .map((entry) => {
      const field = camelCase(entry.key);
      const requiredKey = `${type.name}.${field}`;
      const overlayRequired = REQUIRED_LOCALISATION.has(requiredKey);
      if (overlayRequired) {
        emitter.overlayAudit.applied("REQUIRED_LOCALISATION", requiredKey);
      }
      const required = entry.required || overlayRequired;
      const pattern = entry.pattern.replace("$", "<id>");
      return renderMember({
        name: field,
        type: "string",
        optional: !required,
        docs: [`English text emitted to localization under \`${pattern}\`.`],
      });
    })
    .join("");
}

/**
 * `pointers` maps a localisation member to the body member the game actually
 * reads its text through, for the synthetic slots that have one. Passed in
 * rather than looked up, because it is a *result* of lowering the body: the
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
        const requiredKey = `${type.name}.${member}`;
        const overlayRequired = REQUIRED_LOCALISATION.has(requiredKey);
        if (overlayRequired) {
          emitter.overlayAudit.applied("REQUIRED_LOCALISATION", requiredKey);
        }
        const required = entry.required || overlayRequired;
        const conditional = conditionalRequirement(type, entry);
        const requiredUnless =
          conditional === null ? "" : `, requiredUnless: ${JSON.stringify(conditional)}`;
        const pointer = pointers.get(member);
        const pointerMember =
          pointer === undefined ? "" : `, pointerMember: ${JSON.stringify(pointer)}`;
        return (
          `  { member: ${JSON.stringify(member)}, pattern: ${JSON.stringify(entry.pattern)}, ` +
          `required: ${required}${requiredUnless}${pointerMember} },\n`
        );
      })
      .join("") +
    "]"
  );
}
