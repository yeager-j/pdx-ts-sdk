/**
 * Sites of a CWT content type the manifest does not expose.
 *
 * The registry denominator is every `type[...]` declaration with a `path`
 * in the vendored config, not only the manifested ones. A type with no
 * manifest row contributes one site per declared top-level body field, so
 * its unit matches an exposed registry's field paths. Nested fields of such
 * a type are not counted, and neither are computed keys
 * (`enum[x] = ...`); an unkeyed alias splice counts as `alias_name[<category>]`.
 * A type whose body declares no fields, or has no body, still contributes
 * one site (the type itself), so it cannot leave the denominator.
 *
 * Classes: as {@link UNEXPOSED_TYPE_DISPOSITIONS} decides for the type's
 * folder (`policy-owned` for a channel the SDK writes, `declined` for
 * definitions the SDK replaces on purpose); otherwise `gap`, untracked. A
 * type whose sites another surface already counts is excluded here
 * ({@link TYPES_COUNTED_ELSEWHERE}).
 */

import type { RuleField } from "@pdx-ts/codegen-cwt/cwt/model";
import type { ContentBody } from "@pdx-ts/codegen-cwt/cwt/rules";
import { compareUtf8 } from "@pdx-ts/sdk/internals";

import type { CoverageSite, CoverageSurfaceId, SiteClassification } from "./model.ts";

/** What the SDK does with an unexposed type's folder instead of a registry. */
export type UnexposedTypeDisposition =
  | {
      /** The SDK writes the folder through a channel. */
      readonly class: "policy-owned";
      /** The SDK writer, cited. */
      readonly reason: string;
    }
  | {
      /** The SDK replaces the folder's definitions on purpose. */
      readonly class: "declined";
      /** Why. */
      readonly reason: string;
    };

const SCRIPTED_DEFINITION_DECLINED =
  "declined: a TypeScript function (or constant) replaces a named definition; the SDK inlines " +
  "the result where it is used. Overriding a vanilla name is a patch, not a function, and has " +
  "no requesting mod yet.";

/**
 * Folders (relative to the game root) the SDK handles without a registry,
 * keyed by the path a CWT type declares. A `policy-owned` row cites the SDK
 * writer; a `declined` row states why the SDK replaces the definitions. A
 * type whose path has no row is a gap.
 *
 * The scripted folders are declined by design: the parity mod (Dawn Of
 * Ascension) defines 23 scripted triggers, 6 scripted effects, and 77
 * scripted variables and overrides no vanilla name, so every one is a
 * TypeScript function or constant. CWT declares no type for
 * `common/scripted_variables` or `common/inline_scripts`, so those two
 * folders appear in the "folders without a CWT type" caveat instead. Calling
 * a vanilla inline script from a patch is a separate gap the `inline_script`
 * rows of `gaps.ts` (SDK-17) still track.
 *
 * Each `policy-owned` row is a claim that the SDK writes the folder.
 * `tests/coverage.test.ts` proves it: it builds a mod through the cited
 * methods, writes it to disk, and fails naming any row whose folder no file
 * lands under. `packages/docs-site/src/registry-coverage.ts` `CHANNELS`
 * documents the same behaviour from the same SDK, so a change to either
 * surfaces in one of the two tests. That list also names `localisation` and
 * assets, which have no CWT type, and
 * `common/country_limits/ownership_limits`, which is the manifested
 * `country_ship_of_size_limit` registry; none of those is an unexposed type.
 */
export const UNEXPOSED_TYPE_DISPOSITIONS: ReadonlyMap<string, UnexposedTypeDisposition> = new Map<
  string,
  UnexposedTypeDisposition
>([
  [
    "events",
    {
      class: "policy-owned",
      reason:
        "written by `mod.namespace` (packages/sdk/src/authoring/mod.ts); the event fields surface counts the fields",
    },
  ],
  [
    "common/on_actions",
    {
      class: "policy-owned",
      reason:
        "written by `mod.on` into `<prefix>_on_actions.txt` (packages/sdk/src/compiler/paths.ts)",
    },
  ],
  ["common/scripted_triggers", { class: "declined", reason: SCRIPTED_DEFINITION_DECLINED }],
  ["common/scripted_effects", { class: "declined", reason: SCRIPTED_DEFINITION_DECLINED }],
]);

