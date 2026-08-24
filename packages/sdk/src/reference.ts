/**
 * Machine-readable facts about the SDK, for consumers that reason *about*
 * the authoring surface rather than author with it.
 *
 * The root entry point exports the pipeline and `./stellaris` exports the
 * game vocabulary; this subpath exports the tables both are generated from.
 * The documentation site is the primary consumer: its reference pages are
 * keyed to registries, its scope pages to the script-reference tables, and
 * its coverage gates diff these tables against the pages that exist.
 *
 * The registry descriptors carry both halves of a row together — the
 * registry name to gate on and the `outputDir` naming the game folder the
 * registry writes to. The field-docs ledger rides along for the same
 * consumer: per-member doc prose, optionality, and type text, plus the
 * declined/unsupported/collapsed rows the codegen report prints, so a
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
export {
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
  SCRIPT_TRIGGER_REFERENCES,
  type ScriptEffectReference,
  type ScriptEffectReferenceKind,
  type ScriptReferenceAvailability,
  type ScriptScopeLinkReference,
  type ScriptTriggerReference,
} from "./generated/script-reference.ts";
export { EVENT_KINDS, type EventKindKey } from "./generated/events.ts";
export { SUPPORTED_STELLARIS_BUILD } from "./installation/vanilla/override-rules.ts";
export {
  PROJECT_LAYOUT_FIELDS,
  projectLayoutFieldSchema,
  type ProjectLayoutFieldDescriptor,
} from "./project-layout.ts";
