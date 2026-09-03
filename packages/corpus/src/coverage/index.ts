/** The pure syntax-coverage model: sites, surfaces, summary, and formatting. */

export { sitesOfEventFields, type EventFieldPolicyTables } from "./event-fields.ts";
export { formatCoverageReport, type CoverageProvenance } from "./format.ts";
export {
  COVERAGE_CLASSES,
  EXPRESSIBLE_CLASSES,
  HAND_WRITTEN_LINKS,
  handWrittenOwnership,
  siteClassOfSkip,
  type CoverageClass,
  type CoverageSite,
  type CoverageSurface,
  type CoverageSurfaceId,
  type HandWrittenOwnership,
  type SiteClassification,
  type UsageOf,
} from "./model.ts";
export {
  rerootPath,
  sitesOfRegistry,
  type PathRoot,
  type RegistryCoverageInput,
} from "./registries.ts";
export {
  sitesOfDeclaredKeys,
  sitesOfEffects,
  sitesOfModifiers,
  sitesOfScopeLinks,
  sitesOfTriggers,
  type ScriptRuleEmissionFacts,
} from "./script-surfaces.ts";
export {
  summarizeCoverage,
  type CoverageCounts,
  type CoverageReport,
  type CoverageSummary,
  type SurfaceCoverage,
} from "./summary.ts";
