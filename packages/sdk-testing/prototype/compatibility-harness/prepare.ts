import type { PreparedScript } from "./contract.ts";
import { scripts } from "./scenario.ts";

/** Fixed engine definitions for all adapters; no invocation scalar is inserted into these bytes. */
export const preparedScripts: Readonly<Record<string, PreparedScript>> = Object.fromEntries(
  Object.entries(scripts).map(([name, script], index) => {
    const definitionId = `sdk446.${index + 1}`;
    const body =
      script.kind === "condition"
        ? `trigger = { ${script.body} }`
        : `immediate = {\nlog = "SDK446:${definitionId}:start"\n${script.body}\nlog = "SDK446:${definitionId}:end"\n}`;
    const definition = `${script.scope}_event = {\nid = ${definitionId}\nis_triggered_only = yes\nhide_window = yes\n${body}\n}\n`;
    return [name, { ...script, definitionId, definition }];
  })
);
