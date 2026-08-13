/**
 * Maps both parsers' outputs into one normal form for the differential test.
 * See differential.test.ts for the deliberate normalizations.
 */

import type { PdxItem, PdxScalar } from "../src/index.ts";

const OPS: Record<string, string> = {
  LESS_THAN: "<",
  GREATER_THAN: ">",
  LESS_THAN_EQUAL: "<=",
  GREATER_THAN_EQUAL: ">=",
  NOT_EQUAL: "!=",
  EQUAL: "=",
};

export type Norm =
  | ["s", string]
  | ["e", string, string, Norm]
  | ["c", string | null, Norm[]]
  | ["p", string, Norm[]];

function unescape(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function canonicalScalar(text: string): string {
  const asNumber = Number(text);
  return text.trim() !== "" && Number.isFinite(asNumber) ? String(asNumber) : text;
}

function normOurScalar(scalar: PdxScalar): string {
  switch (scalar.kind) {
    case "bool":
      return scalar.value ? "yes" : "no";
    case "num":
      // Through the same narrowing as a numeric-looking string: jomini hands
      // back JS numbers, so both sides have to meet in that form.
      return canonicalScalar(scalar.lexeme);
    case "str":
      return canonicalScalar(unescape(scalar.value));
    case "var":
      return scalar.name;
    case "math":
      return scalar.source;
  }
}

export function normOurs(items: readonly PdxItem[]): Norm[] {
  const result: Norm[] = [];
  for (const item of items) {
    if (item.kind === "entry") {
      const value =
        item.value.kind === "container"
          ? (["c", item.value.header ?? null, normOurs(item.value.items)] satisfies Norm)
          : (["s", normOurScalar(item.value)] satisfies Norm);
      result.push(["e", item.key, item.op, value]);
      continue;
    }
    if (item.kind === "container") {
      if (item.items.length === 0) {
        continue; // jomini drops empty anonymous containers
      }
      result.push(["c", item.header ?? null, normOurs(item.items)]);
      continue;
    }
    if (item.kind === "param") {
      result.push(["p", `${item.negated ? "!" : ""}${item.name}`, normOurs(item.items)]);
      continue;
    }
    if (item.kind === "param-text") {
      // jomini has no counterpart: a region we could not tree is one it
      // rejects the whole file over. Normalizing the raw body to a scalar
      // keeps the comparison total and makes a vanilla file that grows one
      // surface as a mismatch instead of as agreement.
      result.push(["p", `${item.negated ? "!" : ""}${item.name}`, [["s", item.text]]]);
      continue;
    }
    result.push(["s", normOurScalar(item)]);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normJominiScalar(value: unknown): Norm {
  if (typeof value === "boolean") {
    return ["s", value ? "yes" : "no"];
  }
  if (typeof value === "number") {
    return ["s", String(value)];
  }
  return ["s", canonicalScalar(String(value))];
}

function normJominiValue(value: unknown): Norm {
  if (isPlainObject(value)) {
    if (value["type"] === "obj" || value["type"] === "array") {
      return ["c", null, normJominiBody(value)];
    }
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const key = keys[0]!;
      const op = OPS[key];
      if (op !== undefined) {
        return ["e", "", op, normJominiValue(value[key])]; // op wrapper; key filled by caller
      }
      // A plain one-key object is a header container.
      const inner = normJominiValue(value[key]);
      if (inner[0] === "c") {
        return ["c", key, inner[2]];
      }
    }
  }
  return normJominiScalar(value);
}

function normJominiPair(key: string, value: unknown): Norm {
  // A pair with no value is jomini's representation of a bare scalar item
  // inside an object-shaped container (e.g. a trailing bare prerequisite).
  if (value === undefined || value === null) {
    return ["s", canonicalScalar(key)];
  }
  const paramMatch = /^\[(!?[^\]]+)\]$/.exec(key);
  if (paramMatch !== null) {
    const body = normJominiValue(value);
    return ["p", paramMatch[1]!, body[0] === "c" ? body[2] : [body]];
  }
  const norm = normJominiValue(value);
  if (norm[0] === "e") {
    return ["e", key, norm[2], norm[3]];
  }
  return ["e", key, "=", norm];
}

export function normJominiBody(node: Record<string, unknown>): Norm[] {
  const val = node["val"] as unknown[];
  if (node["type"] === "obj") {
    return (val as [string, unknown][]).map(([key, value]) => normJominiPair(key, value));
  }
  return val.map((element) => {
    if (isPlainObject(element) && element["type"] === undefined) {
      const keys = Object.keys(element);
      if (keys.length === 1) {
        return normJominiPair(keys[0]!, element[keys[0]!]);
      }
    }
    return normJominiValue(element);
  });
}
