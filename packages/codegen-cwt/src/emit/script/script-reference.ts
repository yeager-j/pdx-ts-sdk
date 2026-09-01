/** Machine-readable metadata for the public script reference surface. */

import { compareStrings, docComment } from "../../naming.ts";
import type { StructuralEffectIdentity } from "../../policy/effects.ts";

/**
 * Describes whether a generated script member is universal or belongs to an exact scope set.
 * Scoped rows must carry a non-empty, duplicate-free list of known canonical scopes.
 */
export type ScriptReferenceAvailability =
  | {
      /** Identifies a member available in every script scope. */
      readonly kind: "universal";
    }
  | {
      /** Identifies a member available only in the accompanying scopes. */
      readonly kind: "scopes";
      /** Exact canonical scopes on which the member is present. */
      readonly scopes: readonly string[];
    };

/** Ownership class of a public effect-like method in the script reference. */
export type ScriptEffectReferenceKind = "effect" | "structural" | "event-fire";

/** Machine-readable reference data for one public effect-like method. */
export interface ScriptEffectReferenceRow {
  /** Public TypeScript method name. */
  readonly method: string;
  /** Fixed PDXScript key, when the method always records one key. */
  readonly key?: string;
  /** Emitter family that owns the method. */
  readonly kind: ScriptEffectReferenceKind;
  /** Scopes on which the method is present. */
  readonly availability: ScriptReferenceAvailability;
  /** Public call signature without its documentation comment. */
  readonly signature: string;
  /** Documentation lines attached to the public method. */
  readonly docs: readonly string[];
}

/** Machine-readable reference data for one generated trigger builder. */
export interface ScriptTriggerReferenceRow {
  /** Public TypeScript builder name. */
  readonly method: string;
  /** Fixed PDXScript key recorded by the builder. */
  readonly key: string;
  /** Scopes where the trigger key is legal. */
  readonly availability: ScriptReferenceAvailability;
  /** Public call signature without its documentation comment. */
  readonly signature: string;
  /** Documentation lines attached to the public builder. */
  readonly docs: readonly string[];
}

/** Machine-readable reference data for one effect scope-navigation property. */
export interface ScriptScopeLinkReferenceRow {
  /** Public path property name. */
  readonly member: string;
  /** Canonical scopes from which the navigation is valid. */
  readonly fromScopes: readonly string[];
  /** Canonical scope reached by the navigation. */
  readonly toScope: string;
  /** Documentation lines attached to the public property. */
  readonly docs: readonly string[];
}

/**
 * The names and fixed PDXScript keys the hand-written structural surface already owns.
 * Generated rows are validated against these claims because the emitted catalog appends
 * the structural rows to the generated ones.
 */
export interface StructuralScriptClaims {
  /** Every public structural method with the fixed key it records, or `null` for none. */
  readonly methods: readonly StructuralEffectIdentity[];
  /** Every CWT effect key the structural surface owns, including keys with no public method. */
  readonly keys: readonly string[];
}

