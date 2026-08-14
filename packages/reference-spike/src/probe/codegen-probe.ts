/**
 * The spike's one deliberate information-hiding violation.
 *
 * This module — and only this module — imports CWT Codegen internals. It runs
 * the same lowering `npm run codegen` runs, over the same vendored rules, and
 * refines the result into the immutable, spike-owned {@link RegistryFacts}
 * before returning. Nothing else in the spike may import `@pdx-ts/codegen-cwt`;
 * `tests/quarantine.test.ts` fails if anything does, and fails again if any
 * production package imports the spike.
 *
 * It is a violation and not a design. A production Authoring Reference gets a
 * producer-owned contribution emitted by CWT Codegen itself, on that context's
 * terms, reviewed alongside the facts it projects. What this proves is only
 * that the facts a reference page needs are derivable from the real
 * post-overlay model — not that reaching in is an acceptable way to get them.
 * The probe is never copied into that work.
 *
 * The refinement is immediate on purpose: no codegen type escapes this file, so
 * the blast radius of the violation is one module and one function signature.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleField, RuleType } from "@pdx-ts/codegen-cwt/cwt/model";
import { loadRules, type ContentBody, type ContentType } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitContentType, type ContentEmission } from "@pdx-ts/codegen-cwt/emit/content-type";
import type { EmittedField } from "@pdx-ts/codegen-cwt/emit/fields";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";

import type {
  DeclaredArm,
  DeclaredKey,
  FactScope,
  LocalisationSlot,
  LoweredMember,
  PartialLowering,
  RegistryFacts,
  Subtype,
} from "../facts.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");

/**
 * The CWT spelling of a rule type, for a reader who will eventually look at the
 * `.cwt` file the provenance names.
 *
 * A block is rendered as `block` rather than expanded: the expansion of
 * `single_alias_right[trigger_clause]` is every trigger the game has, which is
 * a different page.
 */
function renderType(type: RuleType): string {
  switch (type.kind) {
    case "bool":
      return "bool";
    case "int":
    case "float":
      return type.range === null
        ? type.kind
        : `${type.kind}[${type.range.min ?? "-inf"}..${type.range.max ?? "inf"}]`;
    case "scalar":
      return "scalar";
    case "localisation":
      return "localisation";
    case "valueField":
      return type.integer ? "int_value_field" : "value_field";
    case "enum":
      return `enum[${type.name}]`;
    case "typeRef":
      return `<${type.name}>`;
    case "valueSet":
      return `value[${type.name}]`;
    case "scope":
      return `scope[${type.name}]`;
    case "scopeGroup":
      return `scope_group[${type.name}]`;
    case "filepath":
      return type.path === null ? "filepath" : `filepath[${type.path}]`;
    case "icon":
      return `icon[${type.path}]`;
    case "colour":
      return `colour[${type.format}]`;
    case "aliasMatchLeft":
      return `alias_match_left[${type.category}]`;
    case "singleAliasRight":
      return `single_alias_right[${type.name}]`;
    case "block":
      return type.via === undefined ? "block" : `single_alias_right[${type.via}]`;
    case "unknownKeyword":
      return type.text;
    case "literal":
      return type.text;
  }
}

function armOf(field: RuleField): DeclaredArm {
  return {
    line: field.line,
    cardinality: { min: field.cardinality.min, max: field.cardinality.max },
    declaredType: renderType(field.type),
    docs: field.docs,
  };
}

/**
 * The container a keyed collection declares its entries with:
 * `stages = { scalar = { icon = ... } }` says "any scalar key maps to this
 * block". The keys inside that inner block are the stage's fields, so the walk
 * has to step through the wildcard rather than record a field literally named
 * `scalar`.
 */
function wildcardEntry(type: RuleType): RuleType | null {
  if (type.kind !== "block") {
    return null;
  }
  const wildcards = type.fields.filter(
    (field) => field.key.kind === "computed" && field.type.kind === "block"
  );
  return wildcards.length === 1 ? wildcards[0]!.type : null;
}

interface Walked {
  readonly declared: readonly DeclaredKey[];
  readonly subtypes: ReadonlyMap<string, { gated: string[]; excluded: string[] }>;
  readonly splices: readonly string[];
}

/**
 * Collects the rule body's declared keys at their dotted paths.
 *
 * Two rules bound the descent, both of them there so the walk describes the
 * registry rather than the whole rule graph. It steps into a block only where
 * the emission lowered members underneath it — `stages`, `approach`, `title` —
 * which keeps declared and lowered describing the same tree. And it never steps
 * into a block that expanded from a `single_alias`, because that block's
 * contents belong to the alias category: descending into `modifier_rule` here
 * would report a weight modifier's `potential` as a situation field.
 */
