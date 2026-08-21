/** Machine-readable metadata for the public script reference surface. */

import { compareStrings } from "../naming.ts";

export type ScriptReferenceAvailability =
  { readonly kind: "universal" } | { readonly kind: "scopes"; readonly scopes: readonly string[] };

export type ScriptEffectReferenceKind = "effect" | "structural" | "event-fire";

export interface ScriptEffectReferenceRow {
  readonly method: string;
  readonly key?: string;
  readonly kind: ScriptEffectReferenceKind;
  readonly availability: ScriptReferenceAvailability;
  readonly signature: string;
  readonly docs: readonly string[];
}

export interface ScriptScopeLinkReferenceRow {
  readonly member: string;
  readonly fromScopes: readonly string[];
  readonly toScope: string;
  readonly docs: readonly string[];
}

export interface ScriptReferenceEmission {
  readonly code: string;
  readonly effects: number;
  readonly scopeLinks: number;
}

function availabilityKey(availability: ScriptReferenceAvailability): string {
  return availability.kind === "universal" ? availability.kind : availability.scopes.join("|");
}

function sameAvailability(
  left: ScriptReferenceAvailability,
  right: ScriptReferenceAvailability
): boolean {
  return availabilityKey(left) === availabilityKey(right);
}

function validateAvailability(
  availability: ScriptReferenceAvailability,
  scopes: ReadonlySet<string>,
  label: string
): void {
  if (availability.kind === "universal") {
    return;
  }
  if (availability.scopes.length === 0) {
    throw new Error(`${label} has an empty availability scope set`);
  }
  const seen = new Set<string>();
  for (const scope of availability.scopes) {
    if (!scopes.has(scope)) {
      throw new Error(`${label} names unknown scope "${scope}"`);
    }
    if (seen.has(scope)) {
      throw new Error(`${label} repeats availability scope "${scope}"`);
    }
    seen.add(scope);
  }
}

function validateScopes(
  scopesToCheck: readonly string[],
  scopes: ReadonlySet<string>,
  label: string
): void {
  if (scopesToCheck.length === 0) {
    throw new Error(`${label} has an empty scope set`);
  }
  const seen = new Set<string>();
  for (const scope of scopesToCheck) {
    if (!scopes.has(scope)) {
      throw new Error(`${label} names unknown scope "${scope}"`);
    }
    if (seen.has(scope)) {
      throw new Error(`${label} repeats scope "${scope}"`);
    }
    seen.add(scope);
  }
}

/**
 * Checks the generated rows before they become a public committed module.
 * Keeping this validator independent makes malformed policy rows easy to test
 * without loading the full CWT corpus.
 */
export function validateScriptReferences(
  scopes: readonly string[],
  effects: readonly ScriptEffectReferenceRow[],
  scopeLinks: readonly ScriptScopeLinkReferenceRow[]
): void {
  const knownScopes = new Set(scopes);
  const members = new Map<string, ScriptEffectReferenceRow>();
  const keys = new Map<string, ScriptEffectReferenceRow>();
  for (const effect of effects) {
    validateAvailability(effect.availability, knownScopes, `effect ${effect.method}`);
    if (effect.method === "") {
      throw new Error("effect reference has an empty member");
    }
    const prior = members.get(effect.method);
    if (prior !== undefined) {
      const contradiction =
        prior.kind !== effect.kind ||
        prior.key !== effect.key ||
        !sameAvailability(prior.availability, effect.availability) ||
        prior.signature !== effect.signature ||
        JSON.stringify(prior.docs) !== JSON.stringify(effect.docs);
      throw new Error(
        `${contradiction ? "contradictory" : "duplicate"} effect member "${effect.method}"`
      );
    }
    members.set(effect.method, effect);
    if (effect.key !== undefined) {
      const keyPrior = keys.get(effect.key);
      if (keyPrior !== undefined) {
        throw new Error(
          `duplicate fixed script key "${effect.key}" on ${keyPrior.method} and ${effect.method}`
        );
      }
      keys.set(effect.key, effect);
    }
  }

  const links = new Map<string, ScriptScopeLinkReferenceRow>();
  for (const link of scopeLinks) {
    validateScopes(link.fromScopes, knownScopes, `scope link ${link.member}`);
    if (!knownScopes.has(link.toScope)) {
      throw new Error(`scope link ${link.member} names unknown output scope "${link.toScope}"`);
    }
    const prior = links.get(link.member);
    if (prior !== undefined) {
      const contradiction =
        prior.toScope !== link.toScope ||
        prior.fromScopes.join("|") !== link.fromScopes.join("|") ||
        JSON.stringify(prior.docs) !== JSON.stringify(link.docs);
      throw new Error(
        `${contradiction ? "contradictory" : "duplicate"} scope link member "${link.member}"`
      );
    }
    links.set(link.member, link);
  }
}