/** Generated script-reference module text and its row counts. */
export interface ScriptReferenceEmission {
  /** Complete generated `script-reference.ts` module text. */
  readonly code: string;
  /** Number of generated effect-like rows before structural rows are appended. */
  readonly effects: number;
  /** Number of generated trigger-builder rows. */
  readonly triggers: number;
  /** Number of generated scope-link rows. */
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

/** How a claimed key with no public method is named in a collision message. */
const STRUCTURAL_KEY_OWNER = "the structural effect surface";

/** What already claims a public effect member name while generated rows are walked. */
type EffectMemberClaim =
  | { readonly kind: "generated"; readonly row: ScriptEffectReferenceRow }
  | { readonly kind: "structural" };

/** The structural surface's claims, indexed for the walk over generated rows. */
interface StructuralClaimIndex {
  /** Public member names the structural surface owns. */
  readonly members: Map<string, EffectMemberClaim>;
  /** Fixed keys no generated row may record, by the name claiming each. */
  readonly keys: Map<string, string>;
  /** Fixed keys a structural method declares it shares, by that method's name. */
  readonly sharedKeys: Map<string, string>;
}

/**
 * Records the structural surface's method and key claims so a generated row that
 * collides with one is rejected. A key an identity already claims through its own
 * method is the same fact rather than a duplicate. A key an identity declares it
 * shares is held apart, because a generated row is required to record it.
 */
function claimStructuralIdentity(structural: StructuralScriptClaims): StructuralClaimIndex {
  const members = new Map<string, EffectMemberClaim>();
  const keys = new Map<string, string>();
  const sharedKeys = new Map<string, string>();
  for (const identity of structural.methods) {
    if (identity.method === "") {
      throw new Error("structural effect identity has an empty method");
    }
    if (members.has(identity.method)) {
      throw new Error(`duplicate structural effect method "${identity.method}"`);
    }
    members.set(identity.method, { kind: "structural" });
    if (identity.key === null) {
      continue;
    }
    const owner = keys.get(identity.key) ?? sharedKeys.get(identity.key);
    if (owner !== undefined) {
      throw new Error(
        `duplicate fixed script key "${identity.key}" on ${owner} and ${identity.method}`
      );
    }
    if (identity.sharesKeyWithGenerated === undefined) {
      keys.set(identity.key, identity.method);
    } else {
      sharedKeys.set(identity.key, identity.method);
    }
  }
  for (const key of structural.keys) {
    if (!keys.has(key) && !sharedKeys.has(key)) {
      keys.set(key, STRUCTURAL_KEY_OWNER);
    }
  }
  return { members, keys, sharedKeys };
}

/**
 * Checks the generated rows against each other and against the structural surface's
 * method and key claims, before they become a public committed module.
 * A declared shared key must be recorded by a generated row, so a share left behind
 * by a removed effect fails here rather than misdescribing the public surface.
 * Keeping this validator independent makes malformed policy rows easy to test
 * without loading the full CWT corpus.
 */
export function validateScriptReferences(
  scopes: readonly string[],
  structural: StructuralScriptClaims,
  effects: readonly ScriptEffectReferenceRow[],
  triggers: readonly ScriptTriggerReferenceRow[],
  scopeLinks: readonly ScriptScopeLinkReferenceRow[]
): void {
  const knownScopes = new Set(scopes);
  const { members, keys, sharedKeys } = claimStructuralIdentity(structural);
  const matchedSharedKeys = new Set<string>();
  for (const effect of effects) {
    validateAvailability(effect.availability, knownScopes, `effect ${effect.method}`);
    if (effect.method === "") {
      throw new Error("effect reference has an empty member");
    }
    const prior = members.get(effect.method);
    if (prior?.kind === "structural") {
      throw new Error(`effect member "${effect.method}" collides with a structural effect method`);
    }
    if (prior !== undefined) {
      const contradiction =
        prior.row.kind !== effect.kind ||
        prior.row.key !== effect.key ||
        !sameAvailability(prior.row.availability, effect.availability) ||
        prior.row.signature !== effect.signature ||
        JSON.stringify(prior.row.docs) !== JSON.stringify(effect.docs);
      throw new Error(
        `${contradiction ? "contradictory" : "duplicate"} effect member "${effect.method}"`
      );
    }
    members.set(effect.method, { kind: "generated", row: effect });
    if (effect.key !== undefined) {
      const keyOwner = keys.get(effect.key);
      if (keyOwner !== undefined) {
        throw new Error(
          `duplicate fixed script key "${effect.key}" on ${keyOwner} and ${effect.method}`
        );
      }
      if (sharedKeys.has(effect.key)) {
        matchedSharedKeys.add(effect.key);
      }
      keys.set(effect.key, effect.method);
    }
  }

  for (const [key, method] of sharedKeys) {
    if (!matchedSharedKeys.has(key)) {
      throw new Error(
        `structural method "${method}" shares fixed script key "${key}" with a generated effect that does not exist`
      );
    }
  }

  const triggerMethods = new Map<string, ScriptTriggerReferenceRow>();
  const triggerKeys = new Map<string, ScriptTriggerReferenceRow>();
  for (const trigger of triggers) {
    validateAvailability(trigger.availability, knownScopes, `trigger ${trigger.method}`);
    if (trigger.method === "") {
      throw new Error("trigger reference has an empty method");
    }
    if (trigger.key === "") {
      throw new Error(`trigger ${trigger.method} has an empty key`);
    }
    const methodPrior = triggerMethods.get(trigger.method);
    if (methodPrior !== undefined) {
      const contradiction =
        methodPrior.key !== trigger.key ||
        !sameAvailability(methodPrior.availability, trigger.availability) ||
        methodPrior.signature !== trigger.signature ||
        JSON.stringify(methodPrior.docs) !== JSON.stringify(trigger.docs);
      throw new Error(
        `${contradiction ? "contradictory" : "duplicate"} trigger method "${trigger.method}"`
      );
    }
    triggerMethods.set(trigger.method, trigger);
    const keyPrior = triggerKeys.get(trigger.key);
    if (keyPrior !== undefined) {
      throw new Error(
        `duplicate fixed trigger key "${trigger.key}" on ${keyPrior.method} and ${trigger.method}`
      );
    }
    triggerKeys.set(trigger.key, trigger);
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

function triggerCode(trigger: ScriptTriggerReferenceRow): string {
  return (
    `  { method: ${JSON.stringify(trigger.method)}, key: ${JSON.stringify(trigger.key)}, ` +
    `availability: ${availabilityCode(trigger.availability)}, ` +
    `signature: ${JSON.stringify(trigger.signature)}, docs: ${JSON.stringify(trigger.docs)} },\n`
  );
}

function linkCode(link: ScriptScopeLinkReferenceRow): string {
  return (
    `  { member: ${JSON.stringify(link.member)}, fromScopes: [${link.fromScopes.map((scope) => JSON.stringify(scope)).join(", ")}], ` +
    `toScope: ${JSON.stringify(link.toScope)}, docs: ${JSON.stringify(link.docs)} },\n`
  );
}

/**
 * Validates, sorts, and emits the public script-reference catalog.
 * The emitted catalog appends the hand-written structural rows to the generated ones,
 * so duplicate members, fixed keys, or invalid scope sets across both — including a
 * generated row that collides with a structural method or with a key no structural
 * method declares it shares — fail before committed module text is returned.
 */
export function emitScriptReferences(
  scopes: readonly string[],
  structural: StructuralScriptClaims,
  effects: readonly ScriptEffectReferenceRow[],
  triggers: readonly ScriptTriggerReferenceRow[],
  scopeLinks: readonly ScriptScopeLinkReferenceRow[]
): ScriptReferenceEmission {
  validateScriptReferences(scopes, structural, effects, triggers, scopeLinks);
  const effectRows = [...effects].sort((left, right) => compareStrings(left.method, right.method));
  const triggerRows = [...triggers].sort((left, right) =>
    compareStrings(left.method, right.method)
  );
  const linkRows = [...scopeLinks].sort((left, right) => compareStrings(left.member, right.member));
  const structuralImport =
    'import { STRUCTURAL_EFFECT_REFERENCES } from "../script/effects/structural-reference.ts";\n';
  const code =
    'import type { ScopeName } from "./scopes.ts";\n' +
    structuralImport +
    "\n" +
    docComment([
      "Whether a public script member is available in every scope or only in an exact scope set.",
    ]) +
    "export type ScriptReferenceAvailability =\n" +
    '  | { readonly kind: "universal" }\n' +
    '  | { readonly kind: "scopes"; readonly scopes: readonly ScopeName[] };\n\n' +
    docComment(["Ownership class of a public effect-like method in the script reference."]) +
    'export type ScriptEffectReferenceKind = "effect" | "structural" | "event-fire";\n\n' +
    docComment(["Machine-readable reference data for one public effect-like method."]) +
    "export interface ScriptEffectReference {\n" +
    docComment(["Public TypeScript method name."], "  ") +
    "  readonly method: string;\n" +
    docComment(["Fixed PDXScript key, when the method always records one key."], "  ") +
    "  readonly key?: string;\n" +
    docComment(["Emitter family that owns the method."], "  ") +
    "  readonly kind: ScriptEffectReferenceKind;\n" +
    docComment(["Scopes on which the method is present."], "  ") +
    "  readonly availability: ScriptReferenceAvailability;\n" +
    docComment(["Public call signature without its documentation comment."], "  ") +
    "  readonly signature: string;\n" +
    docComment(["Documentation lines attached to the public method."], "  ") +
    "  readonly docs: readonly string[];\n" +
    "}\n\n" +
    docComment(["Machine-readable reference data for one generated trigger builder."]) +
    "export interface ScriptTriggerReference {\n" +
    docComment(["Public TypeScript builder name."], "  ") +
    "  readonly method: string;\n" +
    docComment(["Fixed PDXScript key recorded by the builder."], "  ") +
    "  readonly key: string;\n" +
    docComment(["Scopes where the trigger key is legal."], "  ") +
    "  readonly availability: ScriptReferenceAvailability;\n" +
    docComment(["Public call signature without its documentation comment."], "  ") +
    "  readonly signature: string;\n" +
    docComment(["Documentation lines attached to the public builder."], "  ") +
    "  readonly docs: readonly string[];\n" +
    "}\n\n" +
    docComment(["Machine-readable reference data for one effect scope-navigation property."]) +
    "export interface ScriptScopeLinkReference {\n" +
    docComment(["Public path property name."], "  ") +
    "  readonly member: string;\n" +
    docComment(["Canonical scopes from which the navigation is valid."], "  ") +
    "  readonly fromScopes: readonly ScopeName[];\n" +
    docComment(["Canonical scope reached by the navigation."], "  ") +
    "  readonly toScope: ScopeName;\n" +
    docComment(["Documentation lines attached to the public property."], "  ") +
    "  readonly docs: readonly string[];\n" +
    "}\n\n" +
    docComment(["Every canonical scope name the reference rows draw their availability from."]) +
    `export const SCRIPT_REFERENCE_SCOPES = ${JSON.stringify(scopes)} as const satisfies readonly ScopeName[];\n\n` +
    docComment([
      "Effect-like methods available through the Stellaris authoring entry point:",
      "the generated builders, followed by the hand-written structural surface.",
    ]) +
    "export const SCRIPT_EFFECT_REFERENCES = [\n" +
    effectRows.map(effectCode).join("") +
    "  ...STRUCTURAL_EFFECT_REFERENCES,\n" +
    "] as const as readonly ScriptEffectReference[];\n\n" +
    docComment([
      "Generated trigger builders available through the Stellaris authoring entry point.",
    ]) +
    "export const SCRIPT_TRIGGER_REFERENCES = [\n" +
    triggerRows.map(triggerCode).join("") +
    "] as const satisfies readonly ScriptTriggerReference[];\n\n" +
    docComment([
      "Scope-navigation properties an effect path exposes, each with the scopes it",
      "navigates from and the scope it reaches.",
    ]) +
    "export const SCRIPT_SCOPE_LINK_REFERENCES = [\n" +
    linkRows.map(linkCode).join("") +
    "] as const satisfies readonly ScriptScopeLinkReference[];\n";
  return {
    code,
    effects: effectRows.length,
    triggers: triggerRows.length,
    scopeLinks: linkRows.length,
  };
}
