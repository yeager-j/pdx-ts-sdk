/**
 * Transform-style patching over a parsed definition, driven entirely by the
 * registry's generated field descriptors.
 *
 * A patch member is lowered by the same `fieldEntries` machinery a `defineX`
 * uses — closures, dual-arm dispatch, reference collection and quoting all
 * come from there — so the only original job left here is the splice: a
 * patched field keeps its slot, because emission walks the parsed body and
 * substitutes in place, appending only genuinely new keys. That is what keeps
 * "always emit complete objects" true for everything the surface does not
 * model.
 *
 * Nothing in this module knows a registry. Which members exist, what they
 * accept, and which key each writes are all read off the descriptor the
 * generated `patchX` hands in.
 *
 * Two input forms exist here that no `defineX` has, both of them ways to carry
 * a shipped definition's own data back out unchanged:
 *
 * - a {@link ParsedNumber} passed through whole re-emits as `@name`, not as a
 *   bare string — the package serializer's symmetric quoting rule would
 *   quote-promote `"@t3cost"` into a string the game cannot resolve;
 * - a passthrough (a parsed occurrence taken from the source body, or an
 *   {@link AnyOf} group) is emitted verbatim rather than re-lowered.
 */

import { container, quoted, scalar, type PdxEntry, type PdxItem } from "@pdx-ts/pdxscript";

import { fieldEntries } from "../../content/lower.ts";
import type { ContentField } from "../../content/schema.ts";
import { refId } from "../../generated/refs.ts";
import type { ContentRefUse } from "../../references.ts";
import type { AnyOf, ParsedNumber } from "./view.ts";

/**
 * What the transform needs from a parsed definition: its key and the body it
 * re-emits around the patched members. The registry-specific parsed class
 * (`ParsedTechnology`) satisfies it and carries the rest.
 */
export interface ParsedDefinition {
  readonly id: string;
  /** The full parsed body, in file order — the source of truth for emission. */
  readonly body: readonly PdxEntry[];
}

/**
 * A parsed occurrence carried into a patched member unchanged.
 *
 * It is already a PDXScript node, so it is spliced rather than lowered: the
 * shipped definition's own blocks survive a patched member that keeps some of
 * them and replaces others.
 */
export type Passthrough = PdxItem;

/**
 * One patch member's admitted inputs, derived from the same type the
 * definition's own member has.
 *
 * A list-shaped member additionally admits passthrough elements and, where
 * {@link PATCH_WIDENINGS} declares one, an `Extra` element form. A member that
 * admits a number additionally admits the parsed form of one, so `t.cost`
 * flows back in with its `@variable` provenance intact.
 */
export type PatchInput<T, Extra = never> =
  | (T extends readonly (infer Element)[] ? readonly (Element | Extra | Passthrough)[] : T)
  | (number extends T ? ParsedNumber : never);

export interface PatchedContent<Source extends ParsedDefinition = ParsedDefinition> {
  readonly id: string;
  /** The vanilla definition this patch transforms — provenance for the win engine. */
  readonly source: Source;
  /**
   * The content references the patched fields write, for `buildMod`'s
   * dangling-reference guard. A patch is the other way a definition of this
   * mod's own gets named — appending an own technology to a vanilla tech's
   * prerequisites is the calibration anchor itself — so the ids it writes have
   * to resolve on the same terms a `define`'s do.
   */
  readonly refs: readonly ContentRefUse[];
  toEntries(): PdxEntry;
}

/** A vanilla patch placed into a capability feature. */
export interface ContentPatchItem<Source extends ParsedDefinition = ParsedDefinition> {
  readonly itemKind: "patch";
  readonly patched: PatchedContent<Source>;
}

function isParsedNumber(value: unknown): value is ParsedNumber {
  return (
    typeof value === "object" &&
    value !== null &&
    !("kind" in value) &&
    !("id" in value) &&
    typeof (value as { readonly value?: unknown }).value === "number"
  );
}

function isAnyOf(value: unknown): value is AnyOf<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === "any-of"
  );
}

/**
 * A `ParsedNumber` as an ordinary authored scalar: its `@variable` name when it
 * came from one, and the resolved number otherwise. `contentScalar` turns the
 * `@`-prefixed string back into a bare variable reference, so the provenance
 * survives without this module knowing how a scalar is written.
 */
function parsedScalar(value: ParsedNumber): string | number {
  return value.ref ?? value.value;
}

/** Whether a list-shaped field quotes its items, looking through a dual. */
function quotesItems(field: ContentField): boolean {
  if (field.shape === "valueList") {
    return field.quoted ?? false;
  }
  if (field.shape === "dual") {
    return field.arms.some(quotesItems);
  }
  return false;
}

/**
 * An alternation group as the game writes it: `OR = { a b }` inside the list.
 *
 * It is a whole entry rather than a scalar, which no authoring member's
 * element type can be, so it enters the lowering as a passthrough.
 */
function anyOfEntry(group: AnyOf<unknown>, quote: boolean): PdxEntry {
  const options = group.options.map((option) => {
    const id = String(refId(option as string));
    return quote ? quoted(id) : scalar(id);
  });
  return { kind: "entry", key: "OR", op: "=", value: container(options) };
}

/**
 * The patch-only input forms, rewritten into what `fieldEntries` already
 * understands. Everything else is handed to the define path untouched.
 */
function lowerable(value: unknown, field: ContentField): unknown {
  if (isParsedNumber(value)) {
    return parsedScalar(value);
  }
  if (!Array.isArray(value)) {
    return value;
  }
  const quote = quotesItems(field);
  return (value as readonly unknown[]).map((item) => {
    if (isParsedNumber(item)) {
      return parsedScalar(item);
    }
    return isAnyOf(item) ? anyOfEntry(item, quote) : item;
  });
}

