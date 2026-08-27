import {
  checkVanillaPackagePin,
  installedVanillaPackageVersion,
  vanillaIdsCheckWarning,
} from "../identifiers/package-pin.ts";
import { PACKAGED_ENUM_EVIDENCE } from "../identifiers/vanilla-enum-members.ts";
import { PACKAGED_ID_EVIDENCE } from "../identifiers/vanilla-gfx-ids.ts";
import {
  checkVanillaPathInventoryConsistency,
  packagedVanillaPaths,
} from "../identifiers/vanilla-paths.ts";
import type { PatchedContent } from "../installation/vanilla/patch.ts";
import type { VanillaView } from "../installation/vanilla/view.ts";
import { compareUtf8, normalizeLogicalPath } from "../ordering.ts";
import type { RecordedRefUse } from "../references.ts";
import type { CompiledContent } from "./compile-content.ts";
import type { CompiledEvents } from "./compile-events.ts";
import { stemsOf, type BuildSession } from "./compile-session.ts";
import { freezeItems, immutableSet } from "./freeze.ts";
import { registerLocalization } from "./localization.ts";
import type { ComponentTagFile, PureMod } from "./model.ts";
import { collectPatches, planPatches } from "./patches.ts";
import {
  adjudicatePaths,
  DESCRIPTOR_PATH,
  MATERIALIZATION_MANIFEST_PATH,
  onActionsPath,
  shipOfSizeLimitsPath,
  type PathClaim,
} from "./paths.ts";
import { validateReferences } from "./references.ts";

/** Completes whole-build validation, path adjudication, and immutable `PureMod` assembly. */
export function finalizeMod(
  session: BuildSession,
  content: CompiledContent,
  componentTagFiles: readonly ComponentTagFile[],
  events: CompiledEvents
): PureMod {
  const { compileInputs, config, flat, localization, options, refUses, warnings } = session;
  const { contentFiles, definedGroups } = content;
  const {
    contributionStems,
    eventFiles,
    eventIds,
    onActions,
    onActionStems,
    orderedEvents,
    shipOfSizeLimits,
  } = events;

  const patchesByRegistry = collectPatches(flat, options, refUses);
  const patches = [...patchesByRegistry.values()].flat();
  const patchStem = registerFinalLocalization(session, patches);
  const localizationFiles = localization.finish(config.prefix);

  validateReferences({
    prefix: config.prefix,
    contentFiles,
    componentTagIds: new Set(componentTagFiles.flatMap((file) => file.ids)),
    eventFiles,
    eventIds,
    definedGroups,
    patched: patches,
    refUses,
    roleUses: session.roleUses,
    vanillaIdsOf: (registry) =>
      (PACKAGED_ID_EVIDENCE.get(registry) ?? PACKAGED_ENUM_EVIDENCE.get(registry))?.(),
  });

  const claims = collectInitialClaims(session, contentFiles, componentTagFiles, eventFiles);
  const resolvedShipOfSizeLimitsPath =
    shipOfSizeLimits.size > 0 ? shipOfSizeLimitsPath(config.prefix) : undefined;
  if (resolvedShipOfSizeLimitsPath !== undefined) {
    claims.push({
      path: resolvedShipOfSizeLimitsPath,
      producer: {
        kind: "ship-of-size-limits",
        stems: [...contributionStems].sort(compareUtf8),
        detail: "the shared ship-of-size limits",
      },
    });
  }
  const resolvedOnActionsPath = onActions.length > 0 ? onActionsPath(config.prefix) : undefined;
  if (resolvedOnActionsPath !== undefined) {
    claims.push({
      path: resolvedOnActionsPath,
      producer: {
        kind: "on-actions",
        stems: [...onActionStems].sort(compareUtf8),
        detail: "the shared on-action hooks",
      },
    });
  }
  registerLocalizationClaims(claims, localizationFiles);

  const occupiedPaths = claims.map((claim) => claim.path);
  occupiedPaths.push(MATERIALIZATION_MANIFEST_PATH);
  const patchPlans = freezePatchPlans(
    planPatches(config, contentFiles, patchesByRegistry, occupiedPaths)
  );
  registerPatchPlanWarnings(warnings, patchPlans);
  registerPatchPlanClaims(claims, patchPlans, patchesByRegistry, patchStem);

  const vanillaPaths = collectVanillaPaths(session, patches);
  registerUnverifiedAssetWarnings(session, vanillaPaths);
  const paths = adjudicatePaths({ claims, vanillaPaths });
  registerVanillaVersionWarnings(session);

  for (const file of contentFiles) {
    freezeItems(file.entries);
  }
  for (const file of eventFiles) {
    freezeItems(file.entries);
  }
  for (const file of componentTagFiles) {
    freezeItems(file.entries);
  }
  freezeItems(onActions);

  return Object.freeze({
    config,
    compileInputs,
    warnings: Object.freeze(warnings.map((warning) => Object.freeze({ ...warning }))),
    assets: Object.freeze(session.assets.map(({ item }) => item)),
    contentFiles: Object.freeze(
      contentFiles.map((file) =>
        Object.freeze({
          ...file,
          types: Object.freeze([...file.types]),
          ids: Object.freeze([...file.ids]),
        })
      )
    ),
    definedGroups: Object.freeze(
      definedGroups.map((group) =>
        Object.freeze({ ...group, defined: Object.freeze([...group.defined]) })
      )
    ),
    componentTagFiles: Object.freeze(
      componentTagFiles.map((file) => Object.freeze({ ...file, ids: Object.freeze([...file.ids]) }))
    ),
    eventFiles: Object.freeze(eventFiles.map((file) => Object.freeze({ ...file }))),
    events: freezeEvents(orderedEvents),
    onActions,
    localizationFiles,
    shipOfSizeLimits,
    onActionsPath: resolvedOnActionsPath,
    shipOfSizeLimitsPath: resolvedShipOfSizeLimitsPath,
    patchPlans,
    paths,
  });
}

