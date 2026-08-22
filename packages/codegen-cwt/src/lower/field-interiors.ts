/**
 * The hand-stated interiors of the closure-authored shapes: what a weight
 * block, a triggered modifier, or an economic-resource operation holds inside,
 * as the emitted fields and corpus descents the shape dispatcher attaches to
 * the lowering. These shapes have no CWT fields table to derive an interior
 * from — their authoring shape is an SDK closure — so each interior worth
 * measuring is stated here.
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
 * A weight block's `modifier` rows, as one emitted field and one descent.
 *
 * Every other block shape describes its interior through `structShape`, off a
 * CWT fields table. A weight block has none — `modifier_rule` is an alias
 * category, and the authoring shape is the SDK's own `WeightBlock<S>` — so the
 * one interior worth measuring is stated here instead: the row's gating
 * condition, at the holder's own scope, which is where `Modifier.when`'s
 * `Trigger<S>` is instantiated.
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
