/**
 * One minimal specimen per branch of the two generated protocols the SDK
 * interprets: every `ContentShape` the content lowerer writes, and every
 * effect field kind and effect shape kind the recorder writes.
 *
 * The tables are `satisfies Record<...>` over the generated vocabularies, so a
 * kind added by codegen fails this file's typecheck until it has a specimen —
 * the type-level half of the `assertNever` guards in the interpreters
 * themselves.
 */

import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { fieldEntries } from "../src/content/lower.ts";
import { registerAliasStructFields, type ContentField } from "../src/content/schema.ts";
import type { ModifierClosure } from "../src/content/types.ts";
import type { ContentShape } from "../src/generated/content-shape.ts";
import {
  EFFECT_META,
  type EffectFieldKind,
  type EffectFieldMeta,
  type EffectShapeMeta,
} from "../src/generated/effect-meta.ts";
import type { ScopeObjOf } from "../src/generated/effects.ts";
import { always } from "../src/generated/triggers.ts";
import { makeScope, scopeValue } from "../src/script/effects/recorder.ts";
import { hasOwner } from "../src/script/triggers.ts";

/** One authored value for one content field, and the PDXScript it writes. */
interface ContentSpecimen {
  readonly field: ContentField;
  readonly def: Readonly<Record<string, unknown>>;
  readonly expected: string;
}

const CONTENT_CTX = { path: "", ownerId: "protocol_matrix" };

const ALIAS_CATEGORY = "protocol_matrix_alias";

registerAliasStructFields(ALIAS_CATEGORY, [
  { key: "text", member: "text", shape: "value", form: "scalar", conversion: "identity" },
]);

const unityModifier: ModifierClosure<"country"> = (m) => m.country.unity.produces.mult(0.1);

