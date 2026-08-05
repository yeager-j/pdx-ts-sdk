/**
 * The one authored form a lowered field's member accepts: `scalar`, `list`,
 * `trigger`, `closure`, or `block`.
 *
 * Previously the SDK's own `acceptedForm` (`@pdx-ts/sdk/content`), shared so
 * codegen could ask a dual field's arms the same question the runtime writer
 * asks when dispatching an authored value to one of them. That import was the
 * one edge making the declared sdk↔codegen cycle real. The house pattern for
 * this — data-driven additions to generated descriptors — is to compute the
 * answer once, here, at codegen time, and write it into the descriptor's own
 * `form` property; the runtime then only ever reads `field.form`, never
 * reclassifies a shape into a form itself. See `ContentField.form` in
 * `@pdx-ts/sdk`'s `content/schema.ts` for the consuming side.
 */
export type AuthoredForm = "scalar" | "list" | "trigger" | "closure" | "block";

/**
 * Structurally typed rather than taking a whole emitted field so this can be
 * asked of a lowering still being built: a dual is only well formed when its
 * arms accept *different* forms, which has to be decided by the same rule the
 * generated descriptor will carry, not a second copy of it.
 */
export function authoredForm(field: {
  readonly shape: string;
  readonly repeated?: boolean;
  readonly wrapped?: boolean;
}): AuthoredForm {
  switch (field.shape) {
    case "trigger":
      return "trigger";
    case "effect":
    case "modifierBlock":
    case "inlineModifiers":
      return "closure";
    case "valueList":
    case "weightedEvents":
      return "list";
    case "struct":
      return field.repeated === true || field.wrapped === true ? "list" : "block";
    case "value":
    case "economicResources":
    case "economicResourcesNoProduce":
    case "triggeredModifierBlock":
    case "aliasStruct":
      return field.repeated === true ? "list" : field.shape === "value" ? "scalar" : "block";
    case "dual":
      // A dual's arms are ordinary fields; nesting one inside another would
      // mean CWT declared the same key at three incompatible forms, and
      // `lowerDual` builds its arms from single declarations either way.
      throw new Error("A dual field cannot be another dual's arm");
    default:
      return "block";
  }
}
