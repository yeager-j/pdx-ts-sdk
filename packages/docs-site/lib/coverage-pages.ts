import { source } from "@/lib/source";
import type { ReferencePage } from "@/src/registry-coverage";

/**
 * The site's pages as the coverage gate needs to see them. Fumadocs routes a
 * docs entry by its slugs under the site root, so the id and URL are built
 * here rather than in the gate: this module knows how the site is routed,
 * and the gate should not have to. Shared by the `RegistryCoverage`
 * component and the LLM text export so both feed the gate identically.
 */
export function coveragePages(): ReferencePage[] {
  return source.getPages().map((page) => ({
    id: page.slugs.join("/") || "index",
    href: `${page.url.replace(/\/$/, "")}/`,
    title: page.data.title,
    registries: page.data.registries,
  }));
}
