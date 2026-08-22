/**
 * What the committed vanilla-game fixture observes, per registry.
 *
 * The curated field allowlists asked a reviewer to vouch for fields the
 * evidence already settles: `component_template.size` is `enum[weapon_slot_size]`,
 * a closed set in the rules, present on all 1388 vanilla component templates.
 * There is nothing there for a human to add, and doubt about whether the SDK
 * lowers it correctly is a testing gap rather than something curation fixes.
 *
 * The parser already proves itself against a full-vanilla fixpoint. This gives
 * the content emitter the same standard: parse every real definition and
 * measure the emitted interface against it.
 *
 * The corpus is an observed LOWER bound, not evidence of completeness. A field
 * vanilla never writes may still be legal, so absence is reported, never
 * failed. A field vanilla does write in a shape authors cannot express is
 * concrete evidence of a lowering gap.
 *
 * Two questions, not one. `conformance` asks whether a field is *present*
 * in the emitted interface; `shapeConformance` asks whether its lowered
 * type can hold what real definitions put there. Only the second sees a
 * block-typed field against 254 scalar writes, or a required condition no
 * author can satisfy.
 *
 * Split by role: `observations.ts` is the vocabulary, `read.ts` the reading
 * engine, `conformance.ts` the verdicts. This file is their index — the
 * `@pdx-ts/codegen-cwt/corpus` subpath resolves here, unchanged for every
 * importer.
 */

export * from "./conformance.ts";
export * from "./observations.ts";
export * from "./read.ts";
