import {
  effectAnchor,
  type EffectCategory,
  type EffectsIndexModel,
  type ScopeLinkTarget,
} from "./effects-index.ts";
import type { FieldRow, FieldTableModel } from "./field-table.ts";
import type { PairedExampleData } from "./paired-example-data.ts";
import type { Coverage } from "./registry-coverage.ts";
import type {
  EventKindRow,
  ScopeReferenceModel,
  ScopeTransitionRow,
  ScriptMethodRow,
} from "./scope-reference.ts";
import {
  describeTraditionTreeTemplate,
  TRADITION_TREE_TEMPLATES,
} from "./tradition-tree-templates.ts";

/**
 * Markdown renderings of the generated components, for the LLM text export.
 *
 * The HTML site renders these components from derived models; a naive
 * markdown export would carry only their JSX tags, leaving the reference
 * pages without their actual content. These functions render the same models
 * as plain Markdown, so `/llms-full.txt` and the per-page `.md` routes carry
 * the same derived truth as the pages.
 */

/** `|` starts a new cell and a raw newline breaks the row; escape both. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  return [
    line(header),
    line(header.map(() => "---")),
    ...rows.map((row) => line(row.map(cell))),
  ].join("\n");
}

function fieldNotes(row: FieldRow): string {
  const parts = [...row.docs];
  if (row.literals !== undefined) {
    parts.push(`One of: ${row.literals.map((literal) => `\`${literal}\``).join(", ")}.`);
  }
  if (row.refTypes !== undefined) {
    parts.push(`References ${row.refTypes.map((ref) => `\`${ref}\``).join(", ")} ids.`);
  }
  return parts.join(" ");
}

function fieldRowsTable(rows: readonly FieldRow[]): string {
  return table(
    ["Member", "Game key", "Type", "Notes"],
    rows.map((row) => [
      `\`${row.member}\`${row.optional ? "" : " (required)"}`,
      row.key === undefined ? "none" : `\`${row.key}\``,
      `\`${row.type}\``,
      fieldNotes(row),
    ])
  );
}

function localisationTable(slots: FieldTableModel["localisation"]): string {
  return table(
    ["Member", "Key pattern", "Required"],
    slots.map((slot) => [
      `\`${slot.member}\``,
      `\`${slot.pattern}\``,
      slot.required
        ? "yes"
        : slot.requiredUnless !== undefined
          ? `unless \`${slot.requiredUnless}\` is set`
          : "no",
    ])
  );
}

const OMISSION_LABELS = {
  declined: "not supported deliberately",
  unsupported: "not supported yet",
  collapsed: "collapsed",
} as const;

export function fieldTableMarkdown(model: FieldTableModel): string {
  const sections: string[] = [fieldRowsTable(model.rows)];

  if (model.localisation.length > 0) {
    sections.push(
      "### Localization slots",
      "Text members emitted to localization rather than into the definition body. The pattern's `$` is the definition's id.",
      localisationTable(model.localisation)
    );
  }

  for (const sub of model.subTables) {
    sections.push(`### \`${sub.title}\` fields`, fieldRowsTable(sub.rows));
    if (sub.localisation !== undefined) {
      sections.push(
        "Each entry also has localization members; the pattern's `$` is the entry's own key.",
        localisationTable(sub.localisation)
      );
    }
  }

  if (model.omissions.length > 0) {
    sections.push(
      "### Fields the SDK does not author",
      model.omissions
        .map((row) => `- \`${row.path}\` — *${OMISSION_LABELS[row.kind]}*: ${row.reason}`)
        .join("\n")
    );
  }

  return sections.join("\n\n");
}

export function pairedExampleMarkdown(name: string, data: PairedExampleData): string {
  const sections = [
    `**Example \`${name}\` (TypeScript):**`,
    "```ts",
    data.source,
    "```",
    "**The PDXScript it renders:**",
  ];
  for (const file of data.files) {
    sections.push(`\`${file.path}\`:`, `\`\`\`${file.lang}`, file.text, "```");
  }
  return sections.join("\n\n");
}

function methodTable(rows: readonly ScriptMethodRow[]): string {
  return table(
    ["Method", "Game key", "TypeScript signature", "Notes"],
    rows.map((row) => [
      `[\`${row.method}\`](/scopes-and-effects/effects/#${effectAnchor(row.method)})`,
      row.key === undefined ? "none" : `\`${row.key}\``,
      `\`${row.signature}\``,
      row.summary,
    ])
  );
}

function scopeTarget(target: ScopeLinkTarget): string {
  return target.href === undefined
    ? `\`${target.scope}\``
    : `[\`${target.scope}\`](${target.href})`;
}

const CATEGORY_LABELS: Record<EffectCategory, string> = {
  effect: "effect",
  structural: "structural",
  "event-fire": "event fire",
};

/**
 * The effects index as one full-inventory table. The page paginates and
 * filters its rows behind client JavaScript, so this export — not the HTML —
 * is the surface that carries every method in one readable piece.
 */
