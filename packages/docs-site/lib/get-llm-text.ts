import { renderPlaceholder } from "fumadocs-core/mdx-plugins/remark-llms.runtime";

import { coveragePages } from "@/lib/coverage-pages";
import { scopePages } from "@/lib/scope-pages";
import type { source } from "@/lib/source";
import { buildEffectsIndex } from "@/src/effects-index";
import { buildFieldTable } from "@/src/field-table";
import {
  coverageMarkdown,
  effectsIndexMarkdown,
  eventFireMethodsMarkdown,
  eventKindsMarkdown,
  fieldTableMarkdown,
  pairedExampleMarkdown,
  scopeEffectsMarkdown,
  scopeIdentityMarkdown,
  scopeTransitionsMarkdown,
  scopeTriggersMarkdown,
  structuralMethodsMarkdown,
  traditionTemplatesMarkdown,
  triggersIndexMarkdown,
} from "@/src/llm-markdown";
import { pairedExample } from "@/src/paired-examples-manifest";
import { buildCoverage } from "@/src/registry-coverage";
import { buildScopeReference, type ScopeReferenceModel } from "@/src/scope-reference";
import { buildTriggersIndex } from "@/src/triggers-index";

type Page = (typeof source)["$inferPage"];

/**
 * One page as Markdown, for `/llms-full.txt` and the per-page `.md` routes.
 *
 * The processed Markdown carries placeholders for the generated components
 * (see `lib/source.ts`); each is re-rendered here from the same derived
 * model the page renders, so the text export carries the actual tables and
 * examples. A placeholder whose attributes name no usable model degrades to a
 * note instead of an empty tag.
 */
export async function getLLMText(page: Page): Promise<string> {
  const rendered = await renderPlaceholder(
    await page.data.getText("processed"),
    renderersFor(page)
  );
  return `# ${page.data.title} (${page.url})\n\n${rendered}`;
}

function note(name: string): string {
  return `*[The interactive ${name} component is omitted from this text export; see the page.]*`;
}

/**
 * The scope pages compute `buildScopeReference("<scope>")` in MDX and pass
 * it by expression, which a placeholder cannot carry — but the page's own
 * slug names the scope, so the renderer rebuilds the same model.
 */
function scopeModelOf(page: Page): ScopeReferenceModel | undefined {
  const [section, group, scope] = page.slugs;
  if (section !== "scopes-and-effects" || group !== "scopes" || scope === undefined) {
    return undefined;
  }
  try {
    return buildScopeReference(scope);
  } catch {
    return undefined;
  }
}

function renderersFor(page: Page): Parameters<typeof renderPlaceholder>[1] {
  let scopeModel: ScopeReferenceModel | undefined;
  let scopeModelResolved = false;
  const withScopeModel = (name: string, render: (model: ScopeReferenceModel) => string): string => {
    if (!scopeModelResolved) {
      scopeModel = scopeModelOf(page);
      scopeModelResolved = true;
    }
    return scopeModel === undefined ? note(name) : render(scopeModel);
  };

  return {
    Callout: ({ attributes, children }) => {
      const title = typeof attributes.title === "string" ? `**${attributes.title}:** ` : "";
      return `${title}${children}`
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    },
    FieldTable: ({ attributes }) => {
      const registry = attributes.registry;
      if (typeof registry !== "string") return note("FieldTable");
      return fieldTableMarkdown(buildFieldTable(registry));
    },
    PairedExample: async ({ attributes }) => {
      const name = attributes.name;
      if (typeof name !== "string") return note("PairedExample");
      return pairedExampleMarkdown(name, await pairedExample(name));
    },
    RegistryCoverage: () => coverageMarkdown(buildCoverage(coveragePages())),
    TraditionTreeTemplates: () => traditionTemplatesMarkdown(),
    ScopeIdentity: () => withScopeModel("ScopeIdentity", scopeIdentityMarkdown),
    ScopeEffects: () => withScopeModel("ScopeEffects", scopeEffectsMarkdown),
    ScopeTriggers: () => withScopeModel("ScopeTriggers", scopeTriggersMarkdown),
    ScopeTransitions: () =>
      withScopeModel("ScopeTransitions", (model) => scopeTransitionsMarkdown(model.transitions)),
    StructuralMethods: () => withScopeModel("StructuralMethods", structuralMethodsMarkdown),
    EventKinds: () => withScopeModel("EventKinds", (model) => eventKindsMarkdown(model.eventKinds)),
    EventFireMethods: () => withScopeModel("EventFireMethods", eventFireMethodsMarkdown),
    EffectsIndex: () => effectsIndexMarkdown(buildEffectsIndex(scopePages())),
    TriggersIndex: () => triggersIndexMarkdown(buildTriggersIndex(scopePages())),
  };
}
