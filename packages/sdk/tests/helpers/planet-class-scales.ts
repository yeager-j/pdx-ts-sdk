/**
 * Test-only reader for the install's per-class render scales: `entity_scale`
 * and `fixed_entity_scale` from `common/planet_classes`, with scripted
 * variables resolved. The calibration suite compares this against the baked
 * table in `src/solar-system-inspect/class-scales.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, tryNumberValue, type PdxValue } from "@pdx-ts/pdxscript";

/** The install's per-class scales and fixed-scale class set. */
export interface VanillaClassScales {
  readonly scales: ReadonlyMap<string, number>;
  readonly fixed: ReadonlySet<string>;
}

function scalarNumber(value: PdxValue, variables: ReadonlyMap<string, number>): number | undefined {
  if (value.kind === "num") {
    return tryNumberValue(value.lexeme) ?? undefined;
  }
  if (value.kind === "var") {
    return variables.get(value.name);
  }
  return undefined;
}

/** Reads every planet class's entity scale from the installed game. */
export function readVanillaClassScales(installPath: string): VanillaClassScales {
  const variables = new Map<string, number>();
  const variableDirs = ["common/scripted_variables", "common/planet_classes"];
  for (const dir of variableDirs) {
    for (const file of readdirSync(join(installPath, dir)).filter((name) =>
      name.endsWith(".txt")
    )) {
      const document = parse(readFileSync(join(installPath, dir, file), "utf8"), file);
      for (const item of document.items) {
        if (item.kind === "entry" && item.key.startsWith("@") && item.value.kind === "num") {
          const parsed = tryNumberValue(item.value.lexeme);
          if (parsed !== null) {
            // A `var` scalar's name keeps its `@`, so the key is stored as is.
            variables.set(item.key, parsed);
          }
        }
      }
    }
  }

  const scales = new Map<string, number>();
  const fixed = new Set<string>();
  const dir = join(installPath, "common", "planet_classes");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".txt"))) {
    const document = parse(readFileSync(join(dir, file), "utf8"), file);
    for (const item of document.items) {
      if (item.kind !== "entry" || item.value.kind !== "container" || item.key.startsWith("@")) {
        continue;
      }
      for (const field of item.value.items) {
        if (field.kind !== "entry") {
          continue;
        }
        if (field.key === "entity_scale") {
          const scale = scalarNumber(field.value, variables);
          if (scale !== undefined) {
            scales.set(item.key, scale);
          }
        }
        if (
          field.key === "fixed_entity_scale" &&
          field.value.kind === "bool" &&
          field.value.value
        ) {
          fixed.add(item.key);
        }
      }
    }
  }
  return { scales, fixed };
}
