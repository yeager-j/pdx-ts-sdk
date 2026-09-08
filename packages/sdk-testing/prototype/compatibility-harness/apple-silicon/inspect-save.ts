import { readFileSync } from "node:fs";

import { parse, type PdxItem, type PdxValue } from "../../../../pdxscript/src/index.ts";

function entries(items: readonly PdxItem[]) {
  return items.filter((item) => item.kind === "entry");
}
function field(items: readonly PdxItem[], key: string): PdxValue | undefined {
  return entries(items).find((item) => item.key === key)?.value;
}
function children(value: PdxValue | undefined): readonly PdxItem[] {
  return value?.kind === "container" ? value.items : [];
}
function scalar(value: PdxValue | undefined): string | boolean | undefined {
  if (value?.kind === "num") return value.lexeme;
  if (value?.kind === "str" || value?.kind === "bool") return value.value;
  return undefined;
}
function table(value: PdxValue | undefined, fields: string[]) {
  return Object.fromEntries(
    entries(children(value))
      .filter((entry) => entry.value.kind === "container")
      .map((entry) => {
        const items = children(entry.value);
        return [
          entry.key,
          {
            ...Object.fromEntries(fields.map((key) => [key, scalar(field(items, key))])),
            flags: entries(children(field(items, "flags"))).map((flag) => flag.key),
            popGroups: children(field(items, "pop_groups"))
              .map((item) => (item.kind === "num" ? item.lexeme : undefined))
              .filter(Boolean),
          },
        ];
      })
  );
}
const document = parse(readFileSync(process.argv[2]!, "utf8"));
const rows = document.items;
const player = children(field(rows, "player"))[0];
const planets = table(field(children(field(rows, "planets")), "planet"), [
  "colony",
  "owner",
  "planet_class",
  "solar_system",
]);
console.log(
  JSON.stringify({
    diagnostics: document.diagnostics,
    version: scalar(field(rows, "version")),
    date: scalar(field(rows, "date")),
    player: player?.kind === "container" ? scalar(field(player.items, "country")) : undefined,
    countries: table(field(rows, "country"), ["type", "capital"]),
    planets,
    colonies: table(field(rows, "colony"), ["planet", "owner"]),
    pops: table(field(rows, "pop_groups"), ["planet", "size", "killed"]),
    targets: entries(rows)
      .filter((row) => row.key === "saved_event_target")
      .map((row) =>
        Object.fromEntries(
          ["name", "type", "id"].map((key) => [key, scalar(field(children(row.value), key))])
        )
      )
      .filter((target) => String(target.name).startsWith("sdk446_")),
  })
);
