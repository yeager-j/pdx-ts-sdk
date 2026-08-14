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

import { Claim, Convention } from "./components/claim.tsx";
import { EvidenceSummary } from "./components/evidence-summary.tsx";
import { FieldTable } from "./components/field-table.tsx";
import { SdkContracts } from "./components/sdk-contracts.tsx";
import { SearchPanel } from "./components/search-panel.tsx";
import { StoryPanel } from "./components/story-panel.tsx";
import { Badge } from "./components/ui/primitives.tsx";
import { PAGE_PARAM, VIEWER_PAGES, type ViewerPage } from "./pages.tsx";

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
