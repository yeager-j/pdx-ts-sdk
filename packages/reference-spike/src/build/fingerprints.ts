/**
 * Semantic fingerprints: the difference between guidance that expires and
 * guidance that merely looks old.
 *
 * A curated convention names the contracts and evidence it interprets. Each
 * name resolves here to a canonical slice of the facts — a member's shape,
 * arity, scope, closed value set; a layout's keying and identity field; an
 * observation's counts — hashed. What is deliberately *not* in the slice is
 * everything that moves without meaning anything: member ordering, the
 * emitter's TypeScript spelling, file paths, line numbers, prose. Hashing
 * those would make every Prettier run look like a contract change, which
 * trains a maintainer to rubber-stamp the one that isn't.
 *
 * A last-reviewed date is not modeled at all. A date says somebody looked; it
 * does not say the thing they looked at is still there.
 */

import { createHash } from "node:crypto";

import type { RegistryFacts } from "../facts.ts";
import type { RegistryEvidence } from "./corpus-evidence.ts";

/**
 * Canonical JSON: object keys sorted, arrays left alone.
 *
 * Key order is a serializer detail and must not reach the hash; array order is
 * usually meaning (a scope set, a literal union) and must. Where an array's
 * order is genuinely arbitrary the slice sorts it before it gets here.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);
}

/**
 * A subject the spike knows how to fingerprint.
 *
 * Spelled as a prefixed string so a claim can name one inline and a typo is a
 * throw at build time rather than a silently unwatched dependency:
 *
 * - `member:<key>` — one lowered member's contract
 * - `layout:<key>` — one repeated struct's keying and identity
 * - `arms:<key>` — which declared arms the surface kept and dropped
 * - `absent:<key>` — that no such key is declared or lowered, which is what
 *   guidance about an SDK-authored contract actually depends on: the advice is
 *   wrong the moment the game grows a real field by that name
 * - `subtype:<name>` — which keys a subtype gates, and whether its
 *   discriminator is modeled
 * - `localisation` — the whole set of `<id>`-keyed slots
 * - `evidence:<key>` — one field's committed observations
 */
export type FingerprintSubject = string;

function memberSlice(facts: RegistryFacts, key: string): unknown {
  const member = facts.lowered.find((entry) => entry.key === key);
  if (member === undefined) {
    return { present: false };
  }
  return {
    present: true,
    shape: member.shape,
    repeated: member.repeated,
    wrapped: member.wrapped,
    literals: member.literals,
    scope: member.scope,
    clause: member.clause,
    memberPath: member.memberPath,
    required: isRequired(facts, key),
  };
}

/** A key is required when every declaration of it demands at least one write. */
export function isRequired(facts: RegistryFacts, key: string): boolean {
  const declared = facts.declared.find((entry) => entry.key === key);
  return declared !== undefined && declared.arms.every((arm) => arm.cardinality.min >= 1);
}

function layoutSlice(facts: RegistryFacts, key: string): unknown {
  const layout = facts.repeatedStructs.find((entry) => entry.key === key);
  return layout === undefined
    ? { present: false }
    : { present: true, keying: layout.keying, identityKey: layout.identityKey };
}

function armsSlice(facts: RegistryFacts, key: string): unknown {
  const partial = facts.partialLowerings.find((entry) => entry.key === key);
  const declared = facts.declared.find((entry) => entry.key === key);
  return {
    declaredArms: declared === undefined ? 0 : declared.arms.map((arm) => arm.declaredType),
    dropped: partial === undefined ? [] : partial.droppedArms,
    kept: partial?.keptArm ?? null,
  };
}

function subtypeSlice(facts: RegistryFacts, name: string): unknown {
  const subtype = facts.subtypes.find((entry) => entry.name === name);
  return subtype === undefined
    ? { present: false }
    : {
        present: true,
        gatedKeys: subtype.gatedKeys,
        excludedKeys: subtype.excludedKeys,
        discriminatorModeled: subtype.absentUnless !== null,
      };
}

function evidenceSlice(evidence: RegistryEvidence, key: string): unknown {
  const field = evidence.fields.find((entry) => entry.key === key);
  return field === undefined
    ? { observed: false }
    : {
        observed: true,
        definitions: field.definitions,
        scalars: field.scalars,
        blocks: field.blocks,
        repeated: field.repeated,
        belowPresenceFloor: field.belowPresenceFloor,
      };
}

/**
 * Resolves one subject to its fingerprint.
 *
 * Throws on a subject it does not recognize. A guidance dependency naming
 * something the fingerprinter cannot compute is a dependency that would never
 * fire, and silently accepting it is exactly the stale-curation failure the
 * mechanism exists to prevent.
 */
export function fingerprintOf(
  subject: FingerprintSubject,
  facts: RegistryFacts,
  evidence: RegistryEvidence
): string {
  const separator = subject.indexOf(":");
  const kind = separator === -1 ? subject : subject.slice(0, separator);
  const name = separator === -1 ? "" : subject.slice(separator + 1);
  switch (kind) {
    case "member":
      return digest(memberSlice(facts, name));
    case "layout":
      return digest(layoutSlice(facts, name));
    case "arms":
      return digest(armsSlice(facts, name));
    case "absent":
      return digest({
        declared: facts.declared.some((entry) => entry.key === name),
        lowered: facts.lowered.some((entry) => entry.key === name),
      });
    case "subtype":
      return digest(subtypeSlice(facts, name));
    case "localisation":
      return digest(facts.localisation);
    case "evidence":
      return digest(evidenceSlice(evidence, name));
    default:
      throw new Error(
        `no fingerprint is defined for guidance subject "${subject}" — a dependency the ` +
          "fingerprinter cannot compute would never invalidate anything, which is worse than " +
          "having no dependency at all"
      );
  }
}
