import { notFound } from "next/navigation";

import { getLLMText } from "@/lib/get-llm-text";
import { pageMarkdownSegments, source } from "@/lib/source";

export const revalidate = false;

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  // Drop the appended "content.md" segment; it exists so the static export
  // writes a real file per page.
  const page = source.getPage(slug?.slice(0, -1));
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: { "Content-Type": "text/markdown" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: pageMarkdownSegments(page),
  }));
}
