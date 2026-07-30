export type PdxScalar =
  | { kind: "str"; value: string; quoted: boolean }
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean };

export type PdxValue =
  PdxScalar | { kind: "block"; entries: PdxEntry[] } | { kind: "list"; items: PdxScalar[] };

export type PdxOp = "=" | ">" | "<" | ">=" | "<=" | "!=";

export interface PdxEntry {
  key: string;
  op: PdxOp;
  value: PdxValue;
}

export function scalar(value: string | number | boolean): PdxScalar {
  switch (typeof value) {
    case "string":
      return { kind: "str", value, quoted: false };
    case "number":
      return { kind: "num", value };
    case "boolean":
      return { kind: "bool", value };
  }
}

export function quoted(value: string): PdxScalar {
  return { kind: "str", value, quoted: true };
}

export function kv(key: string, value: string | number | boolean | PdxValue): PdxEntry {
  const isNode = typeof value === "object" && value !== null && "kind" in value;
  return { key, op: "=", value: isNode ? value : scalar(value) };
}

export function cmp(key: string, op: PdxOp, value: number): PdxEntry {
  return { key, op, value: scalar(value) };
}

export function block(key: string, entries: PdxEntry[]): PdxEntry {
  return { key, op: "=", value: { kind: "block", entries } };
}

export function list(key: string, items: PdxScalar[]): PdxEntry {
  return { key, op: "=", value: { kind: "list", items } };
}