function registerFinalLocalization(
  session: BuildSession,
  patches: readonly PatchedContent[]
): ReadonlyMap<PatchedContent, string | undefined> {
  const locOrderedPatches = [...patches].sort(
    (a, b) => compareUtf8(a.registry, b.registry) || compareUtf8(a.id, b.id)
  );
  const patchStem = new Map(
    session.flat.flatMap(({ item, stem }) =>
      item.itemKind === "patch" ? [[item.patched, stem] as const] : []
    )
  );
  for (const patched of locOrderedPatches) {
    session.warnings.push(...patched.warnings);
    const stem = patchStem.get(patched);
    registerLocalization(session.localization, { layer: "ordinary", stem }, patched.loc);
    registerLocalization(session.localization, { layer: "replace", stem }, patched.replaceLoc);
  }
  for (const { item, stem } of session.flat) {
    if (item.itemKind !== "localization") {
      continue;
    }
    registerLocalization(session.localization, { layer: item.layer, stem }, [
      { key: item.key, translations: item.translations },
    ]);
  }
  registerConsumedLocalization(session);
  return patchStem;
}

/**
 * Places every standalone localization item that recorded script consumed,
 * under the stem of the Feature that placed the consumer (SDK-306).
 *
 * A key-typed content field registers its own consumption while the definition
 * resolves (`content/authoring.ts`), so what reaches here is the other channel:
 * a trigger or effect that wrote the item's key inside a placed definition, an
 * event, or a patch. Every consumer registers, and the accumulator merges their
 * stems and keeps the lowest resulting path, so an item several Features reach
 * still lands in exactly one file per language — the same collapse an item that
 * was also placed explicitly goes through.
 */
function registerConsumedLocalization(session: BuildSession): void {
  for (const { stem, use } of session.refUses) {
    if (use.kind !== "localization") {
      continue;
    }
    registerLocalization(session.localization, { layer: "ordinary", stem }, [
      { key: use.item.key, translations: use.item.translations },
    ]);
  }
}

function collectInitialClaims(
  session: BuildSession,
  contentFiles: CompiledContent["contentFiles"],
  componentTagFiles: readonly ComponentTagFile[],
  eventFiles: CompiledEvents["eventFiles"]
): PathClaim[] {
  const claims: PathClaim[] = [
    {
      path: DESCRIPTOR_PATH,
      producer: { kind: "descriptor", stems: [], detail: "the mod descriptor" },
    },
  ];
  for (const { item, stem } of session.assets) {
    claims.push({
      path: item.path,
      producer: {
        kind: "asset",
        stems: stem === undefined ? [] : [stem],
        detail: `Asset file ${item.path}`,
      },
    });
  }
  for (const file of contentFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "content",
        stems: stemsOf(session, file.relPath),
        detail: `content ${file.ids.join(", ")}`,
      },
    });
  }
  for (const file of componentTagFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "component-tags",
        stems: stemsOf(session, file.relPath),
        detail: `component tags ${file.ids.join(", ")}`,
      },
    });
  }
  for (const file of eventFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "events",
        stems: stemsOf(session, file.relPath),
        detail: `events in ${file.relPath}`,
      },
    });
  }
  return claims;
}

function registerLocalizationClaims(
  claims: PathClaim[],
  localizationFiles: PureMod["localizationFiles"]
): void {
  for (const file of localizationFiles) {
    claims.push({
      path: file.relPath,
      producer: {
        kind: "localization",
        stems: file.stems,
        detail: `${file.language} localization`,
      },
    });
  }
}

function freezePatchPlans(plans: ReturnType<typeof planPatches>): PureMod["patchPlans"] {
  return Object.freeze(
    plans.map((plan) =>
      Object.freeze({
        ...plan,
        assertions: Object.freeze(
          plan.assertions.map((assertion) =>
            Object.freeze({ ...assertion, beats: Object.freeze([...assertion.beats]) })
          )
        ),
      })
    )
  );
}

