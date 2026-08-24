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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@pdx-ts/pdxscript";
import { locateInstall } from "@pdx-ts/sdk/installation";
import { EVENT_FIELD_SUPPORT, scopeLinkOutput } from "@pdx-ts/sdk/internals";
import { SUPPORTED_STELLARIS_BUILD } from "@pdx-ts/sdk/reference";
import { describe, expect, it } from "vitest";

import {
  AUDITED_DOC_DUMP,
  COMBINATOR_SEMANTICS,
  EFFECT_SEMANTICS,
  EVENT_FIELD_DELIVERY,
  eventFieldDeliveryFor,
  ITERATOR_SEMANTICS,
  LINK_SEMANTICS,
  LIVE_CALIBRATION_BUILD,
  STORAGE_CAPACITY_CLAIM,
  STORAGE_CAPACITY_SOURCE,
  STRUCTURAL_SEMANTICS,
  TRIGGER_SEMANTICS,
  type DocPin,
} from "../src/whitelist.ts";
import { readVendoredDocDump, type DumpName } from "./doc-dump.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

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

  it("keeps the live in-game record level with the verified build", () => {
    // No hash can re-verify an observation that lives in a game log, so the
    // one claim the dumps cannot settle is pinned to the build instead:
    // verifying against a newer Stellaris reopens `examples/from-oracle/
    // calibration` rather than letting the note age out of sight.
    expect(LIVE_CALIBRATION_BUILD).toBe(SUPPORTED_STELLARIS_BUILD);
  });

  it("hears that from the calibration record itself, not only from the constant", () => {
    // Pinned from both sides on purpose: bumping the constant is one edit, and
    // an edit is not a rerun. The probe's own record has to report the same
    // build, so re-blessing the claim means going back to the game.
    const record = fs.readFileSync(
      path.join(ROOT, "examples/from-oracle/calibration/README.md"),
      "utf8"
    );
    const reported = /Status: complete on Stellaris \w+ (\d+\.\d+\.\d+)/.exec(record)?.[1];

    expect(
      reported,
      `examples/from-oracle/calibration reports ${reported ?? "no build"}, but the whitelist ` +
        `claims its observation holds on ${LIVE_CALIBRATION_BUILD}. Re-run the probe and update ` +
        `its record, or put the constant back.`
    ).toBe(LIVE_CALIBRATION_BUILD);
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

describe("the link table names real links", () => {
  // The dump pins say each note was read from the paragraph it claims. This
  // says the key it claims is navigation at all — read from the SDK's own link
  // vocabulary, which is generated from `links.cwt`, so a whitelist entry
  // cannot quietly model a link the rules do not declare.
  it("models no navigation the rules do not declare, bar the one keyword that is not a link", () => {
    // `from` is a scope keyword the SDK writes itself (`ctx.from`), not a row
    // in `links.cwt` — so it is the one entry with no link vocabulary behind
    // it, and naming it here keeps that an exception rather than a hole.
    expect(Object.keys(LINK_SEMANTICS).filter((key) => scopeLinkOutput(key) === undefined)).toEqual(
      ["from"]
    );
  });

  it("resolves owner to the scope the rules say it lands in", () => {
    expect(scopeLinkOutput("owner")).toBe("country");
  });
});

describe("event delivery covers every field the SDK can emit", () => {
  // The compile-time half of this claim is `defineEventFieldDelivery`'s
  // exhaustiveness over the same policy. This is the runtime half: a table
  // built from a widened `EVENT_FIELD_SUPPORT` would still have to answer for
  // every key, and a key the SDK stopped emitting would have to leave.
  const emittable = EVENT_FIELD_SUPPORT.filter(
    ({ disposition }) => disposition !== "unsupported"
  ).map(({ scriptKey }) => scriptKey);

  it("says what delivery does with each of them, and with nothing else", () => {
    expect(new Set(Object.keys(EVENT_FIELD_DELIVERY))).toEqual(new Set(emittable));
  });

  it("defends every disposition in a note", () => {
    expect(
      Object.entries(EVENT_FIELD_DELIVERY)
        .filter(([, { note }]) => note.trim() === "")
        .map(([key]) => key)
    ).toEqual([]);
  });

  it("delivers exactly one field, so `immediate` cannot lose that status quietly", () => {
    expect(
      Object.entries(EVENT_FIELD_DELIVERY)
        .filter(([, { disposition }]) => disposition === "delivered")
        .map(([key]) => key)
    ).toEqual(["immediate"]);
  });

  it("enforces the one flag whose repeat delivery refuses", () => {
    expect(
      Object.entries(EVENT_FIELD_DELIVERY)
        .filter(([, { disposition }]) => disposition === "once")
        .map(([key]) => key)
    ).toEqual(["fire_only_once"]);
  });

  it("answers an Object.prototype member with 'no disposition', not with the member", () => {
    // The lookup takes a key read out of recorded script, and the branch that
    // consumes `undefined` is the one that refuses unknown fields — a bare
    // index would turn that refusal into an acceptance.
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(eventFieldDeliveryFor(key)).toBeUndefined();
    }
  });

  it("refuses the blocks that carry script delivery never reaches", () => {
    expect(
      Object.entries(EVENT_FIELD_DELIVERY)
        .filter(([, { disposition }]) => disposition === "refused")
        .map(([key]) => key)
        .sort()
    ).toEqual(["abort_effect", "abort_trigger", "after", "trigger"]);
  });
});

/**
 * `add_resource`'s bound is the one modeled semantic the dumps do not settle
 * and no game log records: the paragraph says only that the effect adds to a
 * stockpile. Its evidence is the game's own resource definitions, so that is
 * where the gate goes looking — install-gated like
 * `packages/codegen-vanilla/tests/callsites.test.ts`, for the same reason: CI
 * has no Stellaris, and a measurement of the game cannot be faked into
 * existence. Maintainer-local, and run before accepting a new game build.
 */
let installRoot: string | undefined;
try {
  installRoot = locateInstall();
} catch {
  installRoot = undefined;
}

describe.skipIf(installRoot === undefined)("storage capacity, against the install", () => {
  const source = (): string =>
    fs.readFileSync(path.join(installRoot!, STORAGE_CAPACITY_SOURCE), "utf8");

  it("still calls `max` the resource's maximum storage capacity", () => {
    // The whole of what add_resource's clamp asserts: a stockpile is bounded
    // above, and `max` is the bound. Reword this upstream and the note needs
    // re-reading — which is exactly when this should go red.
    expect(
      source(),
      `${STORAGE_CAPACITY_SOURCE} no longer describes max as the "${STORAGE_CAPACITY_CLAIM}". ` +
        `add_resource's note defends its clamp on that wording; re-read the file before trusting it.`
    ).toContain(STORAGE_CAPACITY_CLAIM);
  });

  it("still declares a capacity on the basic resources", () => {
    // Guards the wording check above from passing on a file where `max` has
    // become a comment nothing uses.
    const declared = parse(source()).items.flatMap((item) => {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        return [];
      }
      const hasMax = item.value.items.some(
        (field) => field.kind === "entry" && field.key === "max"
      );
      return hasMax ? [item.key] : [];
    });

    expect(declared).toContain("energy");
    expect(declared).toContain("minerals");
  });
});
