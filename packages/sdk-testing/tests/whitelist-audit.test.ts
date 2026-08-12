/**
 * The standing re-audit gate for the interpreter's whitelist (SDK-140).
 *
 * The creed this package is built on — a wrong emulator is worse than no
 * emulator — had no mechanism behind it: the notes were a one-shot manual
 * reading, and nothing made a game patch reopen them. `num_owned_planets` was
 * the proof, deprecated in the very dump this repository vendors and modeled
 * here as though it were not.
 *
 * So this is `packages/codegen-vanilla/tests/callsites.test.ts`'s shape applied
 * to the whitelist: every entry pins the paragraph it was audited against, and
 * a revendored dump has to answer for each one. It cannot tell a right note
 * from a wrong one — only a maintainer reading the paragraph can — but it can
 * make sure nobody gets to skip the reading.
 */

import { SUPPORTED_STELLARIS_BUILD } from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import {
  AUDITED_DOC_DUMP,
  COMBINATOR_SEMANTICS,
  EFFECT_SEMANTICS,
  ITERATOR_SEMANTICS,
  LINK_SEMANTICS,
  LIVE_CALIBRATION_BUILD,
  STRUCTURAL_SEMANTICS,
  TRIGGER_SEMANTICS,
  type DocPin,
} from "../src/whitelist.ts";
import { readVendoredDocDump, type DumpName } from "./doc-dump.ts";

interface Pinned {
  readonly category: string;
  readonly dump: DumpName;
  readonly key: string;
  readonly note: string;
  readonly docs: DocPin;
}

function pinsOf(
  category: string,
  dump: DumpName,
  table: Readonly<Record<string, { readonly note: string; readonly docs: DocPin }>>
): Pinned[] {
  return Object.entries(table).map(([key, { note, docs }]) => ({
    category,
    dump,
    key,
    note,
    docs,
  }));
}

/**
 * Which log a category is audited against is a property of the category, not
 * of the entry: the dumps split by what a key *is* (a trigger, an effect, a
 * scope link), and iterators are dumped with the effects.
 */
const PINNED: readonly Pinned[] = [
  ...pinsOf("trigger", "triggers", TRIGGER_SEMANTICS),
  ...pinsOf("combinator", "triggers", COMBINATOR_SEMANTICS),
  ...pinsOf("effect", "effects", EFFECT_SEMANTICS),
  ...pinsOf("structural", "effects", STRUCTURAL_SEMANTICS),
  ...pinsOf("iterator", "effects", ITERATOR_SEMANTICS),
  ...pinsOf("link", "scopes", LINK_SEMANTICS),
];

const dump = readVendoredDocDump();

describe("whitelist audit", () => {
  it("was audited against the dump the repository actually vendors", () => {
    // The crack this gate was built for: the notes claimed a 4.4.6 calibration
    // while `script-docs/` held v4.4.1, and nothing anywhere compared them.
    expect(dump.version).toBe(AUDITED_DOC_DUMP);
  });

  it("keeps the live in-game records level with the verified build", () => {
    // No hash can re-verify an observation that lives in a game log, so the
    // one claim the dumps cannot settle is pinned to the build instead:
    // verifying against a newer Stellaris reopens `examples/from-oracle/
    // calibration` rather than letting the note age out of sight.
    expect(LIVE_CALIBRATION_BUILD).toBe(SUPPORTED_STELLARIS_BUILD);
  });

  it("measures every category, so a green run is not an empty one", () => {
    expect(new Set(PINNED.map(({ category }) => category))).toEqual(
      new Set(["trigger", "combinator", "effect", "structural", "iterator", "link"])
    );
    expect(PINNED.length).toBeGreaterThanOrEqual(40);
  });

  it("lets a leaf structural reuse its effect's pin rather than restating it", () => {
    expect(STRUCTURAL_SEMANTICS.add_resource.docs).toBe(EFFECT_SEMANTICS.add_resource!.docs);
    expect(STRUCTURAL_SEMANTICS.save_event_target_as.docs).toBe(
      EFFECT_SEMANTICS.save_event_target_as!.docs
    );
  });

  describe.each(PINNED)("$category $key", ({ dump: dumpName, key, note, docs }) => {
    const name = docs.name ?? key;
    const block = dump.blocks[dumpName].get(name);

    it("pins a paragraph that is still in the dump", () => {
      expect(
        block,
        `${name} has no ${dumpName}.log paragraph — the dump renamed or dropped it, so the note ` +
          `below is defending semantics nothing documents any more:\n${note}`
      ).toBeDefined();
    });

    it("pins the paragraph the note was read from", () => {
      expect(
        block?.sha,
        `${name}'s ${dumpName}.log paragraph changed. Read it, confirm the note still holds, ` +
          `then re-pin:\n\n${block?.text ?? "(missing)"}\n\nCurrent note:\n${note}`
      ).toBe(docs.sha);
    });

    it("acknowledges the dump's deprecation marker, or carries none", () => {
      if (block?.deprecated === true) {
        expect(
          docs.deprecated,
          `${name} is deprecated in ${dumpName}.log and the whitelist does not say so. Model the ` +
            `replacement, or record why this entry stays:\n\n${block.text}`
        ).toBeTruthy();
      } else {
        expect(
          docs.deprecated,
          `${name} carries a deprecation acknowledgement but its ${dumpName}.log paragraph no ` +
            `longer marks it deprecated — drop the acknowledgement.`
        ).toBeUndefined();
      }
    });

    it("defends itself in a note", () => {
      expect(note.trim()).not.toBe("");
    });
  });
});
