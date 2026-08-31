/**
 * Generic field lowering (`content/lower.ts`) and the specialized block
 * encoders (`content/blocks.ts`) descend the same context, and each used to
 * carry its own copy of the four policies that govern it. Neither was the
 * authority, so a change to where a diagnostic points or to what an owner
 * token is could be made in one and missed in the other — and the copies had
 * already drifted: the block encoders' `childContext` dropped the sinks it did
 * not read itself (SDK-336).
 *
 * The behaviour below is what the one owner promises. The source gate after it
 * is what keeps a second copy from coming back.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  childContext,
  collectRefs,
  descOwnerKey,
  joinPath,
  type LoweringContext,
} from "../src/content/lowering-context.ts";
import type { RecordedRefUse } from "../src/references.ts";

const SOURCE_ROOT = "packages/sdk/src";
const OWNER = "packages/sdk/src/content/lowering-context.ts";

/** A context with every optional member set, so a dropped one is visible. */
function fullContext(): LoweringContext {
  return {
    collect: () => undefined,
    collectPath: () => undefined,
    path: "outer",
    ownerId: "mod_thing",
    localization: { into: [], warn: () => undefined, warned: new Set() },
    unresolvedKeys: true,
  };
}

describe("childContext", () => {
  it("carries every sink down, so a level cannot disarm what sits below it", () => {
    const parent = fullContext();
    const child = childContext(parent, "inner");

    expect(child.collect).toBe(parent.collect);
    expect(child.collectPath).toBe(parent.collectPath);
    expect(child.localization).toBe(parent.localization);
    expect(child.unresolvedKeys).toBe(true);
  });

  it("extends the diagnostic path by one segment", () => {
    expect(childContext(fullContext(), "inner").path).toBe("outer.inner");
  });

  it("keeps the enclosing identity unless the level mints one", () => {
    expect(childContext(fullContext(), "inner").ownerId).toBe("mod_thing");
    expect(childContext(fullContext(), "inner", "mod_entry").ownerId).toBe("mod_entry");
  });
});

describe("joinPath", () => {
  it("treats an empty segment as no step and an empty path as the root", () => {
    expect(joinPath("outer", "")).toBe("outer");
    expect(joinPath("", "inner")).toBe("inner");
    expect(joinPath("outer", "inner")).toBe("outer.inner");
  });
});

describe("descOwnerKey", () => {
  it("composes the enclosing identity with the field's own key", () => {
    expect(descOwnerKey(fullContext(), "ai_weight")).toBe("mod_thing::ai_weight");
  });
});

describe("collectRefs", () => {
  it("re-roots a recorded reference under the field that holds it", () => {
    const collected: RecordedRefUse[] = [];
    const ctx: LoweringContext = {
      collect: (use) => collected.push(use),
      path: "outer",
      ownerId: "x",
    };

    collectRefs(
      ctx,
      [{ targets: ["technology"], id: "tech_lasers_1", field: "limit" }],
      "modifier"
    );

    expect(collected).toEqual([
      { targets: ["technology"], id: "tech_lasers_1", field: "outer.modifier.limit" },
    ]);
  });

  it("reports nothing when the context collects nothing", () => {
    expect(() =>
      collectRefs(
        { path: "outer", ownerId: "x" },
        [{ targets: ["technology"], id: "tech_lasers_1", field: "limit" }],
        "modifier"
      )
    ).not.toThrow();
  });
});

/**
 * The ownership guard, scoped to the modules that actually take part.
 *
 * Deliberately not a scan of `src` for the bare names: `joinPath` and
 * `collectRefs` are ordinary names, and a future module that needs its own
 * unrelated helper called one of them would fail a repo-wide check while
 * neither importing nor copying this policy. A participant is a module that
 * mentions `LoweringContext`, which is exactly the set the ticket is about,
 * and the claim made of each is the one the ticket makes: consume the owner's
 * policy rather than declare your own.
 */
describe("the lowering-context policy has one owner", () => {
  const declarations = [
    /\binterface LoweringContext\b/,
    /\bfunction childContext\b/,
    /\bfunction joinPath\b/,
    /\bfunction descOwnerKey\b/,
    /\bfunction collectRefs\b/,
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    });
  }

  /** Every module that takes part in a lowering context, besides the owner. */
  function participants(): { path: string; source: string }[] {
    return sourceFiles(SOURCE_ROOT)
      .filter((path) => path.replaceAll("\\", "/") !== OWNER)
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      .filter(({ source }) => source.includes("LoweringContext"));
  }

  it("has participants to check, so the guard cannot pass by scanning nothing", () => {
    expect(participants().map(({ path }) => path.replaceAll("\\", "/"))).toEqual(
      expect.arrayContaining([
        "packages/sdk/src/content/lower.ts",
        "packages/sdk/src/content/blocks.ts",
        "packages/sdk/src/installation/vanilla/patch.ts",
      ])
    );
  });

  it("has every participant import the policy rather than declare it", () => {
    const offenders = participants()
      .filter(({ source }) => !source.includes('lowering-context.ts"'))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("declares each policy in exactly one module", () => {
    const redeclaring = participants()
      .filter(({ source }) => declarations.some((pattern) => pattern.test(source)))
      .map(({ path }) => path);

    expect(redeclaring).toEqual([]);
  });
});
