/**
 * The closed vocabularies shared by CWT content lowering and the SDK writer.
 *
 * Both lists are generator-owned. `index.ts` projects them into the SDK's
 * generated directory, where `content/schema.ts` proves its discriminated
 * union and its conversion union still have exactly the same members.
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

export type ContentShape = (typeof CONTENT_SHAPES)[number];

const CONTENT_SHAPE_SET: ReadonlySet<string> = new Set(CONTENT_SHAPES);

export function contentShape(value: string): ContentShape {
  if (!CONTENT_SHAPE_SET.has(value)) {
    throw new Error(`Unknown content shape ${JSON.stringify(value)}`);
  }
  return value as ContentShape;
}

/**
 * How the writer turns one authored scalar into the value it writes.
 *
 * `identity` writes it as it stands, `ref` unwraps a branded reference to its
 * id, `assetPath` unwraps an `AssetFileItem` to its declared logical path and
 * records the path either way (SDK-121). A second closed list beside
 * {@link CONTENT_SHAPES} because it fails the same way: a conversion the
 * emitter writes and the writer does not implement is silently wrong output,
 * and only an exhaustiveness pin on both ends catches it.
 */
export const CONTENT_CONVERSIONS = ["identity", "ref", "assetPath"] as const;

export type ContentConversion = (typeof CONTENT_CONVERSIONS)[number];

export function emitContentShapeProtocol(): string {
  return (
    `export const CONTENT_SHAPES = ${JSON.stringify(CONTENT_SHAPES)} as const;\n\n` +
    "export type ContentShape = (typeof CONTENT_SHAPES)[number];\n\n" +
    `export const CONTENT_CONVERSIONS = ${JSON.stringify(CONTENT_CONVERSIONS)} as const;\n\n` +
    "export type ContentConversion = (typeof CONTENT_CONVERSIONS)[number];\n"
  );
}
