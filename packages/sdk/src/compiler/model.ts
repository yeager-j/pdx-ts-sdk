import type { PdxEntry } from "@pdx-ts/pdxscript";

import type { LocalizationLanguage } from "../authoring/localization.ts";
import type { DefinedContent } from "../content/authoring.ts";
import type { ModWarning } from "../diagnostics.ts";
import type { EventItemBase } from "../events/types.ts";
import type { ContentTypeName } from "../generated/content-registry.ts";
import type { PatchPlan } from "../stellaris/vanilla/override-plan.ts";
import type { ResolvedModConfig } from "./config.ts";

/** One emitted file: path plus the entries serialized into it, in order. */
export interface EmittedFile {
  /** The normalized path relative to the mod root. */
  readonly relPath: string;
  /** The ordered PDXScript entries written to the file. */
  readonly entries: readonly PdxEntry[];
}

/** A content file plus the registry metadata needed by compiler leaves. */
export interface ContentFile extends EmittedFile {
  readonly types: readonly ContentTypeName[];
  readonly ids: readonly string[];
}

/** A group of definitions that share one registry and emitted path. */
export interface DefinedGroup {
  readonly type: ContentTypeName;
  readonly relPath: string;
  readonly defined: readonly DefinedContent<string, { readonly id: string }>[];
}

/** One fully resolved localization file, ready for pure rendering. */
export interface LocalizationFile {
  /** The normalized path relative to the mod root. */
  readonly relPath: string;
  /** The language used by both the directory/filename and file header. */
  readonly language: LocalizationLanguage;
  /** Entries sorted by localization key. */
  readonly entries: readonly (readonly [key: string, text: string])[];
}

/** The assembled mod: a value, not a builder. `render(mod)` consumes it. */
export interface PureMod {
  /** Validated and immutable launcher configuration. */
  readonly config: ResolvedModConfig;
  /** Diagnostics collected during the fold. */
  readonly warnings: readonly ModWarning[];
  /** Content emission, grouped by registry and collection file. */
  readonly contentFiles: readonly ContentFile[];
  /** Event emission: one file per stem and namespace. */
  readonly eventFiles: readonly EmittedFile[];
  /** Events in canonical emission order. */
  readonly events: readonly EventItemBase[];
  /** On-action hook blocks in canonical emission order. */
  readonly onActions: readonly PdxEntry[];
  /** Feature-scoped ordinary and replacement localization files, in path order. */
  readonly localizationFiles: readonly LocalizationFile[];
  /** Shared ship-size-limit contribution ids. */
  readonly shipOfSizeLimits: ReadonlySet<string>;
  /** The planned vanilla overrides, one per patched registry, in path order. */
  readonly patchPlans: readonly PatchPlan[];
  /** Vanilla paths known to the build, used by `render` for collision checks. */
  readonly vanillaPaths: ReadonlySet<string> | undefined;
}
