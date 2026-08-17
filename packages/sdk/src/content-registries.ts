/**
 * The generated registry descriptors, as public data.
 *
 * `src/index.ts` exports the authoring surface — what a mod's build script
 * calls. This subpath exports the table that surface is generated from, for
 * consumers that reason *about* the registries rather than author with them.
 *
 * The documentation site is the first: its reference pages are keyed to
 * registries, and its coverage gate diffs this table against the pages that
 * exist. It needs both halves of a row together — the registry name to gate on
 * and the `outputDir` to say which game folder the registry writes to — and
 * this is the only place the two sit side by side. `CONTENT_MANIFEST` in
 * `@pdx-ts/codegen-cwt` is the list's origin but carries no folder, because the
 * folder is read from the CWT rules during generation.
 */
export {
  CONTENT_REGISTRIES,
  type ContentReferenceName,
  type ContentTypeName,
} from "./generated/content-registry.ts";
export type { ContentRegistryDescriptor } from "./content/schema.ts";
