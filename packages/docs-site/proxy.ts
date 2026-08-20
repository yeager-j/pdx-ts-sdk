import { isMarkdownPreferred } from "fumadocs-core/negotiation";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Content negotiation for AI agents: a request for a docs page whose
 * `Accept` header prefers Markdown is rewritten to the page's Markdown twin
 * under `/llms.mdx/`.
 *
 * The rewritten response carries `Vary: Accept`. The plain HTML branch
 * cannot: Next.js owns the `Vary` header on page responses and discards any
 * value set here or in `next.config` `headers()` (verified empirically).
 * On Vercel that is harmless for its own CDN — the proxy runs before the
 * cache and a rewrite changes the cache key, so the two representations
 * never share an entry. A downstream shared cache without that behavior
 * could in theory serve cached HTML to an agent; `/llms.txt` therefore
 * links the explicit `/llms.mdx/<path>/content.md` URLs, which need no
 * negotiation at all.
 */
export default function proxy(request: NextRequest) {
  if (isMarkdownPreferred(request)) {
    const pathname = request.nextUrl.pathname.replace(/\/$/, "");
    return NextResponse.rewrite(new URL(`/llms.mdx${pathname}/content.md`, request.nextUrl), {
      headers: { Vary: "Accept" },
    });
  }

  return NextResponse.next();
}

export const config = {
  // Docs pages only: skip Next internals, the search API, the LLM text
  // routes themselves, and static files (anything with an extension).
  matcher: ["/((?!_next|api|llms\\.|llms-full|.*\\..*).*)"],
};
