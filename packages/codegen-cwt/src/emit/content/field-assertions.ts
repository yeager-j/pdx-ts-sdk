/**
 * The overlay's evidence-backed assertions, applied around the ordinary
 * projection. An arity assertion corrects the declared cardinality and
 * `uncheckedString` rewrites the declaration itself, so everything downstream
 * reads one corrected rule; an asset-path row corrects the projected result
 * instead, because no CWT spelling means what that row asserts. Each guard
 * throws when the field it names stops projection the way its row claims.
 */

import type { RuleField, RuleType } from "../../cwt/model.ts";
import { ASSET_PATH_FIELDS, type ContentFieldOverride } from "../../overlay/index.ts";
import type { Emitter } from "../typescript.ts";
import { arrayType, metadata, repeatsSiblings } from "./field-metadata.ts";
import type { FieldProjection } from "./field-projection.ts";

/**
 * Applies an overlay arity assertion by correcting the declared cardinality.
 * It preserves the declared minimum because requiredness and repetition are
 * separate claims.
 */
export function assertedArity(
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined
): readonly RuleField[] {
  if (override?.arity === undefined) {
    return group;
  }
  const max = override.arity === "single" ? 1 : null;
  return group.map((field) => ({ ...field, cardinality: { ...field.cardinality, max } }));
}

/**
 * Applies `uncheckedString` by replacing plain type references with scalar
 * declarations. It rejects shape overrides and other declaration kinds so the
 * assertion cannot erase unrelated validation.
 */
export function assertedUncheckedString(
  emitter: Emitter,
  group: readonly RuleField[],
  override: ContentFieldOverride | undefined,
  path: string
): {
  /** Declarations after applying the unchecked-string assertion. */
  readonly group: readonly RuleField[];
  /** Author-facing documentation contributed by the assertion. */
  readonly docs: readonly string[];
} {
  if (override?.uncheckedString !== true) {
    return { group, docs: [] };
  }
  const targets = group.map((field) => field.type);
  const allTypeReferences = targets.every(
    (type): type is Extract<RuleType, { readonly kind: "typeRef" }> => type.kind === "typeRef"
  );
  if (override.shape !== undefined || !allTypeReferences) {
    const spelled = targets.map((type) => type.kind).join(", ");
    throw new Error(
      `The overlay marks ${path} uncheckedString, but its projection is not a plain type ` +
        `reference (shape: ${override.shape ?? "none"}, declarations: ${spelled}). The lever ` +
        "only weakens a reference check; it must not erase any other checking."
    );
  }
  const docs = targets.flatMap((type) => {
    const name = type.name;
    const target = emitter.rules.contentTypes.get(name);
    const location =
      target?.path == null
        ? "outside the SDK's typed registries"
        : `in \`${target.pathExtension ?? ".txt"}\` files under ` +
          `\`${target.path.replace(/^game\//, "")}\``;
    return [
      "Not checked: any string is accepted here.",
      `The \`<${name}>\` ids this names live ${location},`,
      "which the SDK carries as opaque Assets rather than as a typed registry,",
      "so there is no id set to check a spelling against.",
    ];
  });
  return { group: group.map((field) => ({ ...field, type: { kind: "scalar" } })), docs };
}

/**
 * Widens an asserted asset-path scalar to accept a captured asset item or a
 * string, and marks its runtime conversion as `assetPath`. It rejects non-path,
 * non-scalar, or separately widened fields before changing the projection.
 */
export function assertedAssetPath(
  emitter: Emitter,
  projected: FieldProjection | null,
  group: readonly RuleField[],
  name: string,
  widening: string | undefined,
  path: string
): FieldProjection | null {
  if (!ASSET_PATH_FIELDS.has(path)) {
    return projected;
  }
  emitter.overlayAudit.applied("ASSET_PATH_FIELDS", path);
  const spelled = group.map((field) => field.type.kind).join(", ");
  if (
    projected === null ||
    projected.admits.shape !== "value" ||
    widening !== undefined ||
    !group.every((field) => field.type.kind === "filepath")
  ) {
    throw new Error(
      `The overlay marks ${path} an asset path, but it does not lower as one (shape: ` +
        `${projected?.admits.shape ?? "none"}, declarations: ${spelled}, widening: ` +
        `${widening ?? "none"}). The row asserts the value is one mod-root path scalar.`
    );
  }
  const base = `${emitter.use("AssetFileItem")} | string`;
  const field = group[0]!;
  return {
    ...projected,
    memberType: repeatsSiblings(field, "value") ? arrayType(base) : base,
    metadata: metadata(field, name, "value", ['conversion: "assetPath"']),
    docs: [
      ...(projected.docs ?? []),
      "A path from the mod root. An Asset file placed in a Feature lowers to its declared",
      "logical path; a plain string is written as it stands and checked at build time against",
      "the paths this mod captures and the vanilla file inventory, as a warning rather than an",
      "error — a DLC or third-party path is legitimate here.",
    ],
  };
}