/**
 * Refuses a patched member carrying display text the patch path cannot mint a
 * localisation key for.
 *
 * `defineX` registers a desc-bearing modifier row's key in a `ContentAuthoring`
 * pre-pass that sees the whole definition; a patch runs no such pass, and the
 * prefix-derived minting rule for patched definitions is not in yet. Dropping
 * the text or inventing an unstable key would both be worse than saying so.
 */
function assertNoLocalisation(value: unknown, field: ContentField, member: string): void {
  switch (field.shape) {
    case "weightBlock":
    case "weightBlockWithLoc": {
      const rows =
        (value as { readonly modifiers?: readonly { desc?: unknown }[] }).modifiers ?? [];
      if (rows.some((row) => row.desc !== undefined)) {
        throw new Error(
          `The patched "${member}" has a modifier row with a desc, which needs a localisation ` +
            "key minted for it, and a patch has nowhere yet to register one: desc'd modifier " +
            "rows in patches arrive with the patch-localization change. Patch the field without " +
            "desc, or define your own content instead of patching."
        );
      }
      return;
    }
    case "repeatedStruct":
      if (field.localisation.length > 0) {
        throw new Error(
          `The patched "${member}" is a nested definition whose ids carry localisation, and a ` +
            "patch has nowhere yet to register one: patched localization arrives with the " +
            "patch-localization change."
        );
      }
      return;
    case "dual":
      for (const arm of field.arms) {
        assertNoLocalisation(value, arm, member);
      }
      return;
    default:
      return;
  }
}

/**
 * The PDXScript key a field writes, or undefined when the field has none — an
 * unkeyed splice (`inlineModifiers`) has no slot in the body to substitute, so
 * it is not patchable. The generated patch type leaves those members out; this
 * is the runtime half of the same fact.
 */
function keyOf(field: ContentField): string | undefined {
  return "key" in field ? field.key : undefined;
}

/**
 * Refuses a patch object carrying a member the transform would not emit.
 *
 * The lowering iterates descriptors, not the patch object, so an unknown key
 * would otherwise be dropped in silence — and the compiler does not catch it:
 * TypeScript performs no excess-property check on an object literal returned
 * from an inferred-return arrow, which is the shape every patch callback has.
 * A member the SDK cannot lower has to fail loudly rather than emit nothing.
 */
function assertPatchable(
  patched: Readonly<Record<string, unknown>>,
  source: ParsedDefinition,
  registry: string,
  patchable: ReadonlyMap<string, ContentField>
): void {
  for (const member of Object.keys(patched)) {
    if (member === "id") {
      throw new Error(
        `A patch of ${registry} "${source.id}" may not set "id": a patched definition keeps ` +
          "vanilla's identity, because the override has to target the vanilla key to win, and " +
          "the transform already emits under it. Remove the member; to add content of your " +
          "own, define it instead of patching."
      );
    }
    if (patchable.has(member)) {
      continue;
    }
    const near = [...patchable.keys()]
      .filter((name) => name.toLowerCase().includes(member.toLowerCase().slice(0, 4)))
      .slice(0, 5);
    const hint = near.length > 0 ? ` (did you mean: ${near.join(", ")}?)` : "";
    throw new Error(
      `A patch of ${registry} "${source.id}" sets "${member}", which is not a patchable ` +
        `${registry} member, so it would emit nothing${hint}`
    );
  }
}

/**
 * Lowers the patched members and splices them into the parsed body.
 *
 * Every occurrence of a patched key is replaced by that member's new entries,
 * at the position of the first occurrence; a key the body does not have is
 * appended. Unpatched entries ride through untouched.
 */
export function patchContent<Source extends ParsedDefinition, Patch extends object>(
  source: Source,
  patch: (source: Source) => Patch,
  registry: string,
  fields: readonly ContentField[]
): PatchedContent<Source> {
  const patched = patch(source) as Readonly<Record<string, unknown>>;
  const patchable = new Map(
    fields.flatMap((field) => (keyOf(field) === undefined ? [] : [[field.member, field] as const]))
  );
  assertPatchable(patched, source, registry, patchable);
  const refs: ContentRefUse[] = [];
  const ctx = {
    collect: (use: ContentRefUse) => refs.push(use),
    path: "",
    ownerId: source.id,
  };
  const replacements = new Map<string, PdxEntry[]>();
  for (const field of fields) {
    const value = patched[field.member];
    if (value === undefined) {
      continue;
    }
    const key = keyOf(field);
    if (key === undefined) {
      continue;
    }
    assertNoLocalisation(value, field, field.member);
    const entries = fieldEntries({ [field.member]: lowerable(value, field) }, [field], ctx);
    replacements.set(key, [...(replacements.get(key) ?? []), ...entries]);
  }

  return {
    id: source.id,
    source,
    refs,
    toEntries(): PdxEntry {
      const body: PdxEntry[] = [];
      const substituted = new Set<string>();
      for (const entry of source.body) {
        const entries = replacements.get(entry.key);
        if (entries !== undefined) {
          if (!substituted.has(entry.key)) {
            substituted.add(entry.key);
            body.push(...entries);
          }
          continue;
        }
        body.push(entry);
      }
      for (const [key, entries] of replacements) {
        if (!substituted.has(key)) {
          body.push(...entries);
        }
      }
      return { kind: "entry", key: source.id, op: "=", value: container(body) };
    },
  };
}
