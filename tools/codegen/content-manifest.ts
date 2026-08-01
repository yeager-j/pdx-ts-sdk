/**
 * The content registries the SDK deliberately exposes.
 *
 * This is an allowlist, not filesystem discovery: adding a registry is a
 * public-interface decision and must bring reviewed field overlays and
 * goldens with it.
 */
export interface ContentManifestEntry {
  readonly type: string;
  readonly source: string;
}

export const CONTENT_MANIFEST = [
  { type: "technology", source: "common/technologies_consolidated.cwt" },
  { type: "building", source: "common/buildings.cwt" },
  { type: "tradition", source: "common/traditions.cwt" },
  { type: "tradition_category", source: "common/traditions.cwt" },
  { type: "ascension_perk", source: "common/ascension_perks.cwt" },
  { type: "agenda", source: "common/council_agendas.cwt" },
  { type: "edict", source: "common/edicts.cwt" },
  { type: "decision", source: "common/decisions.cwt" },
  { type: "job", source: "common/pop_jobs.cwt" },
] as const satisfies readonly ContentManifestEntry[];