function availabilityCode(availability: ScriptReferenceAvailability): string {
  return availability.kind === "universal"
    ? '{ kind: "universal" }'
    : `{ kind: "scopes", scopes: [${availability.scopes.map((scope) => JSON.stringify(scope)).join(", ")}] }`;
}

function effectCode(effect: ScriptEffectReferenceRow): string {
  return (
    `  { method: ${JSON.stringify(effect.method)}, ` +
    (effect.key === undefined ? "" : `key: ${JSON.stringify(effect.key)}, `) +
    `kind: ${JSON.stringify(effect.kind)}, availability: ${availabilityCode(effect.availability)}, ` +
    `signature: ${JSON.stringify(effect.signature)}, docs: ${JSON.stringify(effect.docs)} },\n`
  );
}

function linkCode(link: ScriptScopeLinkReferenceRow): string {
  return (
    `  { member: ${JSON.stringify(link.member)}, fromScopes: [${link.fromScopes.map((scope) => JSON.stringify(scope)).join(", ")}], ` +
    `toScope: ${JSON.stringify(link.toScope)}, docs: ${JSON.stringify(link.docs)} },\n`
  );
}

export function emitScriptReferences(
  scopes: readonly string[],
  effects: readonly ScriptEffectReferenceRow[],
  scopeLinks: readonly ScriptScopeLinkReferenceRow[]
): ScriptReferenceEmission {
  validateScriptReferences(scopes, effects, scopeLinks);
  const effectRows = [...effects].sort((left, right) => compareStrings(left.method, right.method));
  const linkRows = [...scopeLinks].sort((left, right) => compareStrings(left.member, right.member));
  const structuralImport =
    'import { STRUCTURAL_EFFECT_REFERENCES } from "../script/effects/structural-reference.ts";\n';
  const code =
    'import type { ScopeName } from "./scopes.ts";\n' +
    structuralImport +
    "\n" +
    "export type ScriptReferenceAvailability =\n" +
    '  | { readonly kind: "universal" }\n' +
    '  | { readonly kind: "scopes"; readonly scopes: readonly ScopeName[] };\n' +
    'export type ScriptEffectReferenceKind = "effect" | "structural" | "event-fire";\n\n' +
    "export interface ScriptEffectReference {\n" +
    "  readonly method: string;\n" +
    "  readonly key?: string;\n" +
    "  readonly kind: ScriptEffectReferenceKind;\n" +
    "  readonly availability: ScriptReferenceAvailability;\n" +
    "  readonly signature: string;\n" +
    "  readonly docs: readonly string[];\n" +
    "}\n\n" +
    "export interface ScriptScopeLinkReference {\n" +
    "  readonly member: string;\n" +
    "  readonly fromScopes: readonly ScopeName[];\n" +
    "  readonly toScope: ScopeName;\n" +
    "  readonly docs: readonly string[];\n" +
    "}\n\n" +
    `export const SCRIPT_REFERENCE_SCOPES = ${JSON.stringify(scopes)} as const satisfies readonly ScopeName[];\n\n` +
    "export const SCRIPT_EFFECT_REFERENCES = [\n" +
    effectRows.map(effectCode).join("") +
    "  ...STRUCTURAL_EFFECT_REFERENCES,\n" +
    "] as const as readonly ScriptEffectReference[];\n\n" +
    "export const SCRIPT_SCOPE_LINK_REFERENCES = [\n" +
    linkRows.map(linkCode).join("") +
    "] as const satisfies readonly ScriptScopeLinkReference[];\n";
  return { code, effects: effectRows.length, scopeLinks: linkRows.length };
}
