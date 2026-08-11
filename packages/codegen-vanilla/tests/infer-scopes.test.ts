import { parse, type PdxItem } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { inferScopes } from "../src/infer-scopes.ts";
import type { ScriptedDefinition } from "../src/read-scripted.ts";

function definition(name: string, body: string): ScriptedDefinition {
  const parsed = parse(`${name} = { ${body} }`, `${name}.txt`);
  const item = parsed.items[0];
  if (item?.kind !== "entry" || item.value.kind !== "container") {
    throw new Error(`fixture ${name} did not parse as a definition`);
  }
  return {
    name,
    params: [],
    body: item.value.items as readonly PdxItem[],
    source: `${name}.txt`,
    ordinal: 0,
  };
}

const EMPTY_FACTS = {
  triggers: new Map(),
  effects: new Map(),
  links: new Map(),
};

describe("scope diagnostic attribution", () => {
  it("belongs to the definition containing the key regardless of traversal order", () => {
    const caller = definition("caller", "callee = yes");
    const callee = definition("callee", "never_declared = yes");

    const measure = (definitions: readonly ScriptedDefinition[]) =>
      Object.fromEntries(
        inferScopes(EMPTY_FACTS, { trigger: definitions, effect: [] }).trigger.map((one) => [
          one.name,
          { scopes: one.scopes, diagnostics: one.diagnostics },
        ])
      );

    const forward = measure([caller, callee]);
    const reverse = measure([callee, caller]);

    expect(forward).toEqual(reverse);
    expect(forward).toEqual({
      caller: { scopes: "universal", diagnostics: [] },
      callee: {
        scopes: "universal",
        diagnostics: [{ kind: "unknown-key", detail: "never_declared" }],
      },
    });
  });
});
