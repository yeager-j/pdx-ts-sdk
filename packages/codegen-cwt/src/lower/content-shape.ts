/**
 * Runtime content shapes shared by CWT lowering and the SDK writer.
 * The generator projects this closed vocabulary into the SDK protocol.
 */
export const CONTENT_SHAPES = [
  "value",
  "valueList",
  "trigger",
  "effect",
  "economicResources",
  "economicResourceOperation",
  "economicResourcesNoProduce",
  "triggeredModifierBlock",
  "modifierBlock",
  "inlineModifiers",
  "inlineTrigger",
  "weightBlock",
  "weightBlockWithLoc",
  "dual",
  "struct",
  "triggerStruct",
  "aliasStruct",
  "structMap",
  "scalarMap",
  "repeatedStruct",
  "weightedEvents",
] as const;

/** One runtime shape supported by generated content-field descriptors. */
export type ContentShape = (typeof CONTENT_SHAPES)[number];

const CONTENT_SHAPE_SET: ReadonlySet<string> = new Set(CONTENT_SHAPES);

/**
 * Validates and narrows a runtime content-shape token.
 * Throws when generated or handwritten code names a shape outside the shared protocol.
 */
export function contentShape(value: string): ContentShape {
  if (!CONTENT_SHAPE_SET.has(value)) {
    throw new Error(`Unknown content shape ${JSON.stringify(value)}`);
  }
  return value as ContentShape;
}

/**
 * Scalar conversions supported by generated descriptors and the SDK writer.
 * Keep this closed vocabulary synchronized through {@link emitContentShapeProtocol}.
 */
export const CONTENT_CONVERSIONS = ["identity", "ref", "assetPath"] as const;

/** The scalar conversion a generated field descriptor asks the SDK writer to apply. */
export type ContentConversion = (typeof CONTENT_CONVERSIONS)[number];

/** Emits the shared content-shape and conversion protocol for the SDK package. */
export function emitContentShapeProtocol(): string {
  return (
    `export const CONTENT_SHAPES = ${JSON.stringify(CONTENT_SHAPES)} as const;\n\n` +
    "export type ContentShape = (typeof CONTENT_SHAPES)[number];\n\n" +
    `export const CONTENT_CONVERSIONS = ${JSON.stringify(CONTENT_CONVERSIONS)} as const;\n\n` +
    "export type ContentConversion = (typeof CONTENT_CONVERSIONS)[number];\n"
  );
}
