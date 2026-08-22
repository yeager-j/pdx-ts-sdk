/**
 * Describes corpus-visible interiors for closure-authored block shapes.
 * These shapes have no ordinary CWT field table from which to derive their descents.
 */

import type { Emitter } from "../render/emitter.ts";
import type { LoweredField } from "./fields.ts";
import type { FieldScope } from "./scope-context.ts";

/**
 * The keys a `modifier` row spends on arithmetic or display rather than on
 * gating: `modifier_rule.cwt`'s two maths enums, plus `desc`.
 *
 * What remains in a row is the spliced `alias_name[trigger]`, so this set is
 * exactly what turns a shipped row into the conditions the emitted `Trigger<S>`
 * has to hold. A missing enum throws rather than degrading to an empty set: the
 * corpus reader would then record `add` and `factor` as trigger keys, and every
 * weight block in the game would report a scope mismatch against them.
 */
function weightRowOperations(emitter: Emitter): ReadonlySet<string> {
  const members = (name: string): readonly string[] => {
    const values = emitter.rules.enums.get(name);
    if (values === undefined || values.length === 0) {
      throw new Error(
        `The rules declare no members for enum[${name}], so a weight block's modifier rows ` +
          "cannot be stripped down to the conditions that gate them"
      );
    }
    return values;
  };
  return new Set([...members("complex_maths_enum"), ...members("simple_maths_enum"), "desc"]);
}

/**
 * Describes the repeated modifier conditions inside a generated weight block.
 * The returned field evidence and corpus descent use the holder's scope.
 */
export function weightInterior(
  emitter: Emitter,
  name: string,
  path: string,
  scope: FieldScope
): Pick<LoweredField, "nested" | "descents"> {
  return {
    nested: [
      {
        field: `${path}.modifier`,
        shape: "weightModifier",
        // `modifiers` is an array and the writer emits one `modifier` block per
        // row, so the key repeats inside the weight block.
        repeated: true,
        clause: "trigger",
        scope: scope.scopes,
      },
    ],
    descents: [
      {
        field: name,
        mode: "weightModifiers",
        strippedKeys: weightRowOperations(emitter),
        children: [],
      },
    ],
  };
}

/** The potential condition and its emitter-owned corpus descent. */
export function triggeredModifierInterior(
  name: string,
  path: string,
  potentialScope: FieldScope
): Pick<LoweredField, "nested" | "descents"> {
  return {
    nested: [
      {
        field: `${path}.potential`,
        shape: "trigger",
        repeated: false,
        clause: "trigger",
        scope: potentialScope.scopes,
      },
    ],
    descents: [{ field: name, mode: "triggeredModifierPotential", children: [] }],
  };
}

/** The direct trigger interior owned by `EconomicResourceOperation<S>`. */
export function economicResourceOperationInterior(
  name: string,
  path: string,
  scope: FieldScope
): Pick<LoweredField, "nested" | "descents"> {
  return {
    nested: [
      {
        field: `${path}.trigger`,
        shape: "trigger",
        repeated: false,
        clause: "trigger",
        scope: scope.scopes,
      },
    ],
    descents: [{ field: name, mode: "economicResourceOperationTrigger", children: [] }],
  };
}
