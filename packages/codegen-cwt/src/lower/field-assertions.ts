/**
 * The overlay's evidence-backed assertions, applied around the ordinary
 * lowering. An arity assertion corrects the declared cardinality and
 * `uncheckedString` rewrites the declaration itself, so everything downstream
 * reads one corrected rule; an asset-path row corrects the lowered result
 * instead, because no CWT spelling means what that row asserts. Each guard
 * throws when the field it names stops lowering the way its row claims.
 */

import type { RuleField, RuleType } from "../cwt/model.ts";
import { ASSET_PATH_FIELDS, type ContentFieldOverride } from "../overlay/index.ts";
import type { Emitter } from "../render/emitter.ts";
import { arrayType, metadata, repeatsSiblings } from "./field-metadata.ts";
import type { LoweredField } from "./fields.ts";

/**
 * Applies an overlay arity assertion by correcting the declared cardinality.
 *
 * Everything downstream — the member type, the field metadata's `repeated`, the
 * shape descriptor — already reads the cardinality, so correcting it once here
 * is what keeps the three from disagreeing about whether the key repeats. The
 * minimum is left alone in both directions: how often a key may be written is a
 * different claim from whether it must be.
 */
export function assertedArity(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): readonly RuleField[] {
  const max = override?.arity === "single" ? 1 : override?.arity === "repeated" ? null : undefined;
  if (max === undefined) {
    return group;
  }
  return group.map((field) => ({ ...field, cardinality: { ...field.cardinality, max } }));
}

/**
 * Applies `uncheckedString` by rewriting the declaration itself: a `<type>`
 * reference becomes a plain `scalar`, which is already how CWT spells "any
 * string" and which every emitter below already knows how to lower.
 *
 * Rewriting the rule rather than patching the lowered result is what keeps the
 * member type, the metadata's `conversion`, the absent `refTypes` and the
 * corpus gate's view of the field from having to be corrected one by one. The
 * doc line rides on the same field, so it reaches the generated comment through
 * the ordinary path.
 *
 * The guard is the point of the lever being narrow: every declaration in the
 * group must be a bare `<type>` reference and the row must request no shape.
 * Anything else and this would be erasing a check nobody asked it to.
 */
export function assertedUncheckedString(
  emitter: Emitter,
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined,
  path: string
): { readonly group: readonly RuleField[]; readonly docs: readonly string[] } {
  if (override?.uncheckedString !== true) {
    return { group, docs: [] };
  }
  const targets = group.map((field) => field.type);
  if (override.shape !== undefined || targets.some((type) => type.kind !== "typeRef")) {
    const spelled = targets.map((type) => type.kind).join(", ");
    throw new Error(
      `The overlay marks ${path} uncheckedString, but its lowering is not a plain type ` +
        `reference (shape: ${override.shape ?? "none"}, declarations: ${spelled}). The lever ` +
        "only weakens a reference check; it must not erase any other checking."
    );
  }
  const docs = targets.flatMap((type) => {
    const name = (type as Extract<RuleType, { kind: "typeRef" }>).name;
    const target = emitter.rules.contentTypes.get(name);
    const where =
      target?.path == null
        ? "outside the SDK's typed registries"
        : `in \`${target.pathExtension ?? ".txt"}\` files under ` +
          `\`${target.path.replace(/^game\//, "")}\``;
    return [
      "Not checked: any string is accepted here.",
      `The \`<${name}>\` ids this names live ${where},`,
      "which the SDK carries as opaque Assets rather than as a typed registry,",
      "so there is no id set to check a spelling against.",
    ];
  });
  return { group: group.map((field) => ({ ...field, type: { kind: "scalar" } })), docs };
}

/**
 * Applies an `ASSET_PATH_FIELDS` row: the member accepts a captured Asset as
 * well as a string, and the metadata says so, so the writer unwraps the Item to
 * its declared logical path and the fold checks whichever form arrived.
 *
 * Applied to the lowered result rather than by rewriting the rule, because
 * unlike `uncheckedString` there is no CWT spelling that already means this —
 * the rules type the field `filepath` and are right to; what the row adds is
 * the SDK's own knowledge that this particular path is one a mod can ship.
 *
 * The guards are what keep the row honest. A `filepath` declaration is required
 * because the row asserts the value is a path; a `value` shape is required
 * because an Item is one scalar; and a widening is refused because the union
 * arms would then be unclear about which of them an Item satisfies.
 *
 * Presence — every `ASSET_PATH_FIELDS` row reaching a real consumption site —
 * is tracked through `emitter.overlayAudit`, the same SDK-255 mechanism every
 * other path-keyed overlay table uses (`index.ts`'s `assertAllApplied("ASSET_PATH_FIELDS",
 * ...)` closes the loop); this function's own throw above is the *shape* check
 * beyond presence, that a row marked here actually lowers as one mod-root path
 * scalar, which `OverlayAudit` cannot express and stays here.
 */
export function assertedAssetPath(
  emitter: Emitter,
  lowered: LoweredField | null,
  group: readonly RuleField[],
  name: string,
  widening: string | undefined,
  path: string
): LoweredField | null {
  if (!ASSET_PATH_FIELDS.has(path)) {
    return lowered;
  }
  emitter.overlayAudit.applied("ASSET_PATH_FIELDS", path);
  const spelled = group.map((field) => field.type.kind).join(", ");
  if (
    lowered === null ||
    lowered.admits.shape !== "value" ||
    widening !== undefined ||
    !group.every((field) => field.type.kind === "filepath")
  ) {
    throw new Error(
      `The overlay marks ${path} an asset path, but it does not lower as one (shape: ` +
        `${lowered?.admits.shape ?? "none"}, declarations: ${spelled}, widening: ` +
        `${widening ?? "none"}). The row asserts the value is one mod-root path scalar.`
    );
  }
  const base = `${emitter.use("AssetFileItem")} | string`;
  const field = group[0]!;
  return {
    ...lowered,
    memberType: repeatsSiblings(field, "value") ? arrayType(base) : base,
    metadata: metadata(field, name, "value", ['conversion: "assetPath"']),
    docs: [
      ...(lowered.docs ?? []),
      "A path from the mod root. An Asset file placed in a Feature lowers to its declared",
      "logical path; a plain string is written as it stands and checked at build time against",
      "the paths this mod captures and the vanilla file inventory, as a warning rather than an",
      "error — a DLC or third-party path is legitimate here.",
    ],
  };
}
