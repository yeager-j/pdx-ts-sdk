/**
 * Joining a curated convention's two halves: the prose a person wrote, and the
 * fingerprints that decide when it has expired.
 *
 * Nothing here is page-specific, and it used to live in the Situation page's
 * own curation module — which is where it stopped being obvious that the
 * machine half of a convention has nothing to do with which registry the
 * convention is about. A page supplies its declarations and its parsed prose;
 * everything else is the same for every page there will ever be.
 *
 * The two halves are joined rather than stored together on purpose. A
 * convention whose declaration exists with no prose is a badge with nothing
 * under it; prose with no declaration is advice nothing is watching. Both are
 * refused, loudly, at assembly.
 */

import type { ConventionDeclaration } from "../../content/conventions.ts";
import type { CuratedConvention } from "../build.ts";
import type { GuidanceDependency } from "../claims.ts";
import type { RegistryFacts } from "../facts.ts";
import type { RegistryEvidence } from "./corpus-evidence.ts";
import { fingerprintOf } from "./fingerprints.ts";
import type { ParsedConvention } from "./mdx.ts";

/**
 * Resolves a convention's declared dependency subjects into fingerprints.
 *
 * Written as a helper rather than inline so every curated convention is forced
 * through the same path: a subject the fingerprinter does not recognize throws
 * here, at build time, instead of becoming a dependency that quietly never
 * fires.
 */
function dependencies(
  subjects: readonly { subject: string; kind: "contract" | "evidence" }[],
  facts: RegistryFacts,
  evidence: RegistryEvidence
): GuidanceDependency[] {
  return subjects.map((entry) => ({
    subject: entry.subject,
    kind: entry.kind,
    fingerprint: fingerprintOf(entry.subject, facts, evidence),
  }));
}

export function curatedConventions(
  declarations: readonly ConventionDeclaration[],
  facts: RegistryFacts,
  evidence: RegistryEvidence,
  prose: readonly ParsedConvention[],
  pagePath: string
): CuratedConvention[] {
  const byId = new Map(prose.map((entry) => [entry.id, entry.text]));
  const orphaned = prose.filter(
    (entry) => !declarations.some((declaration) => declaration.id === entry.id)
  );
  if (orphaned.length > 0) {
    throw new Error(
      `${pagePath} writes conventions with no declaration: ${orphaned
        .map((entry) => entry.id)
        .join(", ")} — advice with no declared dependencies is advice nothing invalidates, so ` +
        "add a row to content/conventions.ts or delete the block"
    );
  }

  return declarations.map((declaration) => {
    const text = byId.get(declaration.id);
    if (text === undefined || text === "") {
      throw new Error(
        `convention "${declaration.id}" is declared but ${pagePath} never writes it — a curated ` +
          "convention with no prose renders as an empty callout, which reads as an omission"
      );
    }
    return {
      id: declaration.id,
      subject: declaration.subject,
      status: "curated-convention" as const,
      text,
      provenance: [
        { kind: "maintainer" as const, source: pagePath },
        ...declaration.cites.map((cite) => ({
          kind: cite.kind,
          source: cite.source,
          ...(cite.detail === undefined ? {} : { detail: cite.detail }),
        })),
      ],
      guidance: dependencies(declaration.dependsOn, facts, evidence),
    };
  });
}