function walkBody(body: ContentBody, nestedPaths: ReadonlySet<string>): Walked {
  const byPath = new Map<string, { subtype: string | null; arms: DeclaredArm[] }>();
  const subtypes = new Map<string, { gated: string[]; excluded: string[] }>();
  const splices: string[] = [];

  const descendable = (prefix: string): boolean => {
    for (const nested of nestedPaths) {
      if (nested.startsWith(`${prefix}.`)) {
        return true;
      }
    }
    return false;
  };

  const visit = (fields: readonly RuleField[], prefix: string, subtype: string | null): void => {
    for (const field of fields) {
      if (field.key.kind === "subtype") {
        const name = field.key.name;
        const record = subtypes.get(name) ?? { gated: [], excluded: [] };
        subtypes.set(name, record);
        if (field.type.kind === "block") {
          for (const inner of field.type.fields) {
            if (inner.key.kind === "name") {
              (field.key.negated ? record.excluded : record.gated).push(
                prefix === "" ? inner.key.name : `${prefix}${inner.key.name}`
              );
            }
          }
          visit(field.type.fields, prefix, field.key.negated ? `not ${name}` : name);
        }
        continue;
      }
      if (field.key.kind === "aliasName") {
        splices.push(field.key.category);
        continue;
      }
      if (field.key.kind !== "name") {
        continue;
      }
      const key = `${prefix}${field.key.name}`;
      const existing = byPath.get(key);
      if (existing === undefined) {
        byPath.set(key, { subtype, arms: [armOf(field)] });
      } else {
        existing.arms.push(armOf(field));
      }
      if (field.type.kind !== "block" || field.type.via !== undefined || !descendable(key)) {
        continue;
      }
      const entry = wildcardEntry(field.type);
      visit(
        entry !== null && entry.kind === "block" ? entry.fields : field.type.fields,
        `${key}.`,
        subtype
      );
    }
  };

  visit(body.fields, "", null);
  return {
    declared: [...byPath]
      .map(([key, value]) => ({ key, subtype: value.subtype, arms: value.arms }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    subtypes,
    splices: [...new Set(splices)].sort(),
  };
}

function scopeOf(field: EmittedField): FactScope {
  const scope = field.scope;
  if (scope === undefined) {
    return null;
  }
  if (scope === "any" || Array.isArray(scope)) {
    return scope as FactScope;
  }
  return { parameter: (scope as { parameter: readonly string[] }).parameter };
}

function loweredOf(
  emission: ContentEmission,
  registry: string,
  declaredKeys: ReadonlySet<string>
): LoweredMember[] {
  const refine = (field: EmittedField, level: "top" | "nested"): LoweredMember => {
    const key = level === "top" ? field.field : field.field.slice(registry.length + 1);
    return {
      key,
      memberPath: field.authoredPath ?? [key],
      shape: field.shape,
      repeated: field.repeated,
      wrapped: field.wrapped === true,
      literals: field.literals === undefined ? null : [...field.literals],
      scope: scopeOf(field),
      clause: field.clause ?? null,
      level,
      declaredIn: declaredKeys.has(key) ? "body" : "alias-clause",
    };
  };
  return [
    ...emission.emittedFields.map((field) => refine(field, "top")),
    ...emission.nestedEmittedFields.map((field) => refine(field, "nested")),
  ];
}

/** Shapes whose lowered member writes a scalar rather than a block. */
const SCALAR_SHAPES = new Set(["value", "valueList"]);

/** Whether a declaration's right-hand side is a block, in either CWT spelling. */
function isBlockArm(arm: DeclaredArm): boolean {
  return arm.declaredType === "block" || arm.declaredType.startsWith("single_alias_right[");
}

/**
 * Keys the rules declare more than once where the surface kept fewer arms.
 *
 * The derivation is the point. `picture` is a Known omission in this repo's
 * committed evidence, and `stages.color`'s dropped arm is why the field's own
 * documentation promises a form its type refuses — but neither is asserted
 * here. Both fall out of comparing the arms the rules declare against the
 * single member the surface lowered, so a page built from this stops making
 * either claim the moment somebody fixes the lowering.
 *
 * Two ways of keeping every arm are excluded, because neither drops anything.
 * A `dual` carries a scalar arm and a block arm in one member. A key declared
 * once per literal (`progress_direction = monodirectional`, then `=
 * bidirectional`) folds into the member's closed value set.
 */
function partialLowerings(
  declared: readonly DeclaredKey[],
  lowered: readonly LoweredMember[]
): PartialLowering[] {
  const byKey = new Map(lowered.map((member) => [member.key, member]));
  const rows: PartialLowering[] = [];
  for (const entry of declared) {
    const member = byKey.get(entry.key);
    if (entry.arms.length < 2 || member === undefined || member.shape === "dual") {
      continue;
    }
    const literals = new Set(member.literals ?? []);
    if (entry.arms.every((arm) => literals.has(arm.declaredType))) {
      continue;
    }
    const keepsBlock = !SCALAR_SHAPES.has(member.shape);
    const kept = entry.arms.filter((arm) => isBlockArm(arm) === keepsBlock);
    const dropped = entry.arms.filter((arm) => isBlockArm(arm) !== keepsBlock);
    if (dropped.length === 0) {
      continue;
    }
    rows.push({
      key: entry.key,
      droppedArms: dropped.map((arm) => arm.declaredType),
      keptArm: kept[0]?.declaredType ?? member.shape,
      loweredShape: member.shape,
    });
  }
  return rows;
}

/**
 * The registry's keyed collections, and which of the two layouts each writes.
 *
 * Both halves come off the emission. A siblings-keyed struct is the one the
 * emitter marks as repeating at the sibling level, because that is literally
 * what it does; a container-keyed one holds its entries inside a single block.
 * The identity field is then whichever key the rules declare inside the struct
 * that lowered to no member — for a siblings-keyed struct the record key is
 * written into that field, so there is nothing left for an author to set.
 */
function repeatedStructs(
  declared: readonly DeclaredKey[],
  lowered: readonly LoweredMember[]
): { key: string; keying: "container" | "siblings"; identityKey: string | null }[] {
  const loweredKeys = new Set(lowered.map((member) => member.key));
  return lowered
    .filter((member) => member.shape === "repeatedStruct")
    .map((member) => {
      const children = declared.filter((entry) => entry.key.startsWith(`${member.key}.`));
      const identity = children.find((entry) => !loweredKeys.has(entry.key));
      return {
        key: member.key,
        keying: member.repeated ? ("siblings" as const) : ("container" as const),
        identityKey: identity === undefined ? null : identity.key.slice(member.key.length + 1),
      };
    });
}

function localisationOf(type: ContentType, emission: ContentEmission): LocalisationSlot[] {
  const excluded = new Set(
    emission.localisationAliases.map((line) => line.slice(0, line.indexOf(" ")))
  );
  const slots: LocalisationSlot[] = type.localisation
    .filter((slot) => slot.pattern.includes("$"))
    .filter((slot) => !excluded.has(`${type.name}.localisation.${slot.key}`))
    .map((slot) => ({
      member: slot.key,
      pattern: slot.pattern,
      required: slot.required,
      owner: type.name,
    }));
  // The two repeated structs carry the `$` / `$_desc` identity convention the
  // emitter falls back to where CWT declares no `type[...]` for the struct. It
  // is read off the emission rather than restated: a struct whose localisation
  // the emitter stopped emitting stops appearing here.
  //
  // The two names are still written out, and the second page is why they stay
  // that way. Deriving them from `repeatedStructs` produces the same pair in
  // the other order, and the Situation page renders that order inside a
  // sentence — so the generic version would have rewritten a shipped page to
  // say the same thing differently. The list is inert for a registry with no
  // keyed collections, which is every registry but this one so far.
  for (const member of ["stages", "approach"]) {
    const owner = emission.nestedEmittedFields.some((field) =>
      field.field.startsWith(`${type.name}.${member}.`)
    );
    if (!owner) {
      continue;
    }
    slots.push(
      { member: "name", pattern: "$", required: true, owner: member },
      { member: "desc", pattern: "$_desc", required: false, owner: member }
    );
  }
  return slots;
}

/**
 * Runs the real lowering and returns the spike's view of it.
 *
 * Deterministic and hermetic: the vendored rules under `vendor/` are the only
 * input, and the same commit produces the same value.
 *
 * The registry is a required argument rather than a defaulted one. A default
 * would be one page's name living in the module every page's facts come
 * through, which is exactly the coupling that made adding a second page a
 * refactor.
 */
export function probeRegistryFacts(registry: string): RegistryFacts {
  const rules = loadRules(CONFIG);
  const type = rules.contentTypes.get(registry);
  const body = rules.bodies.get(registry);
  if (type === undefined || body === undefined) {
    throw new Error(
      `the vendored rules no longer declare type[${registry}] and its body, so the spike has ` +
        "nothing to project — regenerate against the rules the SDK is actually built from"
    );
  }

  const emitter = new Emitter(rules);
  emitter.beginFile();
  const emission = emitContentType(emitter, type, body, registry);
  emitter.endFile();

  const nestedPaths = new Set(
    emission.nestedEmittedFields.map((field) => field.field.slice(registry.length + 1))
  );
  const walked = walkBody(body, nestedPaths);
  const declaredKeys = new Set(walked.declared.map((entry) => entry.key));
  const lowered = loweredOf(emission, registry, declaredKeys);

  const unique = (keys: readonly string[] | undefined): string[] => [...new Set(keys ?? [])].sort();
  const subtypes: Subtype[] = type.subtypes.map((subtype) => ({
    name: subtype.name,
    gatedKeys: unique(walked.subtypes.get(subtype.name)?.gated),
    excludedKeys: unique(walked.subtypes.get(subtype.name)?.excluded),
    absentUnless: subtype.absentUnless,
  }));

  return {
    registry,
    typeName: emission.typeName,
    definitionPath: type.path ?? "",
    subtypes,
    declared: walked.declared,
    lowered,
    repeatedStructs: repeatedStructs(walked.declared, lowered),
    partialLowerings: partialLowerings(walked.declared, lowered),
    localisation: localisationOf(type, emission),
    localisationExclusions: emission.localisationAliases,
    localisationRenames: emission.localisationRenames,
    declined: emission.declinedFields,
    unsupported: emission.unsupported,
    inlineSplices: emission.inlineSplices,
    patchLocalisation: emission.patchLocMembers,
    patchWidenings: emission.patchWidenings,
    patchExclusions: emission.patchExclusions,
  };
}
