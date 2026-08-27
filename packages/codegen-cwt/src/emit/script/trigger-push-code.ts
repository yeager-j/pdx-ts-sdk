/**
 * The runtime half of a trigger builder: the statements an emitted function
 * body runs to serialize its arguments into `PdxEntry` pushes and content
 * reference records. The sibling `triggers.ts` renders the argument types and
 * signatures over the same `ArgField` shapes and splices this code into each
 * builder it emits.
 */

import type { ArgField, ArgValue, BlockValue, MapValue } from "../../lower/script-shape.ts";
import { camelCase, propertyAccess } from "../../naming.ts";
import { Emitter, recordsLocalization, type TsValue } from "../../render/emitter.ts";

/**
 * The expression a scalar `TsValue` pushes into `kv()`, `scriptValueScalar`-
 * wrapped when the value is a `ScriptValue` (see `TsValue.scriptValue`) so a
 * `@name` input becomes a `var` node rather than a defensively-quoted string.
 */
export function pushExpr(emitter: Emitter, value: TsValue, expr: string): string {
  if (value.scalarSymbol !== undefined) {
    emitter.use(value.scalarSymbol);
  }
  const scalar = value.toScalar(expr);
  return value.scriptValue === true ? `${emitter.use("scriptValueScalar")}(${scalar})` : scalar;
}

/** Whether this field can put a reference into the emitted tree: a
 * whole-reference scalar directly, a nested condition through its own refs. */
export function contributesRefs(field: ArgField): boolean {
  return valueContributesRefs(field.value);
}

/** Whether one scalar records anything: a content id, a consumed localization item, or both. */
function scalarContributesRefs(value: TsValue): boolean {
  return value.refTypes !== undefined || recordsLocalization(value);
}

function valueContributesRefs(value: ArgValue): boolean {
  switch (value.kind) {
    case "clause":
    case "keyedClauses":
      return true;
    case "scalar":
      return scalarContributesRefs(value.value);
    case "comparison":
      return false;
    case "map":
      return value.map.keyRefTypes !== undefined || scalarContributesRefs(value.map.value);
    case "fields":
      return value.fields.some(contributesRefs);
    case "scalarOrBlock":
      return scalarContributesRefs(value.scalar) || valueContributesRefs(value.block);
    case "valueList":
      return (
        (value.scalar !== null && scalarContributesRefs(value.scalar)) ||
        (value.fields?.some(contributesRefs) ?? false)
      );
    case "aliasList":
    case "aliasStruct":
      return unauthorableAliasValue(value);
  }
}

/**
 * The statement that records a consumed localization item beside the key just
 * written, or nothing when the scalar admits no localization reference.
 *
 * The authored expression is passed rather than the lowered key: the fold
 * places the item's translations, which only the item itself carries.
 */
export function localizationRecordCode(
  emitter: Emitter,
  value: TsValue,
  access: string,
  fieldPath: string
): string {
  if (!recordsLocalization(value)) {
    return "";
  }
  return `\n${emitter.use("recordLocalization")}(refs, ${access}, ${JSON.stringify(fieldPath)});`;
}

/** The `cmp()` arguments one comparison occurrence supplies. */
function comparisonArgs(emitter: Emitter, operand: TsValue, key: string, access: string): string {
  return `${key}, ${access}[0], ${pushExpr(emitter, operand, `${access}[1]`)}`;
}

/**
 * Renders the statements that serialize one lowered trigger argument.
 * Nested fields recurse into their own entry arrays while reference-bearing values also record uses.
 * A repeated field loops over its array and writes one sibling key per item; a repeated
 * comparison loops only when the argument carries a list of operator/operand pairs.
 */
export function pushCode(
  emitter: Emitter,
  field: ArgField,
  access: string,
  parentFieldPath: string,
  index: number,
  sink = "entries"
): string {
  if (field.repeated === undefined) {
    return pushValueCode(emitter, field, access, parentFieldPath, index, sink);
  }
  // Named apart from `pushValueListCode`'s own `item<index>` so a repeated
  // value-list field does not read its loop variable while declaring it.
  const entry = `entry${index}`;
  if (field.value.kind === "comparison") {
    const args = comparisonArgs(emitter, field.value.value, JSON.stringify(field.name), entry);
    const fieldPath = JSON.stringify(`${parentFieldPath}.${field.name}`);
    return (
      `if (${emitter.use("isComparisonList")}(${access}, ${fieldPath})) {\n` +
      `for (const ${entry} of ${access}) {\n` +
      `${sink}.push(${emitter.use("cmp")}(${args}));\n}\n` +
      `} else {\n` +
      `${pushValueCode(emitter, field, access, parentFieldPath, index, sink)}\n}`
    );
  }
  return (
    `for (const ${entry} of ${access}) {\n` +
    `${pushValueCode(emitter, field, entry, parentFieldPath, index, sink)}\n}`
  );
}

