/**
 * What supports this page, at the foot of it.
 *
 * Extracted from `App.tsx`, where it and `SdkContracts` were defined inline
 * beside the shell's own header and navigation. That was fine for one viewer
 * and wrong the moment there were two: both are derived components the MDX
 * calls by name, exactly like `<Claim>` and `<FieldTable>`, and the only reason
 * they lived in the shell was that the shell was the first place they were
 * needed. The Starlight port could not import them from there without dragging
 * `MDXProvider` and the whole React app in behind them.
 *
 * So they are components now, in the directory the other derived components are
 * in, and both viewers import them.
 */

import type { ReferenceBuild } from "../../build.ts";

/**
 * The five source versions this build's claims rest on.
 *
 * All five, always. Evidence extracted from one game build, against rules
 * vendored at one commit, against documentation dumped for one release, is not
 * interchangeable with the same evidence from another.
 */
export function Identity({ build }: { build: ReferenceBuild }) {
  const rows: readonly (readonly [string, string])[] = [
    ["SDK", build.identity.sdkVersion],
    ["CWT rules", build.identity.cwtCommit.slice(0, 12)],
    ["Game docs", build.identity.docsRevision],
    ["Corpus", `Stellaris ${build.identity.corpusGameVersion}`],
    ["Vanilla ids", build.identity.vanillaIdsVersion],
  ];
  return (
    <div
      data-testid="build-identity"
      data-not-typeset
      className="not-typeset flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {rows.map(([label, value]) => (
        <span key={label}>
          {label} <span className="font-mono text-foreground">{value}</span>
        </span>
      ))}
    </div>
  );
}

export function EvidenceSummary({ build }: { build: ReferenceBuild }) {
  const dependencies = build.conventions.reduce(
    (total, convention) => total + convention.guidance.length,
    0
  );
  const recipes = build.stories.filter((story) => story.origin === "recipe").length;
  return (
    <div className="my-5 space-y-3 text-sm">
      <Identity build={build} />
      <p className="text-muted-foreground">
        Corpus observations come from {build.evidence.definitions} shipped {build.registry}{" "}
        definitions across {build.evidence.files} files in Stellaris {build.evidence.gameVersion},
        fingerprint{" "}
        <span className="font-mono text-xs">{build.evidence.fingerprint.slice(0, 16)}</span>. They
        record what the game writes — never that a form is generally legal, and never that you
        should copy it.
      </p>
      <p className="text-muted-foreground">
        This page was written in <span className="font-mono text-xs">{build.page}</span>. Its{" "}
        {build.stories.length} stories were compiled and synthesized
        {recipes === 0
          ? ", all of them hand-written on the page"
          : `, ${recipes} of them rendered by the Recipe Catalog rather than written here`}
        ; its {build.claims.length} derived claims were projected from the authoring model; its{" "}
        {build.conventions.length} curated conventions declare {dependencies} guidance dependencies
        between them. A change to a depended-on contract fails the documentation gate, a change to
        depended-on evidence raises a review item, and no last-reviewed date is recorded because it
        would not mean anything.
      </p>
    </div>
  );
}