const CONTENT_SPECIMENS = {
  value: {
    field: { key: "tier", member: "tier", shape: "value", form: "scalar", conversion: "identity" },
    def: { tier: 2 },
    expected: "tier = 2\n",
  },
  valueList: {
    field: {
      key: "prerequisites",
      member: "prerequisites",
      shape: "valueList",
      form: "list",
      conversion: "ref",
    },
    def: { prerequisites: ["tech_alpha", "tech_beta"] },
    expected: "prerequisites = { tech_alpha tech_beta }\n",
  },
  trigger: {
    field: { key: "potential", member: "potential", shape: "trigger", form: "trigger" },
    def: { potential: always() },
    expected: "potential = {\n\talways = yes\n}\n",
  },
  effect: {
    field: { key: "effect", member: "effect", shape: "effect", form: "closure" },
    def: {
      effect: (scope: ScopeObjOf<"country">) => {
        scope.log("protocol_matrix");
      },
    },
    expected: "effect = {\n\tlog = protocol_matrix\n}\n",
  },
  economicResources: {
    field: { key: "resources", member: "resources", shape: "economicResources", form: "block" },
    def: { resources: { cost: { amounts: { energy: 100 } } } },
    expected: "resources = {\n\tcost = {\n\t\tenergy = 100\n\t}\n}\n",
  },
  economicResourcesNoProduce: {
    field: {
      key: "resources",
      member: "resources",
      shape: "economicResourcesNoProduce",
      form: "block",
    },
    def: { resources: { upkeep: { amounts: { energy: 5 } } } },
    expected: "resources = {\n\tupkeep = {\n\t\tenergy = 5\n\t}\n}\n",
  },
  economicResourceOperation: {
    field: { key: "cost", member: "cost", shape: "economicResourceOperation", form: "block" },
    def: { cost: { amounts: { alloys: 20 } } },
    expected: "cost = {\n\talloys = 20\n}\n",
  },
  triggeredModifierBlock: {
    field: {
      key: "triggered_modifier",
      member: "triggeredModifier",
      shape: "triggeredModifierBlock",
      form: "block",
    },
    def: { triggeredModifier: { key: "protocol_matrix_row", modifier: unityModifier } },
    expected:
      "triggered_modifier = {\n\tkey = protocol_matrix_row\n\tmodifier = {\n" +
      "\t\tcountry_unity_produces_mult = 0.1\n\t}\n}\n",
  },
  modifierBlock: {
    field: { key: "modifier", member: "modifier", shape: "modifierBlock", form: "closure" },
    def: { modifier: unityModifier },
    expected: "modifier = {\n\tcountry_unity_produces_mult = 0.1\n}\n",
  },
  inlineModifiers: {
    field: { member: "modifiers", shape: "inlineModifiers" },
    def: { modifiers: unityModifier },
    expected: "country_unity_produces_mult = 0.1\n",
  },
  inlineTrigger: {
    field: { member: "when", shape: "inlineTrigger" },
    def: { when: always() },
    expected: "always = yes\n",
  },
  weightBlock: {
    field: { key: "weight", member: "weight", shape: "weightBlock", form: "block" },
    def: { weight: { base: 10 } },
    expected: "weight = {\n\tbase = 10\n}\n",
  },
  weightBlockWithLoc: {
    field: { key: "weight", member: "weight", shape: "weightBlockWithLoc", form: "block" },
    def: { weight: { base: 10 } },
    expected: "weight = {\n\tbase = 10\n}\n",
  },
  dual: {
    field: {
      key: "picture",
      member: "picture",
      shape: "dual",
      arms: [
        {
          key: "picture",
          member: "picture",
          shape: "value",
          form: "scalar",
          conversion: "identity",
        },
        {
          key: "picture",
          member: "picture",
          shape: "struct",
          form: "block",
          fields: [
            {
              key: "picture",
              member: "picture",
              shape: "value",
              form: "scalar",
              conversion: "identity",
            },
          ],
        },
      ],
    },
    def: { picture: { picture: "GFX_protocol_matrix" } },
    expected: "picture = {\n\tpicture = GFX_protocol_matrix\n}\n",
  },
  weightedEvents: {
    field: {
      key: "random_events",
      member: "randomEvents",
      shape: "weightedEvents",
      form: "list",
      conversion: "identity",
    },
    def: { randomEvents: [{ weight: 100, event: "protocol_matrix.1" }, { weight: 20 }] },
    expected: "random_events = {\n\t100 = protocol_matrix.1\n\t20 = 0\n}\n",
  },
  struct: {
    field: {
      key: "stage",
      member: "stage",
      shape: "struct",
      form: "block",
      fields: [
        {
          key: "duration",
          member: "duration",
          shape: "value",
          form: "scalar",
          conversion: "identity",
        },
      ],
    },
    def: { stage: { duration: 30 } },
    expected: "stage = {\n\tduration = 30\n}\n",
  },
  triggerStruct: {
    field: {
      key: "custom_tooltip",
      member: "customTooltip",
      shape: "triggerStruct",
      form: "block",
      fields: [
        { key: "text", member: "text", shape: "value", form: "scalar", conversion: "identity" },
        { member: "when", shape: "inlineTrigger" },
      ],
    },
    def: { customTooltip: { text: "protocol_matrix_tooltip", when: always() } },
    expected: "custom_tooltip = {\n\ttext = protocol_matrix_tooltip\n\talways = yes\n}\n",
  },
  aliasStruct: {
    field: {
      key: "potential",
      member: "potential",
      shape: "aliasStruct",
      form: "block",
      category: ALIAS_CATEGORY,
    },
    def: { potential: { text: "protocol_matrix_clause" } },
    expected: "potential = {\n\ttext = protocol_matrix_clause\n}\n",
  },
  structMap: {
    field: {
      key: "section_slots",
      member: "sectionSlots",
      shape: "structMap",
      form: "block",
      fields: [
        {
          key: "locator",
          member: "locator",
          shape: "value",
          form: "scalar",
          conversion: "identity",
        },
      ],
    },
    def: { sectionSlots: { mid: { locator: "part1" } } },
    expected: "section_slots = {\n\tmid = {\n\t\tlocator = part1\n\t}\n}\n",
  },
  scalarMap: {
    field: {
      key: "min_upgrade_cost",
      member: "minUpgradeCost",
      shape: "scalarMap",
      form: "block",
    },
    def: { minUpgradeCost: { alloys: 20 } },
    expected: "min_upgrade_cost = {\n\talloys = 20\n}\n",
  },
  repeatedStruct: {
    field: {
      key: "stages",
      member: "stages",
      shape: "repeatedStruct",
      form: "block",
      keying: "container",
      localisation: [],
      fields: [
        {
          key: "duration",
          member: "duration",
          shape: "value",
          form: "scalar",
          conversion: "identity",
        },
      ],
    },
    def: { stages: { protocol_matrix_stage: { duration: 30 } } },
    expected: "stages = {\n\tprotocol_matrix_stage = {\n\t\tduration = 30\n\t}\n}\n",
  },
} satisfies Record<ContentShape, ContentSpecimen>;