function registerPatchPlanWarnings(
  warnings: import("../diagnostics.ts").ModWarning[],
  patchPlans: PureMod["patchPlans"]
): void {
  for (const plan of patchPlans) {
    const assumed = plan.assertions.filter((assertion) => assertion.confidence === "assumed");
    if (assumed.length > 0) {
      warnings.push({
        code: "assumed-patch-rule",
        message:
          `Patch plan ${plan.relPath} relies on assumed override rules for ` +
          `${assumed.map((assertion) => `"${assertion.key}"`).join(", ")}; ` +
          "the emitted header records the unverified judgments.",
      });
    }
  }
}

function registerPatchPlanClaims(
  claims: PathClaim[],
  patchPlans: PureMod["patchPlans"],
  patchesByRegistry: ReturnType<typeof collectPatches>,
  patchStem: ReadonlyMap<PatchedContent, string | undefined>
): void {
  for (const plan of patchPlans) {
    const registries = [...new Set(plan.assertions.map((assertion) => assertion.registry))].sort(
      compareUtf8
    );
    claims.push({
      path: plan.relPath,
      producer: {
        kind: "patch-plan",
        stems: [
          ...new Set(
            registries.flatMap((registry) =>
              (patchesByRegistry.get(registry) ?? []).flatMap((patched) => {
                const stem = patchStem.get(patched);
                return stem === undefined ? [] : [stem];
              })
            )
          ),
        ].sort(compareUtf8),
        detail: `the ${registries.join(", ")} patch plan`,
      },
    });
  }
}

function collectVanillaPaths(
  session: BuildSession,
  patches: readonly { readonly source: { readonly origin: VanillaView } }[]
): ReadonlySet<string> {
  const vanillaOrigins = new Set<VanillaView>();
  if (session.options.vanilla !== undefined) {
    vanillaOrigins.add(session.options.vanilla);
  }
  for (const patched of patches) {
    vanillaOrigins.add(patched.source.origin);
  }
  checkVanillaPathInventoryConsistency(installedVanillaPackageVersion());
  return immutableSet([
    ...packagedVanillaPaths(),
    ...[...vanillaOrigins].flatMap((origin) => origin.files.map((file) => file.path)),
    ...[...vanillaOrigins].flatMap((origin) => origin.pathInventory ?? []),
  ]);
}

function registerUnverifiedAssetWarnings(
  session: BuildSession,
  vanillaPaths: ReadonlySet<string>
): void {
  const placedAssetPaths = new Set<string>(session.assets.map(({ item }) => item.path));
  for (const { owner, use } of session.pathUses) {
    if (use.kind !== "string") {
      continue;
    }
    let normalized: string;
    try {
      normalized = normalizeLogicalPath(use.path);
    } catch {
      normalized = use.path;
    }
    if (placedAssetPaths.has(normalized) || vanillaPaths.has(normalized)) {
      continue;
    }
    session.warnings.push({
      code: "unverified-asset-path",
      message:
        `${owner} writes the path "${use.path}" in "${use.field}", and no Asset this build ` +
        `captures and no vanilla file has that path — check the spelling, or ignore this if the ` +
        `file comes from a DLC, another mod, or outside the SDK`,
      path: normalized,
      field: use.field,
      owner,
    });
  }
}

function registerVanillaVersionWarnings(session: BuildSession): void {
  if (session.options.vanilla !== undefined) {
    checkVanillaPackagePin(
      installedVanillaPackageVersion(),
      session.options.vanilla.gameVersion,
      session.config.acceptGameVersion
    );
  }
  const idsWarning = vanillaIdsCheckWarning(
    installedVanillaPackageVersion(),
    session.options.vanilla?.gameVersion,
    session.config.acceptGameVersion
  );
  if (idsWarning !== undefined) {
    session.warnings.push({ code: "mismatched-vanilla-ids", message: idsWarning });
  }
}

/** Deep-freezes one recorded reference; a consumed item is frozen at its constructor. */
function freezeRefUse(use: RecordedRefUse): RecordedRefUse {
  return use.kind === "localization"
    ? Object.freeze({ ...use })
    : Object.freeze({ ...use, targets: Object.freeze([...use.targets]) });
}

function freezeEvents(events: CompiledEvents["orderedEvents"]): PureMod["events"] {
  return Object.freeze(
    events.map((event) =>
      Object.freeze({
        ...event,
        refs: Object.freeze(event.refs.map(freezeRefUse)),
        loc: Object.freeze({
          ...event.loc,
          options: Object.freeze(event.loc.options.map((option) => Object.freeze({ ...option }))),
        }),
        locEntries: Object.freeze(
          event.locEntries.map((entry) =>
            Object.freeze({
              key: entry.key,
              translations: Object.freeze({ ...entry.translations }),
            })
          )
        ),
        warnings: Object.freeze(event.warnings.map((warning) => Object.freeze({ ...warning }))),
      })
    )
  );
}