/**
 * The generator invariant that keeps spliced alias categories out of the
 * trigger surface: a trigger block is lowered with `TRIGGER_CLAUSES`, which
 * admits no category carrying a script list or block, so no trigger argument
 * can reach the two renderers that have no way to write one.
 */
export function unauthorableAliasValue(
  value: Extract<ArgValue, { readonly kind: "aliasList" | "aliasStruct" }>
): never {
  throw new Error(
    `a trigger argument lowered to the spliced "${value.category}" category, which the ` +
      "trigger surface does not author"
  );
}

/**
 * Renders the statement that writes one whole-value entry under `key`, also
 * recording a content reference when every form the value admits is one, and
 * the item behind a consumed localization reference.
 */
function scalarPushCode(
  emitter: Emitter,
  value: TsValue,
  access: string,
  key: string,
  fieldPath: string,
  index: number,
  sink: string
): string {
  const recordLoc = localizationRecordCode(emitter, value, access, fieldPath);
  const { refTypes } = value;
  if (refTypes === undefined) {
    return (
      `${sink}.push(${emitter.use("kv")}(${key}, ${pushExpr(emitter, value, access)}));` + recordLoc
    );
  }
  // Indexed rather than named after the field, so the local can never
  // collide with `args`, `entries`, `refs`, or a sibling field's name.
  const local = `id${index}`;
  if (value.scalarSymbol !== undefined) {
    emitter.use(value.scalarSymbol);
  }
  return (
    `const ${local} = ${value.toScalar(access)};\n` +
    `    ${sink}.push(${emitter.use("kv")}(${key}, ${local}));\n` +
    `    refs.push({ targets: ${JSON.stringify(refTypes)}, id: ${local}, ` +
    `field: ${JSON.stringify(fieldPath)} });` +
    recordLoc
  );
}

/** Renders the statements that write one open-keyed map's entries into a sink. */
function mapEntriesCode(
  emitter: Emitter,
  map: MapValue,
  access: string,
  fieldPath: string,
  index: number,
  sink: string
): string {
  const entryKey = `key${index}`;
  const entryValue = `value${index}`;
  const path = JSON.stringify(fieldPath);
  const keyRef =
    map.keyRefTypes === undefined
      ? ""
      : `\nrefs.push({ targets: ${JSON.stringify(map.keyRefTypes)}, id: ${entryKey}, field: ${path} });`;
  const write =
    map.comparison === true
      ? `${sink}.push(typeof ${entryValue} === "object" ` +
        `? ${emitter.use("cmp")}(${entryKey}, ${entryValue}[0], ` +
        `${pushExpr(emitter, map.value, `${entryValue}[1]`)}) ` +
        `: ${emitter.use("kv")}(${entryKey}, ${pushExpr(emitter, map.value, entryValue)}));`
      : scalarPushCode(emitter, map.value, entryValue, entryKey, fieldPath, index, sink);
  return (
    `for (const [${entryKey}, ${entryValue}] of ` +
    `${emitter.use("mapEntries")}(${access}, ${path}, ${map.cardinality.min})) {\n` +
    `${write}${keyRef}\n}`
  );
}

/**
 * Renders the loop that writes one ordered case list: one block per case, in
 * authoring order, carrying each case's own references up with it.
 */
function keyedClausesCode(
  emitter: Emitter,
  value: Extract<ArgValue, { readonly kind: "keyedClauses" }>,
  access: string,
  fieldPath: string,
  index: number,
  sink: string
): string {
  const caseKey = `key${index}`;
  const condition = `condition${index}`;
  const checked =
    `${emitter.use("caseEntries")}(${access}, ${JSON.stringify(fieldPath)}, ` +
    `${value.cardinality.min}, ${JSON.stringify(value.reservedKeys)})`;
  return (
    `for (const [${caseKey}, ${condition}] of ${checked}) {\n` +
    `${sink}.push(${emitter.use("block")}(${caseKey}, [...${condition}.entries]));\n` +
    `refs.push(...${condition}.refs);\n}`
  );
}

/** Renders the statements that write one block-valued argument under its own key. */
function blockPushCode(
  emitter: Emitter,
  value: BlockValue,
  access: string,
  fieldPath: string,
  index: number,
  key: string,
  sink: string
): string {
  if (value.kind === "valueList") {
    return pushValueListCode(emitter, value, access, fieldPath, index, key, sink);
  }
  // Named after the array it nests under, so the local stays distinct from
  // both its siblings and every array it is declared inside.
  const nested = `${sink}Nested${index}`;
  const body =
    value.kind === "map"
      ? mapEntriesCode(emitter, value.map, access, fieldPath, index, nested)
      : value.fields
          .map((field, nestedIndex) => {
            const nestedAccess = propertyAccess(access, camelCase(field.name));
            const code = pushCode(emitter, field, nestedAccess, fieldPath, nestedIndex, nested);
            return field.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
          })
          .join("\n");
  return (
    `const ${nested}: ${emitter.use("PdxEntry")}[] = [];\n${body}\n` +
    `${sink}.push(${emitter.use("block")}(${key}, ${nested}));`
  );
}

