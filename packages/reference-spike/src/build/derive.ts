/**
 * The small readings every page's claim builder does, in one place.
 *
 * Each of these turns part of the probed model into a fragment of a sentence:
 * what scope a member runs in, where the rules declare it, how much of the
 * shipped game writes it. They started as private helpers inside the Situation
 * page's curation module, which is exactly where a second page found them —
 * copied, or reached for and not there.
 *
 * They are deliberately fragments rather than sentences. A whole generated
 * sentence is a page's own voice and belongs with that page's claims; the
 * reading underneath it is arithmetic and belongs here.
 */

import type { RegistryFacts } from "../facts.ts";
import type { RegistryEvidence } from "./corpus-evidence.ts";

/** What a page needs to say about itself while quoting the model. */
export interface PageVoice {
  /** The page's own id, for the error a broken claim raises. */
  readonly id: string;
  /** The rule file the registry is declared in. */
  readonly cwtSource: string;
  /** How the page names its definitions in a count: `shipped technologies`. */
  readonly definitionNoun: string;
}

export interface Derivations {
  /** One lowered member, refusing to be quiet when the surface stopped lowering it. */
  member(key: string): RegistryFacts["lowered"][number];
  /** One field's committed observations, or `undefined` when the game writes it nowhere. */
  observation(key: string): RegistryEvidence["fields"][number] | undefined;
  /** `1 of 90 shipped situation types`, or an honest sentence when none do. */
  share(key: string): string;
  /** `…/situations.cwt:252`, or the file alone when the key is declared elsewhere. */
  declarationSite(key: string): string | null;
  /** A member's scope, as the clause of a sentence that names it. */
  scopeText(scope: RegistryFacts["lowered"][number]["scope"]): string;
}

export function derivations(
  facts: RegistryFacts,
  evidence: RegistryEvidence,
  voice: PageVoice
): Derivations {
  const observation = (key: string) => evidence.fields.find((field) => field.key === key);
  return {
    observation,
    member(key) {
      const found = facts.lowered.find((entry) => entry.key === key);
      if (found === undefined) {
        throw new Error(
          `the ${voice.id} page claims something about "${key}", and the probed authoring model ` +
            "no longer lowers it — the claim has to be rewritten or dropped, not silently skipped"
        );
      }
      return found;
    },
    share(key) {
      const field = observation(key);
      const total = evidence.definitions;
      return field === undefined
        ? `none of the ${total} ${voice.definitionNoun}`
        : `${field.definitions} of the ${total} ${voice.definitionNoun}`;
    },
    declarationSite(key) {
      const line = facts.declared.find((entry) => entry.key === key)?.arms[0]?.line;
      return line === undefined ? null : `${voice.cwtSource}:${line}`;
    },
    scopeText(scope) {
      if (scope === null) {
        return "no scope";
      }
      if (scope === "any") {
        return "an unpinned scope";
      }
      if (Array.isArray(scope)) {
        return scope.join(" or ");
      }
      return `one of ${(scope as { parameter: readonly string[] }).parameter.join(", ")}`;
    },
  };
}
