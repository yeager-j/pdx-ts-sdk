import { createHighlighter, type Highlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { GRAMMARS } from "./pdx-languages.ts";

/**
 * The one Shiki instance for code computed at render time.
 *
 * Fenced code in MDX is highlighted by the loader, configured in
 * `source.config.ts`; code built from strings (the paired examples) is
 * highlighted here. Both use the same grammars, themes, and engine, so the
 * two kinds of block cannot drift.
 *
 * This is a direct Shiki instance rather than fumadocs'
 * `highlight()`/`ServerCodeBlock`, because that path re-resolves languages by
 * bundle name and rejects any custom grammar, loaded or not
 * (fumadocs-core's `highlightHast` calls `loadLanguage("pdxscript")` with the
 * string name, which Shiki's bundle refuses).
 */

export const HIGHLIGHT_THEMES = {
  light: "catppuccin-latte",
  dark: "catppuccin-mocha",
} as const;

let instance: Promise<Highlighter> | undefined;

/** The shared highlighter, created once per runtime. */
export function pdxHighlighter(): Promise<Highlighter> {
  instance ??= createHighlighter({
    langs: ["typescript", GRAMMARS.pdxscript, GRAMMARS.pdxloc],
    themes: [HIGHLIGHT_THEMES.light, HIGHLIGHT_THEMES.dark],
    engine: createJavaScriptRegexEngine(),
  });
  return instance;
}