describe("the content lowering protocol", () => {
  it.each(Object.entries(CONTENT_SPECIMENS))("writes a %s field", (shape, specimen) => {
    expect(specimen.field.shape).toBe(shape);
    expect(serialize(fieldEntries(specimen.def, [specimen.field], CONTENT_CTX))).toBe(
      specimen.expected
    );
  });
});

/** One call on a generated effect method, and the PDXScript it writes. */
interface EffectSpecimen {
  /** The `EFFECT_META` key whose metadata the call exercises. */
  readonly method: string;
  readonly record: (sink: PdxEntry[]) => void;
  readonly expected: string;
}

/**
 * Field kinds the emitter can produce and the current rules never do, so no
 * real effect method can stand as their specimen. The test below asserts the
 * table still has no row of these kinds: the day codegen emits one, it fails
 * and asks for the specimen instead of leaving the recorder branch unmeasured.
 */
const UNUSED_FIELD_KINDS = ["comparison"] as const;

type UsedFieldKind = Exclude<EffectFieldKind, (typeof UNUSED_FIELD_KINDS)[number]>;

const EFFECT_FIELD_SPECIMENS = {
  value: {
    method: "spawnPlanet",
    record: (sink) => makeScope<"system">(sink).spawnPlanet({ class: "pc_continental" }),
    expected: "spawn_planet = {\n\tclass = pc_continental\n}\n",
  },
  trigger: {
    method: "everyOwnedPlanet",
    record: (sink) =>
      makeScope<"country">(sink).everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
        planet.destroyColony();
      }),
    expected:
      "every_owned_planet = {\n\tlimit = {\n\t\thas_owner = yes\n\t}\n\tdestroy_colony = yes\n}\n",
  },
  effect: {
    method: "createAmbientObject",
    record: (sink) =>
      makeScope<"system">(sink).createAmbientObject({
        type: "protocol_matrix_probe",
        effect: (ambient) => {
          ambient.setAmbientObjectFlag("protocol_matrix_flag");
        },
      }),
    expected:
      "create_ambient_object = {\n\ttype = protocol_matrix_probe\n\teffect = {\n" +
      "\t\tset_ambient_object_flag = protocol_matrix_flag\n\t}\n}\n",
  },
  modifiers: {
    method: "randomOwnedPlanet",
    record: (sink) =>
      makeScope<"country">(sink).randomOwnedPlanet(
        { weights: [{ factor: 2, when: hasOwner() }] },
        (planet) => {
          planet.destroyColony();
        }
      ),
    expected:
      "random_owned_planet = {\n\tweights = {\n\t\tmodifier = {\n\t\t\tfactor = 2\n" +
      "\t\t\thas_owner = yes\n\t\t}\n\t}\n\tdestroy_colony = yes\n}\n",
  },
  fields: {
    method: "fireOnAction",
    record: (sink) =>
      makeScope<"country">(sink).fireOnAction({
        onAction: "protocol_matrix_on_action",
        scopes: { from: scopeValue<"country">("root") },
      }),
    expected:
      "fire_on_action = {\n\ton_action = protocol_matrix_on_action\n\tscopes = {\n" +
      "\t\tfrom = root\n\t}\n}\n",
  },
  "scalar-or-fields": {
    method: "createAmbientObject",
    record: (sink) =>
      makeScope<"system">(sink).createAmbientObject({
        type: "protocol_matrix_wreck",
        entityOffset: { min: -2, max: 4 },
      }),
    expected:
      "create_ambient_object = {\n\ttype = protocol_matrix_wreck\n\tentity_offset = {\n" +
      "\t\tmin = -2\n\t\tmax = 4\n\t}\n}\n",
  },
  "value-list": {
    method: "copyTechsFrom",
    record: (sink) =>
      makeScope<"country">(sink).copyTechsFrom({
        target: scopeValue<"country">("root"),
        except: ["tech_alpha", "tech_beta"],
      }),
    expected: "copy_techs_from = {\n\ttarget = root\n\texcept = { tech_alpha tech_beta }\n}\n",
  },
} satisfies Record<UsedFieldKind, EffectSpecimen>;

