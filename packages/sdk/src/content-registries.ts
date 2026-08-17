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
 *
 * The field-docs ledger rides along for the same consumer: per-member doc
 * prose, optionality, and type text keyed by the field-table arrays the
 * descriptors themselves hold (`field.fields`, `aliasStructFieldsOf`), plus
 * the declined/unsupported/collapsed rows the codegen report prints, so a
 * reference page can render a field table that marks what is absent instead
 * of hiding it.
 */
export {
  CONTENT_REGISTRIES,
  type ContentReferenceName,
  type ContentTypeName,
} from "./generated/content-registry.ts";
export type {
  ContentField,
  ContentLocalisation,
  ContentRegistryDescriptor,
} from "./content/schema.ts";
export { aliasStructFieldsOf } from "./content/schema.ts";
export {
  ALIAS_STRUCT_FIELD_OMISSIONS,
  CONTENT_FIELD_MEMBER_DOCS,
  CONTENT_FIELD_OMISSIONS,
  type ContentFieldOmission,
  type ContentMemberDoc,
} from "./generated/content-field-docs.ts";