/** Renders the statements that serialize one occurrence of a lowered argument. */
function pushValueCode(
  emitter: Emitter,
  field: ArgField,
  access: string,
  parentFieldPath: string,
  index: number,
  sink: string
): string {
  const key = JSON.stringify(field.name);
  const fieldPath = `${parentFieldPath}.${field.name}`;
  switch (field.value.kind) {
    case "scalar":
      return scalarPushCode(emitter, field.value.value, access, key, fieldPath, index, sink);
    case "scalarOrBlock": {
      const takesBlock =
        field.value.block.kind === "valueList"
          ? `Array.isArray(${access})`
          : `${emitter.use("isStructuredValue")}(${access}, ${JSON.stringify(field.value.scalar.objectKinds ?? [])})`;
      const blockCode = blockPushCode(
        emitter,
        field.value.block,
        access,
        fieldPath,
        index,
        key,
        sink
      );
      return (
        `if (${takesBlock}) {\n${blockCode}\n} else {\n` +
        `${scalarPushCode(emitter, field.value.scalar, access, key, fieldPath, index, sink)}\n}`
      );
    }
    case "fields":
    case "valueList":
      return blockPushCode(emitter, field.value, access, fieldPath, index, key, sink);
    case "map":
      return field.value.map.splice
        ? mapEntriesCode(emitter, field.value.map, access, fieldPath, index, sink)
        : blockPushCode(emitter, field.value, access, fieldPath, index, key, sink);
    case "clause":
      return (
        (field.value.splice
          ? `${sink}.push(...${access}.entries);\n`
          : `${sink}.push(block(${key}, [...${access}.entries]));\n`) +
        `    refs.push(...${access}.refs);`
      );
    case "keyedClauses":
      return keyedClausesCode(emitter, field.value, access, fieldPath, index, sink);
    case "aliasList":
    case "aliasStruct":
      return unauthorableAliasValue(field.value);
    case "comparison":
      return (
        `${sink}.push(typeof ${access} === "object" ` +
        `? ${emitter.use("cmp")}(${comparisonArgs(emitter, field.value.value, key, access)}) : ` +
        `${emitter.use("kv")}(${key}, ${pushExpr(emitter, field.value.value, access)}));`
      );
  }
}

/**
 * Renders serialization for one cardinality-bearing list of scalar or structured values.
 * Mixed lists dispatch each item once and preserve both item order and reference reporting.
 */
export function pushValueListCode(
  emitter: Emitter,
  value: Extract<ArgValue, { readonly kind: "valueList" }>,
  access: string,
  fieldPath: string,
  index: number,
  key: string,
  sink: string
): string {
  const items = `items${index}`;
  const item = `item${index}`;
  const scalar = value.scalar;
  const structured = value.fields;
  const scalarPush = (() => {
    if (scalar === null) {
      return "";
    }
    const expression = pushExpr(emitter, scalar, item);
    const pdxScalar =
      scalar.scriptValue === true ? expression : `${emitter.use("scalar")}(${expression})`;
    const recordLoc = localizationRecordCode(emitter, scalar, item, fieldPath);
    if (scalar.refTypes === undefined) {
      return `${items}.push(${pdxScalar});` + recordLoc;
    }
    const id = `id${index}`;
    if (scalar.scalarSymbol !== undefined) {
      emitter.use(scalar.scalarSymbol);
    }
    return (
      `const ${id} = ${scalar.toScalar(item)};\n` +
      `${items}.push(${emitter.use("scalar")}(${id}));\n` +
      `refs.push({ targets: ${JSON.stringify(scalar.refTypes)}, id: ${id}, field: ${JSON.stringify(fieldPath)} });` +
      recordLoc
    );
  })();
  const structuredPush = (() => {
    if (structured === null) {
      return "";
    }
    const nested = structured
      .map((field, nestedIndex) => {
        const nestedAccess = propertyAccess(item, camelCase(field.name));
        const code = pushCode(
          emitter,
          field,
          nestedAccess,
          fieldPath,
          nestedIndex,
          "nestedEntries"
        );
        return field.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
      })
      .join("\n");
    return (
      `const nestedEntries: ${emitter.use("PdxEntry")}[] = [];\n${nested}\n` +
      `${items}.push(${emitter.use("container")}(nestedEntries));`
    );
  })();
  const body =
    scalar !== null && structured !== null
      ? `if (${emitter.use("isStructuredValue")}(${item}, ${JSON.stringify(scalar.objectKinds ?? [])})) {\n${structuredPush}\n} else {\n${scalarPush}\n}`
      : structuredPush || scalarPush;
  return (
    `const ${items}: ${emitter.use("PdxItem")}[] = [];\n` +
    `for (const ${item} of ${access}) {\n${body}\n}\n` +
    `${sink}.push(${emitter.use("kv")}(${key}, ${emitter.use("container")}(${items})));`
  );
}
