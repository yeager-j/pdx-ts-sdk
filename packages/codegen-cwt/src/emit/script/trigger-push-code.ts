/**
 * The runtime half of a trigger builder: the statements an emitted function
 * body runs to serialize its arguments into `PdxEntry` pushes and content
 * reference records. The sibling `triggers.ts` renders the argument types and
 * signatures over the same `ArgField` shapes and splices this code into each
 * builder it emits.
 */

import type { ArgField, ArgValue } from "../../lower/script-shape.ts";
import { camelCase, propertyAccess } from "../../naming.ts";
import { Emitter, type TsValue } from "../../render/emitter.ts";

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

/** Whether this field can put a content reference into the emitted tree: a
 * whole-reference scalar directly, a nested condition through its own refs. */
export function contributesRefs(field: ArgField): boolean {
  if (field.value.kind === "clause") {
    return true;
  }
  if (field.value.kind === "scalar") {
    return field.value.value.refTypes !== undefined;
  }
  if (field.value.kind === "valueList") {
    return (
      field.value.scalar?.refTypes !== undefined ||
      (field.value.fields?.some(contributesRefs) ?? false)
    );
  }
  return (
    (field.value.kind === "fields" || field.value.kind === "scalarOrFields") &&
    field.value.fields.some(contributesRefs)
  );
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
  if (field.repeated !== true) {
    return pushValueCode(emitter, field, access, parentFieldPath, index, sink);
  }
  // Named apart from `pushValueListCode`'s own `item<index>` so a repeated
  // value-list field does not read its loop variable while declaring it.
  const entry = `entry${index}`;
  if (field.value.kind === "comparison") {
    const args = comparisonArgs(emitter, field.value.value, JSON.stringify(field.name), entry);
    return (
      `if (${emitter.use("isComparisonList")}(${access})) {\n` +
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
  switch (field.value.kind) {
    case "scalar": {
      const { refTypes } = field.value.value;
      if (refTypes === undefined) {
        return (
          `${sink}.push(${emitter.use("kv")}(${key}, ` +
          `${pushExpr(emitter, field.value.value, access)}));`
        );
      }
      // Indexed rather than named after the field, so the local can never
      // collide with `args`, `entries`, `refs`, or a sibling field's name.
      const local = `id${index}`;
      const fieldPath = JSON.stringify(`${parentFieldPath}.${field.name}`);
      if (field.value.value.scalarSymbol !== undefined) {
        emitter.use(field.value.value.scalarSymbol);
      }
      return (
        `const ${local} = ${field.value.value.toScalar(access)};\n` +
        `    ${sink}.push(${emitter.use("kv")}(${key}, ${local}));\n` +
        `    refs.push({ targets: ${JSON.stringify(refTypes)}, id: ${local}, field: ${fieldPath} });`
      );
    }
    case "scalarOrFields": {
      const nested = field.value.fields
        .map((nestedField, nestedIndex) => {
          const nestedAccess = propertyAccess(access, camelCase(nestedField.name));
          const code = pushCode(
            emitter,
            nestedField,
            nestedAccess,
            `${parentFieldPath}.${field.name}`,
            nestedIndex,
            "nestedEntries"
          );
          return nestedField.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
        })
        .join("\n");
      return (
        `if (${emitter.use("isStructuredValue")}(${access}, ${JSON.stringify(field.value.scalar.objectKinds ?? [])})) {\n` +
        `  const nestedEntries: ${emitter.use("PdxEntry")}[] = [];\n` +
        `${nested}\n` +
        `  ${sink}.push(${emitter.use("block")}(${key}, nestedEntries));\n` +
        `} else {\n` +
        `  ${sink}.push(${emitter.use("kv")}(${key}, ${pushExpr(emitter, field.value.scalar, access)}));\n` +
        `}`
      );
    }
    case "fields": {
      const nested = field.value.fields
        .map((nestedField, nestedIndex) => {
          const nestedAccess = propertyAccess(access, camelCase(nestedField.name));
          const code = pushCode(
            emitter,
            nestedField,
            nestedAccess,
            `${parentFieldPath}.${field.name}`,
            nestedIndex,
            "nestedEntries"
          );
          return nestedField.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
        })
        .join("\n");
      return (
        `const nestedEntries: ${emitter.use("PdxEntry")}[] = [];\n` +
        `${nested}\n` +
        `${sink}.push(${emitter.use("block")}(${key}, nestedEntries));`
      );
    }
    case "valueList":
      return pushValueListCode(
        emitter,
        field.value,
        access,
        `${parentFieldPath}.${field.name}`,
        index,
        key,
        sink
      );
    case "clause":
      return (
        (field.value.splice
          ? `${sink}.push(...${access}.entries);\n`
          : `${sink}.push(block(${key}, [...${access}.entries]));\n`) +
        `    refs.push(...${access}.refs);`
      );
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
    if (scalar.refTypes === undefined) {
      return `${items}.push(${pdxScalar});`;
    }
    const id = `id${index}`;
    if (scalar.scalarSymbol !== undefined) {
      emitter.use(scalar.scalarSymbol);
    }
    return (
      `const ${id} = ${scalar.toScalar(item)};\n` +
      `${items}.push(${emitter.use("scalar")}(${id}));\n` +
      `refs.push({ targets: ${JSON.stringify(scalar.refTypes)}, id: ${id}, field: ${JSON.stringify(fieldPath)} });`
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
