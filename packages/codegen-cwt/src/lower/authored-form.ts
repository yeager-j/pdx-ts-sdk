/**
 * Classifies lowered content shapes by their authored runtime form.
 * Codegen writes the result into field descriptors so the SDK writer does not reclassify shapes.
 */
import type { ContentShape } from "./content-shape.ts";

/** The runtime form an author passes for one lowered content field. */
export type AuthoredForm = "scalar" | "list" | "trigger" | "closure" | "block";

/**
 * Classifies a content shape by the form its generated authoring member accepts.
 * Dual-field lowering uses the result to reject arms that runtime dispatch
 * cannot distinguish.
 */
export function formOfShape(field: {
  /** The generated runtime descriptor shape. */
  readonly shape: ContentShape;
  /** Whether the PDXScript key may repeat as siblings. */
  readonly repeated?: boolean;
  /** Whether anonymous repetition occurs inside one outer key. */
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
    case "triggerStruct":
      return field.repeated === true || field.wrapped === true ? "list" : "block";
    case "value":
      return field.repeated === true ? "list" : "scalar";
    case "economicResources":
    case "economicResourcesNoProduce":
    case "triggeredModifierBlock":
    case "aliasStruct":
      return field.repeated === true ? "list" : "block";
    case "economicResourceOperation":
    case "weightBlock":
    case "weightBlockWithLoc":
    case "structMap":
    case "scalarMap":
    case "repeatedStruct":
      return "block";
    case "inlineTrigger":
      return "trigger";
    case "dual":
      // A dual's arms are ordinary fields; nesting one inside another would
      // mean CWT declared the same key at three incompatible forms, and
      // `lowerDual` builds its arms from single declarations either way.
      throw new Error("A dual field cannot be another dual's arm");
  }
}
