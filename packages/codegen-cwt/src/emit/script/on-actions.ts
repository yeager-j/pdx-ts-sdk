import { scopeIndex, type OnActionDecl, type RuleSet } from "../../cwt/rules.ts";
import { camelCase, docComment, isPlainName } from "../../naming.ts";

export interface OnActionsEmission {
  readonly code: string;
  readonly emitted: number;
  readonly skipped: readonly string[];
  readonly noScope: number;
}

interface LoweredOnAction {
  readonly name: string;
  readonly member: string;
  readonly scope: string | null;
  readonly from: string | undefined;
  readonly docs: readonly string[];
}

export function emitOnActions(rules: RuleSet): OnActionsEmission {
  const scopes = scopeIndex(rules);
  const lowered: LoweredOnAction[] = [];
  const skipped: string[] = [];

  for (const hook of rules.onActions) {
    const result = lower(hook, scopes);
    if (typeof result === "string") {
      skipped.push(`${hook.name} — ${result}`);
    } else {
      lowered.push(result);
    }
  }

  const members = lowered
    .map((hook) => {
      const docs = docComment(hook.docs, "  ");
      const scope = hook.scope === null ? "null" : JSON.stringify(hook.scope);
      const from = hook.from === undefined ? "undefined" : JSON.stringify(hook.from);
      return (
        docs +
        `  ${hook.member}: {\n` +
        '    kind: "on-action-ref",\n' +
        `    name: ${JSON.stringify(hook.name)},\n` +
        `    scope: ${scope},\n` +
        `    from: ${from},\n` +
        "  },\n"
      );
    })
    .join("");

  return {
    code:
      'import type { OnActionRef } from "../events/on-actions.ts";\n\n' +
      docComment([
        "Named Stellaris on-actions generated from `config/on_actions.cwt`.",
        "Scopeless hooks are present but cannot be registered until the SDK has a scopeless event kind.",
      ]) +
      "export const onActions = {\n" +
      members +
      "} as const satisfies Record<string, OnActionRef>;\n",
    emitted: lowered.length,
    skipped,
    noScope: lowered.filter((hook) => hook.scope === null).length,
  };
}

function lower(hook: OnActionDecl, scopes: ReadonlyMap<string, string>): LoweredOnAction | string {
  if (!isPlainName(hook.name)) {
    return "name is not a plain on-action identifier";
  }
  if (hook.eventType === null) {
    return "missing event_type metadata";
  }
  const rawThis = hook.scopes.get("this");
  if (rawThis === undefined) {
    return "missing replace_scopes.this metadata";
  }

  const noScope = rawThis === "no_scope";
  const scope = noScope ? null : scopes.get(normalize(rawThis));
  if (!noScope && scope === undefined) {
    return `unknown this scope ${rawThis}`;
  }
  if (noScope && hook.eventType !== "scopeless") {
    return `no_scope metadata disagrees with event_type ${hook.eventType}`;
  }
  if (!noScope) {
    const eventScope = scopes.get(normalize(hook.eventType));
    if (eventScope === undefined) {
      return `unknown event_type scope ${hook.eventType}`;
    }
    if (eventScope !== scope) {
      return `this scope ${String(scope)} disagrees with event_type ${eventScope}`;
    }
  }

  const rawFrom = hook.scopes.get("from");
  const from =
    rawFrom === undefined || rawFrom === "no_scope" ? undefined : scopes.get(normalize(rawFrom));
  if (rawFrom !== undefined && rawFrom !== "no_scope" && from === undefined) {
    return `unknown FROM scope ${rawFrom}`;
  }

  return {
    name: hook.name,
    member: camelCase(hook.name),
    scope: scope ?? null,
    from,
    docs: hook.docs,
  };
}

function normalize(scope: string): string {
  return scope.toLowerCase().replaceAll(" ", "_");
}
