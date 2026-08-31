/**
 * Mod identity and launcher configuration without loading the authoring surface.
 *
 * Metadata tools can validate configuration through this entry point without
 * evaluating content registries, identifier inventories, or compiler modules.
 */
export {
  DESCRIPTOR_VALUE_PATTERN,
  MOD_PREFIX_PATTERN,
  resolveConfig,
  type BuildOptions,
  type ModConfig,
  type ResolvedModConfig,
} from "./compiler/config.ts";
