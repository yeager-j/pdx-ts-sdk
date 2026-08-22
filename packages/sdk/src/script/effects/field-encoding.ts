/**
 * The one reader of the generated effect field metadata: it turns an author's
 * argument object into the entries the game reads, and collects the content
 * references those arguments use.
 *
 * The dispatch that calls it lives in `recorder.ts`, and the recording
 * lifecycle in `recording.ts`.
 */

import {
  block,
  cmp,
  container,
  kv,
  scalar as pdxScalar,
  type PdxEntry,
  type PdxItem,
  type PdxOp,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { assertNever } from "../../assert-never.ts";
import { EFFECT_META, type EffectFieldMeta } from "../../generated/effect-meta.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { ContentRefUse } from "../../references.ts";
import { isStructuredValue, toScalar } from "../scalar.ts";
import type { Trigger } from "../trigger-core.ts";
import { modifierEntry } from "./modifiers.ts";
import type { RecordEffects } from "./structural.ts";
import type { Modifier } from "./types.ts";

/**
 * Records an id-valued argument as a content reference when the generated meta
 * says every form the field admits is a `<type>` reference. A field that also
 * admits plain scalars says nothing about any registry and is left alone —
 * the same rule the content field tables follow.
 */
export function recordRef(
  refs: ContentRefUse[],
  targets: readonly string[] | undefined,
  field: string,
  value: string | number | boolean | PdxScalar
): void {
  // A `var` node's `typeof` is `"object"`, so a `@name` scripted-variable
  // reference already falls out of `typeof value === "string"` here — it is
  // never itself a content id, so it is correctly left unrecorded.
  if (targets !== undefined && typeof value === "string") {
    refs.push({ targets, id: value, field });
  }
}

/**
 * Encodes one effect's arguments as PDXScript entries, one generated field
 * meta at a time.
 *
 * @param path - the dotted field path recorded against each reference
 * @param refs - collects the content references the arguments use
 * @param recordEffects - records a nested effect closure into a fresh block
 */
export function fieldEntries(
  fields: readonly EffectFieldMeta[],
  args: Record<string, unknown>,
  path: string,
  refs: ContentRefUse[],
  recordEffects: RecordEffects
): PdxEntry[] {
  const entries: PdxEntry[] = [];
  for (const field of fields) {
    const value = args[field.prop];
    if (value === undefined) {
      continue;
    }
    const values = field.repeated === true ? (value as readonly unknown[]) : [value];
    for (const value of values) {
      switch (field.kind) {
        case "value": {
          const scalar = toScalar(value, field.booleanLiterals);
          recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
          entries.push(kv(field.key, scalar));
          break;
        }
        case "scalar-or-fields":
          if (isStructuredValue(value, field.scalar.objectKinds ?? [])) {
            entries.push(
              block(
                field.key,
                fieldEntries(
                  field.fields,
                  value as Record<string, unknown>,
                  `${path}.${field.key}`,
                  refs,
                  recordEffects
                )
              )
            );
          } else {
            const scalar = toScalar(value, field.scalar.booleanLiterals);
            recordRef(refs, field.scalar.refTypes, `${path}.${field.key}`, scalar);
            entries.push(kv(field.key, scalar));
          }
          break;
        case "fields":
          entries.push(
            block(
              field.key,
              fieldEntries(
                field.fields,
                value as Record<string, unknown>,
                `${path}.${field.key}`,
                refs,
                recordEffects
              )
            )
          );
          break;
        case "value-list": {
          const items: PdxItem[] = [];
          for (const item of value as readonly unknown[]) {
            if (
              field.fields !== undefined &&
              (field.scalar === undefined ||
                isStructuredValue(item, field.scalar.objectKinds ?? []))
            ) {
              items.push(
                container(
                  fieldEntries(
                    field.fields,
                    item as Record<string, unknown>,
                    `${path}.${field.key}`,
                    refs,
                    recordEffects
                  )
                )
              );
              continue;
            }
            const scalar = toScalar(item, field.scalar?.booleanLiterals);
            recordRef(refs, field.scalar?.refTypes, `${path}.${field.key}`, scalar);
            items.push(typeof scalar === "object" ? scalar : pdxScalar(scalar));
          }
          entries.push(kv(field.key, container(items)));
          break;
        }
        case "comparison":
          if (Array.isArray(value)) {
            entries.push(cmp(field.key, value[0] as PdxOp, toScalar(value[1])));
          } else {
            const scalar = toScalar(value, field.booleanLiterals);
            recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
            entries.push(kv(field.key, scalar));
          }
          break;
        case "trigger":
          entries.push(block(field.key, [...(value as Trigger).entries]));
          refs.push(...(value as Trigger).refs);
          break;
        case "effect":
          entries.push(block(field.key, recordEffects(refs, value as (scope: unknown) => void)));
          break;
        case "modifiers":
          entries.push(
            block(
              field.key,
              (value as readonly Modifier<ScopeName>[]).map((modifier) =>
                modifierEntry(modifier, refs)
              )
            )
          );
          break;
        default:
          assertNever(field, "effect field");
      }
    }
  }
  return entries;
}

/**
 * The PDXScript keys the generated effect table knows, by the name they are
 * *written* as — `set_country_flag`, not `setCountryFlag`.
 *
 * Built once, lazily, because the table has a few thousand entries and most
 * builds never ask this question.
 */
let effectKeys: Set<string> | undefined;

/**
 * Is `key` a real game effect the SDK knows how to write?
 *
 * Exists so a consumer can tell "a real effect this tool has not implemented"
 * apart from "not an effect at all" — a distinction that changes what the
 * reader should do about it, and the only thing outside this module has ever
 * wanted from `EFFECT_META`. Narrow on purpose: the meta table is generated
 * output whose shape belongs to codegen, and exporting it would freeze that
 * shape into the public API to answer a yes/no question.
 */
export function isEffectKey(key: string): boolean {
  effectKeys ??= new Set(
    Object.values(EFFECT_META).flatMap((meta) => (meta === undefined ? [] : [meta.key]))
  );
  return effectKeys.has(key);
}
