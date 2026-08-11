/**
 * The closed vocabulary shared by CWT content lowering and the SDK writer.
 *
 * This list is generator-owned. `index.ts` projects it into the SDK's
 * generated directory, where `content/schema.ts` proves its discriminated
 * union still has exactly the same members.
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

export function emitContentShapeProtocol(): string {
  return (
    `export const CONTENT_SHAPES = ${JSON.stringify(CONTENT_SHAPES)} as const;\n\n` +
    "export type ContentShape = (typeof CONTENT_SHAPES)[number];\n"
  );
}
