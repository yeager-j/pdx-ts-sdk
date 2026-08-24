import { pascalCase } from "@pdx-ts/codegen-cwt/naming";

import { compareIdentifiers, header, type Chokepoint } from "./emit.ts";
import type { VanillaEventDefinition } from "./read-events.ts";

export interface EventTrieEmission {
  readonly files: ReadonlyMap<string, string>;
  readonly export: { readonly name: "VanillaEventTrie"; readonly file: "events/index.ts" };
}

function unique(candidate: string, taken: Set<string>): string {
  let name = candidate;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${candidate}${suffix}`;
    suffix += 1;
  }
  taken.add(name);
  return name;
}

export function emitEventTrie(
  definitions: readonly VanillaEventDefinition[],
  gate: Chokepoint,
  gameVersion: string
): EventTrieEmission {
  const byNamespace = new Map<string, VanillaEventDefinition[]>();
  for (const definition of definitions) {
    const namespace = byNamespace.get(definition.namespace) ?? [];
    namespace.push(definition);
    byNamespace.set(definition.namespace, namespace);
  }

  const files = new Map<string, string>();
  const imports: string[] = [];
  const members: string[] = [];
  const taken = new Set<string>(["VanillaEventTrie"]);

  for (const [namespace, events] of [...byNamespace].sort(([left], [right]) =>
    compareIdentifiers(left, right)
  )) {
    const name = unique(`VanillaEventNamespace${pascalCase(namespace)}`, taken);
    const hasScoped = events.some((event) => event.scope !== null);
    const hasScopeless = events.some((event) => event.scope === null);
    const imported = [hasScoped ? "EventRef" : null, hasScopeless ? "EventScopelessRef" : null]
      .filter((type): type is string => type !== null)
      .join(", ");
    const eventMembers = events.map((event) => {
      // `$` is illegal in a source event id, so it is a collision-free prefix
      // for numeric property names. Validate the source spelling before adding it.
      const checkedLocalId = gate.literal(event.localId, "event local id");
      const navigationKey = /^\d+$/.test(event.localId) ? `$${event.localId}` : checkedLocalId;
      const id = gate.literal(event.id, "event id");
      const reference =
        event.scope === null
          ? "EventScopelessRef"
          : `EventRef<${gate.literal(event.scope, "event scope")}, {}, ${gate.literal(event.subtype, "event subtype")}>`;
      return `readonly ${navigationKey}: ${reference} & { readonly id: ${id} };`;
    });
    const file = `events/${namespace}.ts`;
    files.set(
      file,
      `${header(gameVersion)}import type { ${imported} } from "@pdx-ts/sdk";\n\n` +
        `export interface ${name} {\n${eventMembers.join("\n")}\n}\n`
    );
    imports.push(`import type { ${name} } from "./${namespace}.ts";\n`);
    members.push(`readonly ${gate.literal(namespace, "event namespace")}: ${name};`);
  }

  files.set(
    "events/index.ts",
    header(gameVersion) +
      imports.join("") +
      `\nexport interface VanillaEventTrie {\n${members.join("\n")}\n}\n`
  );
  return { files, export: { name: "VanillaEventTrie", file: "events/index.ts" } };
}