const EFFECT_SHAPE_SPECIMENS = {
  bool: {
    method: "destroyColony",
    record: (sink) => makeScope<"planet">(sink).destroyColony(),
    expected: "destroy_colony = yes\n",
  },
  value: {
    method: "log",
    record: (sink) => makeScope<"country">(sink).log("protocol_matrix"),
    expected: "log = protocol_matrix\n",
  },
  fields: {
    method: "spawnPlanet",
    record: (sink) => makeScope<"system">(sink).spawnPlanet({ class: "pc_continental" }),
    expected: "spawn_planet = {\n\tclass = pc_continental\n}\n",
  },
  wrapper: {
    method: "everyOwnedPlanet",
    record: (sink) =>
      makeScope<"country">(sink).everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
        planet.destroyColony();
      }),
    expected:
      "every_owned_planet = {\n\tlimit = {\n\t\thas_owner = yes\n\t}\n\tdestroy_colony = yes\n}\n",
  },
  "scope-link": {
    method: "owner",
    record: (sink) =>
      makeScope<"planet">(sink).owner.effects((country) => {
        country.log("protocol_matrix");
      }),
    expected: "owner = {\n\tlog = protocol_matrix\n}\n",
  },
} satisfies Record<EffectShapeMeta["kind"], EffectSpecimen>;

function metaOf(method: string) {
  const meta = EFFECT_META[method];
  if (meta === undefined) {
    throw new Error(`"${method}" is not a generated effect method`);
  }
  return meta;
}

/** Every field kind reachable from one effect's metadata, nesting included. */
function fieldKindsOf(fields: readonly EffectFieldMeta[] | null): ReadonlySet<EffectFieldKind> {
  const kinds = new Set<EffectFieldKind>();
  for (const field of fields ?? []) {
    kinds.add(field.kind);
    if (field.kind === "fields" || field.kind === "scalar-or-fields") {
      for (const kind of fieldKindsOf(field.fields)) {
        kinds.add(kind);
      }
    }
    if (field.kind === "value-list" && field.fields !== undefined) {
      for (const kind of fieldKindsOf(field.fields)) {
        kinds.add(kind);
      }
    }
  }
  return kinds;
}

function fieldKindsUnder(shape: EffectShapeMeta): ReadonlySet<EffectFieldKind> {
  return shape.kind === "fields" || shape.kind === "wrapper"
    ? fieldKindsOf(shape.fields)
    : new Set<EffectFieldKind>();
}

describe("the effect recording protocol", () => {
  it.each(Object.entries(EFFECT_FIELD_SPECIMENS))("records a %s field", (kind, specimen) => {
    expect([...fieldKindsUnder(metaOf(specimen.method).shape)]).toContain(kind);

    const sink: PdxEntry[] = [];
    specimen.record(sink);
    expect(serialize(sink)).toBe(specimen.expected);
  });

  it.each(Object.entries(EFFECT_SHAPE_SPECIMENS))("records a %s effect", (kind, specimen) => {
    expect(metaOf(specimen.method).shape.kind).toBe(kind);

    const sink: PdxEntry[] = [];
    specimen.record(sink);
    expect(serialize(sink)).toBe(specimen.expected);
  });

  it.each(UNUSED_FIELD_KINDS)("has no generated %s field to measure", (kind) => {
    const users = Object.entries(EFFECT_META).filter(
      ([, meta]) => meta !== undefined && fieldKindsUnder(meta.shape).has(kind)
    );

    expect(users.map(([method]) => method)).toEqual([]);
  });
});
