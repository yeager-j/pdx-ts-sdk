export { describeInstall, type InstallDescription } from "./installation/describe.ts";
export { locateInstall, platformDefaultsFor } from "./installation/locate.ts";
export {
  isOsMetadataPath,
  readZipEntryNames,
  scanInstallPaths,
  type VanillaPathScan,
} from "./installation/scan-paths.ts";
export {
  readGameVersion,
  requireGameVersion,
  supportedVersionFor,
} from "./installation/version.ts";
export { modDir, modDirFor } from "./launcher/mod-directory.ts";
export { load, type LoadOptions } from "./vanilla/load.ts";
export {
  anyOf,
  ParsedDefinition,
  ParsedTechnology,
  type AnyOf,
  type ParsedBuilding,
  type ParsedMegastructure,
  type ParsedNumber,
  type ParsedRegistries,
  type ParsedRegistryName,
  type Prerequisite,
  type VanillaFile,
} from "./vanilla/parsed-definitions.ts";
export { VanillaView, viewFromFiles } from "./vanilla/view.ts";
