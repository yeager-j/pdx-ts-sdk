/**
 * One Reference page.
 *
 * The narrative is not in this file. It lives in the page's own MDX, which is
 * the point of the format: the page is writing, and writing belongs somewhere a
 * person can write it. What is here is the frame — the header, the search, the
 * navigation — plus the components the MDX splices derived material in with.
 *
 * That division is the same one the page makes to its reader. Prose is
 * authored, components are derived, stories are executed. A `<Claim>` renders a
 * sentence generated from the probed facts; a `<Convention>` wraps prose
 * somebody wrote in the machine half that keeps it honest; a `<StoryPanel>`
 * shows code that really compiled beside the PDXScript it really produced.
 *
 * Nothing below names a page. It is handed one, which is what let a second page
 * arrive without the frame learning anything about it.
 */

import { MDXProvider } from "@mdx-js/react";
import type { ReactNode } from "react";
import highlighted from "virtual:highlighted-stories";

import type { ReferenceBuild } from "../build.ts";
import { Claim, Convention } from "./components/claim.tsx";
import { FieldTable } from "./components/field-table.tsx";
import { InlineCode } from "./components/inline-code.tsx";
import { SearchPanel } from "./components/search-panel.tsx";
import { StoryPanel } from "./components/story-panel.tsx";
import { Badge, Card } from "./components/ui/primitives.tsx";
import { PAGE_PARAM, VIEWER_PAGES, type ViewerPage } from "./pages.tsx";

function Identity({ build }: { build: ReferenceBuild }) {
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

function SdkContracts({ build }: { build: ReferenceBuild }) {
  return (
    <div data-not-typeset className="not-typeset my-5 space-y-3">
      {build.sdkContracts.map((contract) => (
        <Card key={contract.member} className="p-4" data-testid={`sdk-contract-${contract.member}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{contract.member}</span>
            <Badge tone="contract">SDK-authored</Badge>
            <Badge>{contract.serialized ? "reaches the output" : "emits nothing"}</Badge>
          </div>
          <p className="text-sm leading-relaxed">
            <InlineCode text={contract.statement} />
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium">Why the rules cannot say this: </span>
            <InlineCode text={contract.whyNotDerived} />
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{contract.source}</p>
        </Card>
      ))}
    </div>
  );
}

function EvidenceSummary({ build }: { build: ReferenceBuild }) {
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

/** The other pages this build carries, as ordinary links. */
function PageTabs({ current }: { current: ViewerPage }) {
  return (
    <nav data-testid="page-tabs" className="flex flex-wrap gap-1.5">
      {VIEWER_PAGES.map((page) => (
        <a
          key={page.id}
          href={`?${PAGE_PARAM}=${page.id}`}
          aria-current={page.id === current.id ? "page" : undefined}
          className={
            page.id === current.id
              ? "rounded-md border border-foreground/30 bg-foreground px-2.5 py-1 text-xs font-medium text-background"
              : "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          }
        >
          {page.build.title}
        </a>
      ))}
    </nav>
  );
}

export function App({ page }: { page: ViewerPage }) {
  const { build, Content } = page;
  // Claims that stand on their own, and the observations that support them.
  // The split is what keeps corpus counts out of the reading flow and inside
  // the evidence of the claim they are evidence for.
  const claims = new Map(
    build.claims.filter((claim) => claim.supports === undefined).map((claim) => [claim.id, claim])
  );
  const supporting = new Map<string, (typeof build.claims)[number][]>();
  for (const claim of build.claims) {
    if (claim.supports !== undefined) {
      supporting.set(claim.supports, [...(supporting.get(claim.supports) ?? []), claim]);
    }
  }
  const conventions = new Map(build.conventions.map((entry) => [entry.id, entry]));
  const stories = new Map(build.stories.map((story) => [story.id, story]));
  const colours = highlighted[page.id] ?? {};

  // Only components that carry derived material. Headings, paragraphs, lists
  // and inline code are markdown, and Typeset styles them — a component whose
  // job was structure or styling would be duplicating the stylesheet.
  const components = {
    Claim: ({ id }: { id: string }) => (
      <Claim claim={claims.get(id)} supporting={supporting.get(id)} />
    ),
    Convention: ({ id, children }: { id: string; children?: ReactNode }) => (
      <Convention convention={conventions.get(id)}>{children}</Convention>
    ),
    StoryPanel: ({ id }: { id: string }) => (
      <StoryPanel story={stories.get(id)} highlighted={colours[id]} />
    ),
    FieldTable: () => <FieldTable fields={build.fields} />,
    SdkContracts: () => <SdkContracts build={build} />,
    EvidenceSummary: () => <EvidenceSummary build={build} />,
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24">
      <header className="sticky top-0 z-10 -mx-5 mb-8 border-b border-border bg-background px-5 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{build.title}</h1>
            <p className="text-sm text-muted-foreground">{build.summary}</p>
          </div>
          <Badge tone="unresolved">Reference spike — not a product</Badge>
        </div>
        <div className="mb-2">
          <PageTabs current={page} />
        </div>
        <SearchPanel build={build} />
      </header>

      <nav className="mb-10 flex flex-wrap gap-2 text-sm">
        {build.sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {section.title}
          </a>
        ))}
      </nav>

      {/*
        Typeset owns the authored markdown and nothing else. Every derived
        component inside opts out with `not-typeset`, so the two never fight
        over the same element — the prose gets the rhythm, the machinery keeps
        its own layout.
      */}
      <main className="typeset typeset-docs max-w-[46em] m-auto">
        <MDXProvider components={components}>
          <Content />
        </MDXProvider>
      </main>
    </div>
  );
}
