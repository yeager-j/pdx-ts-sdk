/**
 * Every Reference build this viewer carries, addressed by page id.
 *
 * The React viewer keeps the same list in `src/app/pages.tsx`, and for the same
 * reason: a bundler cannot follow a path out of a data structure, so a snapshot
 * has to be reached by a literal `import`. `tests/pages.test.ts` already fails
 * when that list disagrees with `src/build/pages.ts`, and this list is checked
 * the same way.
 *
 * Imported rather than fetched, so `dist/` is one immutable Reference build
 * with no service behind it — the same property the first viewer has, and the
 * one the offline product boundary rests on.
 *
 * Browser-safe, and that is load-bearing rather than incidental. This module is
 * reached from `ReferenceSearch.tsx`, which is a hydrated island, so everything
 * it imports is bundled for the client. It held `coloursOf` until that shipped
 * nine megabytes of TextMate grammars to a page that renders two languages —
 * see `highlighting.ts`.
 */

import situationSnapshot from "../../data/situation-reference.json" with { type: "json" };
import technologySnapshot from "../../data/technology-reference.json" with { type: "json" };
import type { ReferenceBuild } from "../../src/build.ts";
import type { ReferenceClaim } from "../../src/claims.ts";

export const BUILDS: Readonly<Record<string, ReferenceBuild>> = {
  situations: situationSnapshot as unknown as ReferenceBuild,
  technology: technologySnapshot as unknown as ReferenceBuild,
};

export function buildOf(page: string): ReferenceBuild {
  const build = BUILDS[page];
  if (build === undefined) {
    throw new Error(
      `no Reference build is called "${page}" — known pages: ${Object.keys(BUILDS).join(", ")}`
    );
  }
  return build;
}

/**
 * Claims that stand on their own, and the observations that support them.
 *
 * The same split the React viewer makes, and the reason is the reader's rather
 * than the machine's: a corpus count is evidence *for* a claim, not a claim, so
 * it renders inside that claim's evidence disclosure instead of interrupting
 * the prose with a badge of its own.
 */
export function claimsOf(build: ReferenceBuild): {
  readonly claims: ReadonlyMap<string, ReferenceClaim>;
  readonly supporting: ReadonlyMap<string, readonly ReferenceClaim[]>;
} {
  const claims = new Map(
    build.claims.filter((claim) => claim.supports === undefined).map((claim) => [claim.id, claim])
  );
  const supporting = new Map<string, ReferenceClaim[]>();
  for (const claim of build.claims) {
    if (claim.supports !== undefined) {
      supporting.set(claim.supports, [...(supporting.get(claim.supports) ?? []), claim]);
    }
  }
  return { claims, supporting };
}