/**
 * CWT types whose sites another surface already counts, to where. Counting
 * them here again would count the same syntax twice.
 *
 * `event` is the event fields surface. Each `swapped_*` type describes the
 * swap blocks nested inside a manifested registry's definitions, which that
 * registry counts as nested field sites under the named field.
 */
export const TYPES_COUNTED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["event", "event fields surface"],
  ["swapped_ascension_perk", "ascension_perk.tradition_swap"],
  ["swapped_civic", "civic_or_origin.swap_type"],
  ["swapped_job", "job.swappable_data.swap_type"],
  ["swapped_technology", "technology.technology_swap"],
  ["swapped_tradition", "tradition.tradition_swap"],
]);

/**
 * The top-level field keys a body declares, sorted: named keys at the top
 * level and inside subtype arms, plus `alias_name[<category>]` for each
 * unkeyed splice. Computed keys are not counted.
 */
export function declaredTopLevelFields(body: ContentBody | undefined): string[] {
  const names = new Set<string>();
  const visit = (fields: readonly RuleField[]): void => {
    for (const field of fields) {
      if (field.key.kind === "name") {
        names.add(field.key.name);
      } else if (field.key.kind === "aliasName") {
        names.add(`alias_name[${field.key.category}]`);
      } else if (field.key.kind === "subtype" && field.type.kind === "block") {
        visit(field.type.fields);
      }
    }
  };
  visit(body?.fields ?? []);
  return [...names].sort(compareUtf8);
}

/** Everything one unexposed type's sites are built from. */
export interface UnexposedTypeInput {
  /** The CWT type name. */
  readonly type: string;
  /** The type's `path`, relative to the game root (`game/` stripped). */
  readonly path: string;
  /** From {@link declaredTopLevelFields}. */
  readonly fields: readonly string[];
  /** Whether `VANILLA_REF_EXTRAS` makes the type referenceable through `vanilla.*`. */
  readonly referenceable: boolean;
  /** Shipped definitions of the type, for the site of a type with no fields. */
  readonly definitions: number;
  /** Top-level field to the number of shipped definitions writing it. */
  readonly usage: ReadonlyMap<string, number>;
}

function classificationOf(input: UnexposedTypeInput): SiteClassification {
  const disposition = UNEXPOSED_TYPE_DISPOSITIONS.get(input.path);
  if (disposition !== undefined) {
    return disposition;
  }
  return {
    class: "gap",
    reason: input.referenceable
      ? "registry not exposed (no manifest row); referenceable through vanilla.* but not authorable"
      : "registry not exposed (no manifest row)",
  };
}

/**
 * One site per declared field, or one site for the type when it declares
 * none, all of one class.
 *
 * A named field weighs the definitions that write it. An
 * `alias_name[<category>]` splice weighs every definition of the type: no
 * definition writes that literal key, and every definition writes at least
 * one key the splice admits.
 *
 * @throws {Error} When the type is in {@link TYPES_COUNTED_ELSEWHERE}.
 */
export function sitesOfUnexposedType(input: UnexposedTypeInput): CoverageSite[] {
  const elsewhere = TYPES_COUNTED_ELSEWHERE.get(input.type);
  if (elsewhere !== undefined) {
    throw new Error(`${input.type} is counted by ${elsewhere}; it is not an unexposed type`);
  }
  const surface: CoverageSurfaceId = `registry:${input.type}`;
  const classification = classificationOf(input);
  if (input.fields.length === 0) {
    return [
      {
        surface,
        key: input.type,
        ...classification,
        reason: `${classification.reason}; the body declares no fields, so the type is the site`,
        used: input.definitions,
      },
    ];
  }
  return [...input.fields].sort(compareUtf8).map((field) => ({
    surface,
    key: field,
    ...classification,
    used: field.startsWith("alias_name[") ? input.definitions : (input.usage.get(field) ?? 0),
  }));
}
