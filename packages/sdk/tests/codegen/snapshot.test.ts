import { readFileSync } from "node:fs";
import { CONTENT_WITNESSES } from "@pdx-ts/codegen-cwt/overlay";
import { describe, expect, it } from "vitest";

const source = readFileSync("packages/sdk/src/generated/triggers.ts", "utf8");
const refs = readFileSync("packages/sdk/src/generated/refs.ts", "utf8");
const contentDefiners = readFileSync("packages/sdk/src/generated/content-definers.ts", "utf8");
const modifiers = readFileSync("packages/sdk/src/generated/modifiers.ts", "utf8");

/** Slices one generated declaration out so signature changes show up in the diff. */
function declaration(name: string): string {
  const start = source.search(new RegExp(`export function ${name}[(<]`));
  if (start === -1) {
    throw new Error(`${name} is not in the generated triggers`);
  }
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

/** Slices one generated argument type out, interface or type alias. */
function argsDeclaration(name: string): string {
  const start = source.search(new RegExp(`export (?:interface|type) ${name}\\b`));
  if (start === -1) {
    throw new Error(`${name} is not in the generated triggers`);
  }
  const close = source.indexOf("\n}", start);
  return source.slice(start, source.startsWith("\n};", close) ? close + 3 : close + 2);
}

describe("emitted trigger signatures", () => {
  it("bool: an omitted argument means yes", () => {
    expect(declaration("isAi")).toMatchInlineSnapshot(`
      "export function isAi(value: boolean = true): Trigger<"country"> {
        return trigger([kv("is_ai", value)]);
      }"
    `);
  });

  it("value-field comparison: keeps the CWT ScriptValue operand", () => {
    expect(declaration("numMoons")).toMatchInlineSnapshot(`
      "export function numMoons(op: PdxOp, value: ScriptValue): Trigger<"carrier" | "planet" | "ship"> {
        return trigger([cmp("num_moons", op, scriptValueScalar(value))]);
      }"
    `);
  });

  it("plain numeric comparison: keeps an ordinary number operand", () => {
    expect(declaration("aiArmorRatio")).toMatchInlineSnapshot(`
      "export function aiArmorRatio(op: PdxOp, value: number): Trigger<"country"> {
        return trigger([cmp("ai_armor_ratio", op, value)]);
      }"
    `);
  });

  it("type reference: accepts an SDK object or a raw id", () => {
    expect(declaration("hasEdict")).toMatchInlineSnapshot(`
      "export function hasEdict(value: EdictRef | string): Trigger<"country"> {
        const id = refId(value);
        return trigger([kv("has_edict", id)], [{ targets: ["edict"], id, field: "has_edict" }]);
      }"
    `);
  });

  it("enum: resolves to a literal union", () => {
    expect(declaration("hasElectionType")).toMatchInlineSnapshot(`
      "export function hasElectionType(value: ElectionType): Trigger<"country"> {
        return trigger([kv("has_election_type", value)]);
      }"
    `);
  });

  it("scope change: takes the condition, typed to the pushed scope", () => {
    expect(declaration("anyCountry")).toMatchInlineSnapshot(`
      "export function anyCountry(condition: Trigger<"country">): Trigger<ScopeName> {
        return trigger([block("any_country", [...condition.entries])], [...condition.refs]);
      }"
    `);
  });

  it("clause + comparison fields: a nested trigger hole and an operator-or-literal count", () => {
    expect(argsDeclaration("CountOwnedPopGroupArgs")).toMatchInlineSnapshot(`
      "export interface CountOwnedPopGroupArgs {
        limit?: Trigger<"pop_group">;
        count: ScriptValue | readonly [PdxOp, ScriptValue] | "all";
      }"
    `);
    expect(declaration("countOwnedPopGroup")).toMatchInlineSnapshot(`
      "export function countOwnedPopGroup(
        args: CountOwnedPopGroupArgs
      ): Trigger<
        "carrier" | "colony" | "country" | "planet" | "pop_faction" | "sector" | "ship" | "system"
      > {
        const entries: PdxEntry[] = [];
        const refs: RecordedRefUse[] = [];
        if (args.limit !== undefined) {
          entries.push(block("limit", [...args.limit.entries]));
          refs.push(...args.limit.refs);
        }
        entries.push(
          typeof args.count === "object"
            ? cmp("count", args.count[0], scriptValueScalar(args.count[1]))
            : kv("count", scriptValueScalar(args.count))
        );
        return trigger([block("count_owned_pop_group", entries)], refs);
      }"
    `);
  });

  it("splice + fields: the trigger splice becomes an implicit conditions argument", () => {
    expect(argsDeclaration("CalcTrueIfArgs")).toMatchInlineSnapshot(`
      "export interface CalcTrueIfArgs<S extends ScopeName = ScopeName> {
        amount: ScriptValue | readonly [PdxOp, ScriptValue];
        /** The nested conditions, written bare inside the block beside its named keys. */
        conditions: Trigger<S>;
      }"
    `);
    expect(declaration("calcTrueIf")).toMatchInlineSnapshot(`
      "export function calcTrueIf<S extends ScopeName = ScopeName>(args: CalcTrueIfArgs<S>): Trigger<S> {
        const entries: PdxEntry[] = [];
        const refs: RecordedRefUse[] = [];
        entries.push(
          typeof args.amount === "object"
            ? cmp("amount", args.amount[0], scriptValueScalar(args.amount[1]))
            : kv("amount", scriptValueScalar(args.amount))
        );
        entries.push(...args.conditions.entries);
        refs.push(...args.conditions.refs);
        return trigger([block("calc_true_if", entries)], refs);
      }"
    `);
  });

  it("plain numeric comparison fields stay numeric", () => {
    expect(argsDeclaration("DistanceArgs")).toContain(
      "minDistance?: number | readonly [PdxOp, number];"
    );
    expect(argsDeclaration("DistanceArgs")).toContain(
      "maxDistance?: number | readonly [PdxOp, number];"
    );
  });

  it("scope[X]: one branded scope value, and no raw-string arm", () => {
    expect(declaration("canAccessSystem")).toMatchInlineSnapshot(`
      "export function canAccessSystem(value: ScopeValue<"system">): Trigger<"fleet"> {
        return trigger([kv("can_access_system", value.path)]);
      }"
    `);
  });

  it("alias_keys_field: an open alias-key name", () => {
    expect(argsDeclaration("CheckModifierValueArgs")).toMatchInlineSnapshot(`
      "export interface CheckModifierValueArgs {
        modifier: string;
        value: ScriptValue | readonly [PdxOp, ScriptValue];
      }"
    `);
  });

  it("scope_group[G]: the group's members, canonicalised and sorted", () => {
    // A group is a coercion: `target_species` lists the scopes the game reads
    // a species *out of*, not scopes that are species.
    expect(declaration("isSameSpecies")).toMatchInlineSnapshot(`
      "export function isSameSpecies(
        value: ScopeValue<
          | "army"
          | "carrier"
          | "country"
          | "first_contact"
          | "fleet"
          | "leader"
          | "planet"
          | "pop_group"
          | "ship"
          | "species"
        >
      ): Trigger<"army" | "country" | "leader" | "pop_group" | "ship" | "species"> {
        return trigger([kv("is_same_species", value.path)]);
      }"
    `);
  });

  it("scope overloaded with a reference: one unwrapping call site serves both", () => {
    expect(declaration("isPlanetClass")).toMatchInlineSnapshot(`
      "export function isPlanetClass(
        value:
          | PlanetClassRef
          | string
          | ScopeValue<
              | "archaeological_site"
              | "army"
              | "carrier"
              | "deposit"
              | "fleet"
              | "megastructure"
              | "planet"
              | "pop_group"
              | "ship"
            >
      ): Trigger<"carrier" | "colony" | "dlc_recommendation" | "planet" | "ship"> {
        return trigger([kv("is_planet_class", refId(value))]);
      }"
    `);
  });

  it("block: becomes one options object, optional where cardinality allows", () => {
    expect(declaration("relativePower")).toMatchInlineSnapshot(`
      "export function relativePower(args: RelativePowerArgs): Trigger<"country" | "federation"> {
        const entries: PdxEntry[] = [];
        entries.push(kv("who", args.who.path));
        if (args.category !== undefined) {
          entries.push(kv("category", args.category));
        }
        entries.push(kv("value", args.value));
        return trigger([block("relative_power", entries)]);
      }"
    `);
  });

  it("scalar plus block: preserves both custom_tooltip forms as overloads", () => {
    expect(argsDeclaration("CustomTooltipArgs")).toMatchInlineSnapshot(`
      "export type CustomTooltipArgs<S extends ScopeName = ScopeName> = {
        text?: "" | LocalizationInput;
        failText?: "default" | LocalizationInput;
        successText?: LocalizationInput;
        /** The nested conditions, written bare inside the block beside its named keys. */
        conditions: Trigger<S>;
      };"
    `);
    expect(declaration("customTooltip")).toMatchInlineSnapshot(`
      "export function customTooltip(value: LocalizationInput): Trigger<ScopeName>;
      export function customTooltip<S extends ScopeName = ScopeName>(
        args: CustomTooltipArgs<S>
      ): Trigger<S>;
      export function customTooltip<S extends ScopeName>(
        value: LocalizationInput | CustomTooltipArgs<S>
      ): Trigger<ScopeName> {
        if (isStructuredValue(value, ["localization-ref", "localized-text"])) {
          const args = value;
          const entries: PdxEntry[] = [];
          const refs: RecordedRefUse[] = [];
          if (args.text !== undefined) {
            entries.push(kv("text", localizationScalar(args.text, "custom_tooltip.text", [""])));
            recordLocalization(refs, args.text, "custom_tooltip.text");
          }
          if (args.failText !== undefined) {
            entries.push(
              kv("fail_text", localizationScalar(args.failText, "custom_tooltip.fail_text", ["default"]))
            );
            recordLocalization(refs, args.failText, "custom_tooltip.fail_text");
          }
          if (args.successText !== undefined) {
            entries.push(
              kv("success_text", localizationScalar(args.successText, "custom_tooltip.success_text"))
            );
            recordLocalization(refs, args.successText, "custom_tooltip.success_text");
          }
          entries.push(...args.conditions.entries);
          refs.push(...args.conditions.refs);
          return trigger([block("custom_tooltip", entries)], refs);
        }
        const refs: RecordedRefUse[] = [];
        recordLocalization(refs, value, "custom_tooltip");
        return trigger([kv("custom_tooltip", localizationScalar(value, "custom_tooltip"))], refs);
      }"
    `);
  });

  it("scalar plus block: dispatches a reference scalar on the object kinds it admits", () => {
    expect(argsDeclaration("HasResourceArgs")).toMatchInlineSnapshot(`
      "export type HasResourceArgs = {
        type: ResourceRef | string;
        amount: ScriptValue | readonly [PdxOp, ScriptValue];
      };"
    `);
    expect(declaration("hasResource")).toMatchInlineSnapshot(`
      "export function hasResource(
        value: ResourceRef | string | boolean
      ): Trigger<"astral_rift" | "carrier" | "country" | "deposit" | "planet" | "ship">;
      export function hasResource(
        args: HasResourceArgs
      ): Trigger<"astral_rift" | "carrier" | "country" | "deposit" | "planet" | "ship">;
      export function hasResource(
        value: ResourceRef | string | boolean | HasResourceArgs
      ): Trigger<"astral_rift" | "carrier" | "country" | "deposit" | "planet" | "ship"> {
        if (isStructuredValue(value, ["typed-ref"])) {
          const args = value;
          const entries: PdxEntry[] = [];
          const refs: RecordedRefUse[] = [];
          const id0 = refId(args.type);
          entries.push(kv("type", id0));
          refs.push({ targets: ["resource"], id: id0, field: "has_resource.type" });
          entries.push(
            typeof args.amount === "object"
              ? cmp("amount", args.amount[0], scriptValueScalar(args.amount[1]))
              : kv("amount", scriptValueScalar(args.amount))
          );
          return trigger([block("has_resource", entries)], refs);
        }
        return trigger([kv("has_resource", refId(value))]);
      }"
    `);
  });
});

describe("scalar lowering ownership", () => {
  it("keeps generated refs rules-derived and imports the handwritten runtime", () => {
    expect(refs).toContain('import type { TypedRef } from "../script/scalar.ts";');
    expect(refs).not.toContain("function refId");
    expect(source).toContain(
      "import {\n" +
        "  caseEntries,\n  isComparisonList,\n  isStructuredValue,\n  localizationScalar,\n" +
        "  mapEntries,\n  refId,\n" +
        '} from "../script/scalar.ts";'
    );
    expect(contentDefiners).toContain(
      'import { refId, type TypedRef } from "../script/scalar.ts";'
    );
  });
});

describe("CONTENT_WITNESSES drives both economic_category witness sites (SDK-260)", () => {
  // Byte-equality (codegen:check) proves the committed output matches what
  // the generator produces today; it cannot tell whether that output still
  // traces back to CONTENT_WITNESSES's one `omit` list or to two
  // independently hand-spelled copies that happen to agree right now. These
  // checks read the row and assert both generated files actually contain the
  // text each member ought to produce, so a member added, renamed, or
  // reordered in the overlay row and forgotten in one consumer's derivation
  // shows up here even when nothing else in the suite touches that consumer.
  // Both files are normalised to single-space runs first: Prettier wraps the
  // union and the object type across lines (and adds a trailing `;` inside a
  // wrapped member) in ways this check should not depend on.
  const witness = CONTENT_WITNESSES.get("economic_category");
  if (witness === undefined || witness.mode !== "intersects") {
    throw new Error('expected an "intersects"-mode CONTENT_WITNESSES row for "economic_category"');
  }
  const normalizedContentDefiners = contentDefiners.replace(/\s+/g, " ");
  const normalizedModifiers = modifiers.replace(/\s+/g, " ");

  it("spells content-definers.ts's Omit<...> union from the row's member list, in row order", () => {
    const omitUnion = witness.omit.map((entry) => `"${entry.member}"`).join(" | ");
    expect(normalizedContentDefiners).toContain(omitUnion);
  });

  it("spells modifiers.ts's EconomicWitnessOf from the row's (member, inferAs) pairs", () => {
    for (const entry of witness.omit) {
      expect(normalizedModifiers).toContain(
        `readonly ${entry.member}: D extends { readonly ${entry.member}: infer ${entry.inferAs}`
      );
    }
  });
});
