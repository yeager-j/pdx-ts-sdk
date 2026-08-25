import type { PdxEntry, PdxItem } from "@pdx-ts/pdxscript";

import type { AssetFileItem } from "../authoring/assets.ts";
import type { LocalizationLanguage } from "../authoring/localization.ts";
import type { DefinedContent } from "../content/authoring.ts";
import type { ModWarning } from "../diagnostics.ts";
import type { EventItemBase } from "../events/types.ts";
import type { ContentTypeName } from "../generated/content-registry.ts";
import type { PatchPlan } from "../installation/vanilla/override-plan.ts";
import type { LogicalPath } from "../ordering.ts";
import type { ResolvedModConfig } from "./config.ts";
import type { PathClaim } from "./paths.ts";

/** One emitted file: path plus the entries serialized into it, in order. */
export interface EmittedFile<T extends PdxItem = PdxEntry> {
  /** The minted path relative to the mod root. */
  readonly relPath: LogicalPath;
  /** The ordered PDXScript entries written to the file. */
  readonly entries: readonly T[];
}

/** A content file plus the registry metadata needed by compiler leaves. */
export interface ContentFile extends EmittedFile {
  readonly types: readonly ContentTypeName[];
  readonly ids: readonly string[];
}

/** One bare-scalar component-tag file. */
export interface ComponentTagFile extends EmittedFile<PdxItem> {
  /** Every tag id this file declares. */
  readonly ids: readonly string[];
}

/** A group of definitions that share one registry and emitted path. */
export interface DefinedGroup {
  readonly type: ContentTypeName;
  readonly relPath: LogicalPath;
  readonly defined: readonly DefinedContent<string, { readonly id: string }>[];
}

/** One fully resolved localization file, ready for pure rendering. */
export interface LocalizationFile {
  /** The minted path relative to the mod root. */
  readonly relPath: LogicalPath;
  /** The language used by both the directory/filename and file header. */
  readonly language: LocalizationLanguage;
  /**
   * Every Feature stem whose entries landed here, sorted. Plural because one
   * key registered under two stems resolves to the byte-lowest of their paths,
   * so a file can carry entries several Features contributed.
   */
  readonly stems: readonly string[];
  /** Entries sorted by localization key. */
  readonly entries: readonly (readonly [key: string, text: string])[];
}

/** One named or unnamed Feature group supplied to a Fold. */
export interface CompiledFeatureInput {
  /** The authored Feature stem, or `undefined` for unnamed Features. */
  readonly stem: string | undefined;
  /** Number of Items placed by this Feature. */
  readonly itemCount: number;
  /** Authored content, event, and component-tag ids placed by this Feature. */
  readonly itemIds: readonly string[];
}

/** Vanilla evidence supplied directly to a Fold. */
export interface CompiledVanillaInput {
  /** Whether the Fold received a parsed vanilla view. */
  readonly loadedView: boolean;
  /** The loaded view's Stellaris version, when it carried one. */
  readonly gameVersion: string | undefined;
  /** Whether the loaded view carried a complete install path inventory. */
  readonly pathInventory: boolean;
}

/** Immutable input provenance retained for inspection tools. */
export interface CompileInputs {
  /** Feature inputs in canonical stem order. */
  readonly features: readonly CompiledFeatureInput[];
  /** Parsed vanilla evidence supplied to the Fold. */
  readonly vanilla: CompiledVanillaInput;
}

/** The assembled mod: a value, not a builder. `render(mod)` consumes it. */
export interface PureMod {
  /** Validated and immutable launcher configuration. */
  readonly config: ResolvedModConfig;
  /** Input provenance retained for inspection without affecting emitted bytes. */
  readonly compileInputs: CompileInputs;
  /** Diagnostics collected during the fold. */
  readonly warnings: readonly ModWarning[];
  /** Captured opaque Asset files placed by Features, in canonical path order. */
  readonly assets: readonly AssetFileItem[];
  /** Content emission, grouped by registry and collection file. */
  readonly contentFiles: readonly ContentFile[];
  /**
   * Every defined content item with its original definition, grouped the way
   * it emits. For consumers that reason about the mod — inspection and
   * tooling — rather than serialize it; `contentFiles` carry the lowered
   * entries `render` writes.
   */
  readonly definedGroups: readonly DefinedGroup[];
  /** Component-tag emission, one bare-scalar file per feature stem. */
  readonly componentTagFiles: readonly ComponentTagFile[];
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
  /** Where the shared on-action file goes; `undefined` when there are none. */
  readonly onActionsPath: LogicalPath | undefined;
  /** Where the shared ship-size-limit file goes; `undefined` when there are none. */
  readonly shipOfSizeLimitsPath: LogicalPath | undefined;
  /** The planned vanilla overrides, one per patched registry, in path order. */
  readonly patchPlans: readonly PatchPlan[];
  /**
   * Every path this mod occupies, adjudicated and in enumeration order. A
   * `PureMod` that exists is collision-free; this is the ledger that says so,
   * and `render` serializes exactly these paths and no others.
   */
  readonly paths: readonly PathClaim[];
}
