/**
 * A story: the code, and the PDXScript it produced.
 *
 * The output half is the closest thing this reference has to Storybook's
 * canvas. There is no live Stellaris to render into, but there is an exact
 * artifact — the bytes the fold wrote — and showing it beside the source is how
 * a reader who knows TypeScript and not Stellaris learns the mapping between
 * the two. It teaches by repetition across small cases rather than by prose
 * describing what would happen.
 *
 * Nothing executes here. The code is text to copy; the viewer runs no
 * TypeScript, which is the only honest position for an offline page with no
 * toolchain behind it.
 */

import { useState } from "react";

import type { Story } from "../../build.ts";
import { Badge, Toggle } from "./ui/primitives.tsx";

/** One story's build-time syntax highlighting, when the build produced any. */
export interface StoryColours {
  readonly code: string;
  readonly output: Readonly<Record<string, string>>;
}

/**
 * Renders a snippet, coloured if the build managed to colour it.
 *
 * `dangerouslySetInnerHTML` is doing exactly what its name warns about, and it
 * is safe here for a reason worth stating rather than assuming: the HTML was
 * produced at build time by Shiki, from text that came out of this repository's
 * own MDX and its own serializer. Nothing a reader supplies reaches it — the
 * viewer has no inputs — and Shiki escapes the source it highlights.
 *
 * The plain-text fallback is not dead code. A snippet whose language has no
 * grammar, or a story added since the last build, still has to render.
 */
function Code({ text, html, testId }: { text: string; html?: string; testId: string }) {
  const shared =
    "max-h-[30rem] overflow-auto rounded-lg border border-border bg-muted/50 p-4 text-xs leading-relaxed";
  if (html === undefined) {
    return (
      <pre data-testid={testId} className={shared}>
        <code className="font-mono">{text}</code>
      </pre>
    );
  }
  return (
    <div
      data-testid={testId}
      className={shared}
      // eslint-disable-next-line react/no-danger -- build-time Shiki output, see above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** `common/situations/tide_swell.txt` → `tide_swell.txt`, for a readable tab. */
function shortPath(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function StoryPanel({
  story,
  highlighted,
}: {
  story: Story | undefined;
  highlighted: StoryColours | undefined;
}) {
  const outputs = Object.keys(story?.output ?? {}).filter((path) => path !== "descriptor.mod");
  const [view, setView] = useState<string>("source");

  if (story === undefined) {
    return null;
  }

  return (
    <div
      data-testid={`story-${story.id}`}
      data-not-typeset
      className="not-typeset my-6 rounded-xl border border-border"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium">{story.title}</span>
        {/*
          The two origins carry different promises, so they get different
          badges. "Verified" means this page wrote it and the gates run it;
          "From a Recipe" means `create-stellaris-mod` wrote it, the gates run
          it, and it is what a new project actually receives.
        */}
        <Badge tone={story.origin === "recipe" ? "curated" : "contract"}>
          {story.origin === "recipe" ? "From a Recipe" : "Verified"}
        </Badge>
        <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground">
          {story.source}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        <Toggle active={view === "source"} onClick={() => setView("source")}>
          Source
        </Toggle>
        {outputs.map((path) => (
          <Toggle key={path} active={view === path} onClick={() => setView(path)}>
            {shortPath(path)}
          </Toggle>
        ))}
      </div>
      <div className="p-4">
        {view === "source" ? (
          <Code text={story.code} html={highlighted?.code} testId={`story-source-${story.id}`} />
        ) : (
          <>
            <p className="mb-2 font-mono text-[0.7rem] text-muted-foreground">{view}</p>
            <Code
              text={story.output[view] ?? ""}
              html={highlighted?.output[view]}
              testId={`story-output-${story.id}`}
            />
          </>
        )}
      </div>
    </div>
  );
}
