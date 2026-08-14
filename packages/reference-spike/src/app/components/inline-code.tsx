/**
 * Renders the one piece of markup claim text is allowed to carry: `backticks`.
 *
 * A full markdown renderer would be a dependency and an injection surface for
 * one feature nobody asked for. Claim prose names members and PDXScript keys
 * constantly, and those need to look like code; nothing else does.
 */

import { Fragment } from "react";

export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/g).map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
          >
            {part}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}
