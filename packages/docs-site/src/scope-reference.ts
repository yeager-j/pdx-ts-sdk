import { EVENT_KINDS, type ScopeName } from "@pdx-ts/sdk";
import {
  SCRIPT_EFFECT_REFERENCES,
  SCRIPT_REFERENCE_SCOPES,
  SCRIPT_SCOPE_LINK_REFERENCES,
  type ScriptEffectReference,
  type ScriptReferenceAvailability,
  type ScriptScopeLinkReference,
} from "@pdx-ts/sdk/script-reference";

export interface ScriptMethodRow {
  readonly method: string;
  readonly key?: string;
  readonly signature: string;
  readonly docs: readonly string[];
  readonly summary: string;
  readonly availability: ScriptReferenceAvailability;
}

export interface ScopeTransitionRow {
  readonly member: string;
  readonly toScope: ScopeName;
  readonly toInterface: string;
  readonly docs: readonly string[];
  readonly summary: string;
}

export interface EventKindRow {
  readonly key: string;
  readonly subtype: string;
}

export interface ScopeReferenceModel {
  readonly scope: ScopeName;
  readonly interfaceName: string;
  readonly eventKinds: readonly EventKindRow[];
  readonly universalEffects: readonly ScriptMethodRow[];
  readonly scopeEffects: readonly ScriptMethodRow[];
  readonly structuralMethods: readonly ScriptMethodRow[];
  readonly eventFireMethods: readonly ScriptMethodRow[];
  readonly transitions: readonly ScopeTransitionRow[];
}

interface EventKindSource {
  readonly key: string;
  readonly subtype: string;
  readonly scope: ScopeName | null;
}

export interface ScopeReferenceSources {
  readonly scopes: readonly ScopeName[];
  readonly effects: readonly ScriptEffectReference[];
  readonly scopeLinks: readonly ScriptScopeLinkReference[];
  readonly eventKinds: Readonly<Record<string, EventKindSource>>;
}

const DEFAULT_SOURCES: ScopeReferenceSources = {
  scopes: SCRIPT_REFERENCE_SCOPES,
  effects: SCRIPT_EFFECT_REFERENCES,
  scopeLinks: SCRIPT_SCOPE_LINK_REFERENCES,
  eventKinds: EVENT_KINDS,
};

function interfaceNameOf(scope: ScopeName): string {
  const stem = scope
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return `${stem}Scope`;
}

function summaryOf(docs: readonly string[]): string {
  const prose = docs.slice(0, docs.indexOf("```") === -1 ? docs.length : docs.indexOf("```"));
  const summary = prose.filter((line) => line.trim() !== "").join(" ");
  if (summary !== "") {
    return summary;
  }
  return docs.find((line) => line.trim() !== "" && line !== "```") ?? "No generated notes.";
}

function methodRowOf(reference: ScriptEffectReference): ScriptMethodRow {
  return {
    method: reference.method,
    ...(reference.key === undefined ? {} : { key: reference.key }),
    signature: reference.signature,
    docs: reference.docs,
    summary: summaryOf(reference.docs),
    availability: reference.availability,
  };
}

function isLegalOn(reference: ScriptEffectReference, scope: ScopeName): boolean {
  return (
    reference.availability.kind === "universal" || reference.availability.scopes.includes(scope)
  );
}

function assertSources(sources: ScopeReferenceSources): void {
  const knownScopes = new Set(sources.scopes);
  const methods = new Set<string>();
  for (const reference of sources.effects) {
    if (methods.has(reference.method)) {
      throw new Error(
        `Duplicate generated script method "${reference.method}". Each method must have one reference row.`
      );
    }
    methods.add(reference.method);
    if (reference.availability.kind === "scopes") {
      for (const scope of reference.availability.scopes) {
        if (!knownScopes.has(scope)) {
          throw new Error(
            `Script method "${reference.method}" names missing generated scope "${scope}".`
          );
        }
      }
    }
  }

  for (const link of sources.scopeLinks) {
    if (methods.has(link.member)) {
      throw new Error(
        `Scope link "${link.member}" is also classified as a script method. Scope links belong only in transitions.`
      );
    }
    if (!knownScopes.has(link.toScope)) {
      throw new Error(
        `Scope link "${link.member}" lands in missing generated scope "${link.toScope}".`
      );
    }
    for (const scope of link.fromScopes) {
      if (!knownScopes.has(scope)) {
        throw new Error(
          `Scope link "${link.member}" starts in missing generated scope "${scope}".`
        );
      }
    }
  }
}

function assertScope(scope: string, sources: ScopeReferenceSources): asserts scope is ScopeName {
  if (!(sources.scopes as readonly string[]).includes(scope)) {
    throw new Error(
      `No generated scope row for "${scope}". Use a canonical scope from SCRIPT_REFERENCE_SCOPES and run \`npm run codegen\` if the SDK output is stale.`
    );
  }
}

export function buildScopeReference(
  scope: string,
  sources: ScopeReferenceSources = DEFAULT_SOURCES
): ScopeReferenceModel {
  assertScope(scope, sources);
  assertSources(sources);

  const legalMethods = sources.effects.filter((reference) => isLegalOn(reference, scope));
  const ordinaryEffects = legalMethods.filter((reference) => reference.kind === "effect");
  const structuralMethods = legalMethods.filter((reference) => reference.kind === "structural");
  if (ordinaryEffects.length === 0) {
    throw new Error(`No generated ordinary-effect rows are legal on scope "${scope}".`);
  }
  if (structuralMethods.length === 0) {
    throw new Error(`No generated structural-method rows are legal on scope "${scope}".`);
  }

  return {
    scope,
    interfaceName: interfaceNameOf(scope),
    eventKinds: Object.values(sources.eventKinds)
      .filter((eventKind) => eventKind.scope === scope)
      .map(({ key, subtype }) => ({ key, subtype }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    universalEffects: ordinaryEffects
      .filter((reference) => reference.availability.kind === "universal")
      .map(methodRowOf),
    scopeEffects: ordinaryEffects
      .filter((reference) => reference.availability.kind === "scopes")
      .map(methodRowOf),
    structuralMethods: structuralMethods.map(methodRowOf),
    eventFireMethods: legalMethods
      .filter((reference) => reference.kind === "event-fire")
      .map(methodRowOf),
    transitions: sources.scopeLinks
      .filter((reference) => reference.fromScopes.includes(scope))
      .map((reference) => ({
        member: reference.member,
        toScope: reference.toScope,
        toInterface: interfaceNameOf(reference.toScope),
        docs: reference.docs,
        summary: summaryOf(reference.docs),
      })),
  };
}

export function buildEffectPreview(
  methods: readonly string[],
  sources: ScopeReferenceSources = DEFAULT_SOURCES
): readonly ScriptMethodRow[] {
  assertSources(sources);
  return methods.map((method) => {
    const reference = sources.effects.find(
      (candidate) => candidate.kind === "effect" && candidate.method === method
    );
    if (reference === undefined) {
      throw new Error(`No generated ordinary-effect row named "${method}".`);
    }
    return methodRowOf(reference);
  });
}