export function effectsIndexMarkdown(model: EffectsIndexModel): string {
  return [
    `${model.counts.effect} ordinary effects, ${model.counts.structural} structural methods, and ${model.counts.eventFire} event-fire methods. Availability is either every scope or the explicit list named here; an event-fire method's body scope is where the fired event runs, which the availability column does not say.`,
    `Universal methods are available on every generated scope interface. Published scope pages: ${model.scopePages.map(scopeTarget).join(", ")}.`,
    table(
      [
        "Method",
        "Anchor",
        "Game key",
        "Category",
        "Availability",
        "Event body scope",
        "TypeScript signature",
        "Notes",
      ],
      model.entries.map((entry) => [
        `\`${entry.method}\``,
        `#${entry.anchor}`,
        entry.key === undefined ? "none" : `\`${entry.key}\``,
        CATEGORY_LABELS[entry.category],
        entry.availability.kind === "universal"
          ? "Every scope"
          : entry.availability.scopes.map(scopeTarget).join(", "),
        entry.eventBodyScope === undefined ? "none" : scopeTarget(entry.eventBodyScope),
        `\`${entry.signature}\``,
        entry.summary,
      ])
    ),
  ].join("\n\n");
}

export function scopeIdentityMarkdown(model: ScopeReferenceModel): string {
  return [
    `- Scope literal: \`${model.scope}\``,
    `- Generated SDK interface: \`${model.interfaceName}\``,
  ].join("\n");
}

export function eventKindsMarkdown(rows: readonly EventKindRow[]): string {
  if (rows.length === 0) {
    return "The SDK generates no event kind whose body runs in this scope.";
  }
  return table(
    ["Event kind", "Generated subtype"],
    rows.map((row) => [`\`${row.key}\``, `\`${row.subtype}\``])
  );
}

export function scopeEffectsMarkdown(model: ScopeReferenceModel): string {
  const sections = [
    `[${model.universalEffects.length} universal effects](/scopes-and-effects/effects/) are available on every scope interface and listed once in List of Effects.`,
  ];
  if (model.scopeEffects.length === 0) {
    sections.push("This scope adds no scope-specific ordinary effects beyond the universal set.");
  } else {
    sections.push("**Ordinary effects specific to this scope:**", methodTable(model.scopeEffects));
  }
  return sections.join("\n\n");
}

export function structuralMethodsMarkdown(model: ScopeReferenceModel): string {
  return methodTable(model.structuralMethods);
}

export function eventFireMethodsMarkdown(model: ScopeReferenceModel): string {
  if (model.eventFireMethods.length === 0) {
    return "The generated interface has no legal event-fire method.";
  }
  return methodTable(model.eventFireMethods);
}

export function scopeTransitionsMarkdown(rows: readonly ScopeTransitionRow[]): string {
  if (rows.length === 0) {
    return "The generated interface exposes no outgoing scope-link property.";
  }
  return table(
    ["Property", "Landing scope", "Generated interface", "Notes"],
    rows.map((row) => [
      `\`${row.member}\``,
      `\`${row.toScope}\``,
      `\`${row.toInterface}\``,
      row.summary,
    ])
  );
}

export function coverageMarkdown(coverage: Coverage): string {
  return [
    "### Content registries",
    table(
      ["Registry", "Call", "Game folder", "Reference"],
      coverage.registries.map((row) => [
        `\`${row.registry}\``,
        `\`mod.${row.method}\``,
        `\`${row.folder}\``,
        row.page !== undefined
          ? `[${row.page.title}](${row.page.href})`
          : `Not written yet (${row.undocumented ?? ""})`,
      ])
    ),
    "### Channels",
    table(
      ["Concept", "Call", "Game folder", "What it is"],
      coverage.channels.map((channel) => [
        channel.concept,
        channel.methods.map((method) => `\`${method}\``).join(", "),
        channel.folders.length === 0
          ? "Wherever you place them"
          : channel.folders.map((folder) => `\`${folder}\``).join(", "),
        channel.summary,
      ])
    ),
    `### Not supported yet (Stellaris ${coverage.gameVersion})`,
    coverage.unsupported.map((folder) => `- \`${folder}\``).join("\n"),
  ].join("\n\n");
}

export function traditionTemplatesMarkdown(): string {
  return TRADITION_TREE_TEMPLATES.map(
    (template) => `- \`${template.name}\` — ${describeTraditionTreeTemplate(template)}.`
  ).join("\n");
}
