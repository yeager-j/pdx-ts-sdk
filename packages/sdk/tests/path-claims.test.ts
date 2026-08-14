/**
 * Path-claim adjudication in the fold.
 *
 * The invariant under test is that a `PureMod` which exists is collision-free.
 * Every case here is a way two output files could have ended up at one place on
 * disk — the same name twice, two spellings a case-insensitive volume would
 * merge, a name used as both a file and a directory, a path the SDK or the base
 * game already owns — and the claim is that the fold refuses all of them
 * together, in one error, before any sink can see the mod.
 *
 * Most cases drive `adjudicatePaths` directly. The authoring surface mints
 * every path itself today, so it cannot express most of these collisions; once
 * Asset files let an author name their own path it will, and these fixtures are
 * what that change has to keep satisfying.
 */

import { describe, expect, it } from "vitest";

import { adjudicatePaths, type PathClaim } from "../src/compiler/paths.ts";
import {
  createMod,
  normalizeLogicalPath,
  PathOwnershipError,
  type PathConflictReason,
  type PathOwnershipConflict,
  type PathProducerKind,
} from "../src/index.ts";

function claim(path: string, kind: PathProducerKind = "content", stems: string[] = []): PathClaim {
  return {
    path: normalizeLogicalPath(path),
    producer: { kind, stems, detail: `${kind} at ${path}` },
  };
}

/** The conflict set, or a failure if the claims were somehow legal. */
function conflictsOf(
  claims: readonly PathClaim[],
  vanillaPaths: ReadonlySet<string> = new Set()
): readonly PathOwnershipConflict[] {
  try {
    adjudicatePaths({ claims, vanillaPaths });
  } catch (error) {
    expect(error).toBeInstanceOf(PathOwnershipError);
    return (error as PathOwnershipError).conflicts;
  }
  throw new Error("expected a path ownership conflict");
}

function reasonsAt(
  claims: readonly PathClaim[],
  path: string,
  vanillaPaths: ReadonlySet<string> = new Set()
): PathConflictReason[] {
  return conflictsOf(claims, vanillaPaths)
    .filter((conflict) => conflict.path === path)
    .map((conflict) => conflict.reason);
}

describe("exclusive ownership", () => {
  it("refuses two producers on one path", () => {
    const conflicts = conflictsOf([
      claim("common/technology/a.txt", "content", ["alpha"]),
      claim("common/technology/a.txt", "patch-plan", ["beta"]),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toBe("duplicate");
    expect(conflicts[0]!.claimants.map((claimant) => [claimant.kind, claimant.stems])).toEqual([
      ["content", ["alpha"]],
      ["patch-plan", ["beta"]],
    ]);
  });

  it("refuses a duplicate whose bytes would be identical", () => {
    // The adjudicator never sees payloads, and that is the point: two producers
    // each believing they own the file is the defect, not the bytes disagreeing.
    // Identical content today is a coincidence that changes on the next edit.
    const twice = [claim("common/technology/a.txt"), claim("common/technology/a.txt")];
    expect(reasonsAt(twice, "common/technology/a.txt")).toEqual(["duplicate"]);
  });

  it("accepts one producer per path and hands back enumeration order", () => {
    const adjudicated = adjudicatePaths({
      claims: [claim("common/technology/b.txt"), claim("common/technology/a.txt")],
      vanillaPaths: new Set(),
    });
    expect(adjudicated.map((entry) => entry.path)).toEqual([
      "common/technology/a.txt",
      "common/technology/b.txt",
    ]);
  });
});

describe("portable aliases", () => {
  it("refuses two spellings of one directory", () => {
    const conflicts = conflictsOf([claim("gfx/Foo/a.dds"), claim("gfx/foo/b.dds")]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toBe("portable-alias");
    // The byte-least spelling names the node: an author needs one of the two
    // reported, and picking by content rather than by claim order keeps the
    // message stable across builds.
    expect(conflicts[0]!.path).toBe("gfx/Foo");
    expect(conflicts[0]!.claimants.map((claimant) => claimant.role)).toEqual([
      "directory",
      "directory",
    ]);
  });

  it("refuses two spellings of one file", () => {
    expect(reasonsAt([claim("gfx/A.dds"), claim("gfx/a.dds")], "gfx/A.dds")).toEqual([
      "portable-alias",
    ]);
  });

  it("reports an alias once, at the level where the spellings diverge", () => {
    // `A/deep/x.txt` and `a/deep/x.txt` collide because of their first
    // component and nothing else. Reporting the same fact again at every node
    // below would bury the one rename that fixes it under three repetitions.
    const conflicts = conflictsOf([claim("A/deep/x.txt"), claim("a/deep/x.txt")]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.path).toBe("A");
  });

  it("does not confuse an inherited alias with a duplicate", () => {
    // `A/x.txt` and `a/x.txt` end in the same component, but they are not two
    // claims on one path — the ancestor is the problem, and calling the leaf a
    // duplicate would point the author at the wrong file.
    const conflicts = conflictsOf([claim("A/x.txt"), claim("a/x.txt")]);
    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["portable-alias"]);
  });

  it("refuses two claims only an uppercasing filesystem would collapse", () => {
    // Greek medial and final sigma: distinct under lowercasing, one name under
    // NTFS's uppercase table. Adjudicating by lowercase alone accepted both,
    // and materializing on Windows then wrote two claims to one entry and lost
    // a file's bytes. Claim versus claim, not claim versus a foreign entry —
    // the sink's check is a separate gate and cannot stand in for this one.
    expect(
      reasonsAt([claim("assets/σigma.txt"), claim("assets/ςigma.txt")], "assets/ςigma.txt")
    ).toEqual(["portable-alias"]);
  });

  it("treats a Unicode-form alias as a duplicate, since both mint one path", () => {
    // NFC normalization happens at minting, so a decomposed spelling never
    // reaches the tree as a second spelling; it arrives as the same path.
    const decomposed = claim("gfx/café.dds");
    const composed = claim("gfx/café.dds");
    expect(reasonsAt([decomposed, composed], "gfx/café.dds")).toEqual(["duplicate"]);
  });
});

describe("file and directory", () => {
  it("refuses a name used as both", () => {
    const conflicts = conflictsOf([claim("common"), claim("common/technology/a.txt")]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toBe("file-directory");
    expect(conflicts[0]!.path).toBe("common");
    expect(conflicts[0]!.claimants.map((claimant) => [claimant.path, claimant.role])).toEqual([
      ["common", "file"],
      ["common/technology/a.txt", "directory"],
    ]);
  });

  it("refuses one that only appears through case folding", () => {
    // `COMMON` the file and `common/` the directory are distinct names and one
    // place on a case-insensitive volume. Both facts are reported: the alias
    // says the spellings collapse, the file/directory clash says what breaks.
    expect(reasonsAt([claim("COMMON"), claim("common/a.txt")], "COMMON")).toEqual([
      "portable-alias",
      "file-directory",
    ]);
  });
});

describe("reserved mod-root paths", () => {
  it("lets the descriptor channel own descriptor.mod", () => {
    expect(() =>
      adjudicatePaths({
        claims: [claim("descriptor.mod", "descriptor"), claim("common/technology/a.txt")],
        vanillaPaths: new Set(),
      })
    ).not.toThrow();
  });

  it.each([
    ["the descriptor", "descriptor.mod"],
    ["the descriptor by an alias", "DESCRIPTOR.MOD"],
    ["the ownership manifest", ".pdx-sdk-manifest.json"],
    ["the ownership manifest by an alias", ".PDX-SDK-MANIFEST.JSON"],
    ["a path under the manifest", ".pdx-sdk-manifest.json/child"],
  ])("refuses another producer taking %s", (_label, path) => {
    // Reported at the reserved node, which for a claim *under* one is the
    // reserved path itself rather than the deeper path the author wrote.
    const conflicts = conflictsOf([claim("descriptor.mod", "descriptor"), claim(path)]);
    expect(conflicts.map((conflict) => conflict.reason)).toContain("reserved");
  });

  it("reserves exact paths, not prefixes", () => {
    // A file merely named like a reserved one is ordinary output. Reserving by
    // prefix would refuse names the SDK has no claim on.
    expect(() =>
      adjudicatePaths({
        claims: [claim("descriptor.mod.txt"), claim(".pdx-sdk-manifest.jsonx")],
        vanillaPaths: new Set(),
      })
    ).not.toThrow();
  });

  it("reports a claim under the descriptor as both reserved and a tree clash", () => {
    const reasons = reasonsAt(
      [claim("descriptor.mod", "descriptor"), claim("descriptor.mod/child")],
      "descriptor.mod"
    );
    expect(reasons).toEqual(["reserved", "file-directory"]);
  });
});

describe("vanilla evidence", () => {
  const vanilla = new Set(["common/technology/00_physics_tech.txt"]);

  it("refuses a claim on a path the game already occupies", () => {
    const conflicts = conflictsOf([claim("common/technology/00_physics_tech.txt")], vanilla);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toBe("vanilla");
    expect(conflicts[0]!.claimants.map((claimant) => claimant.kind)).toEqual([
      "content",
      "vanilla",
    ]);
  });

  it("refuses a claim that is only a portable alias of a vanilla path", () => {
    // Comparing exact bytes let this through, and on any case-insensitive
    // volume it replaces the vanilla file wholesale.
    expect(
      reasonsAt(
        [claim("COMMON/technology/00_PHYSICS_TECH.TXT")],
        "COMMON/technology/00_PHYSICS_TECH.TXT",
        vanilla
      )
    ).toEqual(["vanilla"]);
  });

  it("names the vanilla file by its real spelling, not by its folded identity", () => {
    // The identity is what matches; it is not a filename. Reporting the fold of
    // `Straße.txt` would send an author looking for `strasse.txt`, which is
    // nothing on disk — and the same applies to any vanilla path whose case or
    // Unicode form the fold changes.
    const conflicts = conflictsOf([claim("common/Straße.txt")], new Set(["common/Straße.txt"]));
    expect(conflicts[0]!.claimants.map((claimant) => [claimant.kind, claimant.path])).toEqual([
      ["content", "common/Straße.txt"],
      ["vanilla", "common/Straße.txt"],
    ]);
  });

  it("names the reserved path by its real spelling too", () => {
    const conflicts = conflictsOf([claim("DESCRIPTOR.MOD")]);
    expect(conflicts[0]!.claimants.find((claimant) => claimant.kind === "reserved")?.path).toBe(
      "descriptor.mod"
    );
  });

  it("exempts the descriptor, which never lands in the game's own tree", () => {
    expect(() =>
      adjudicatePaths({
        claims: [claim("descriptor.mod", "descriptor")],
        vanillaPaths: new Set(["descriptor.mod"]),
      })
    ).not.toThrow();
  });

  it("an empty inventory checks nothing", () => {
    // `adjudicatePaths` no longer takes an absent-evidence state at all
    // (SDK-173, ADR-0006): a caller with nothing to check passes the empty
    // set, not `undefined`.
    expect(() =>
      adjudicatePaths({
        claims: [claim("common/technology/00_physics_tech.txt")],
        vanillaPaths: new Set(),
      })
    ).not.toThrow();
  });
});

describe("the conflict set", () => {
  // Four claims meeting at one node, each adding a different reason. The point
  // of asserting the whole array is that an author who fixes what the error
  // names should not rebuild into a second error about the same node.
  const crowded = [
    claim("gfx/a.txt", "content", ["one"]),
    claim("gfx/a.txt", "localization", ["two"]),
    claim("gfx/A.txt", "events", ["three"]),
    claim("gfx/a.txt/deep.dds", "patch-plan", ["four"]),
  ];

  it("names every reason holding at a node, and every producer in each", () => {
    expect(conflictsOf(crowded)).toEqual([
      {
        path: "gfx/A.txt",
        reason: "portable-alias",
        claimants: [
          {
            path: "gfx/A.txt",
            kind: "events",
            stems: ["three"],
            detail: "events at gfx/A.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt",
            kind: "content",
            stems: ["one"],
            detail: "content at gfx/a.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt",
            kind: "localization",
            stems: ["two"],
            detail: "localization at gfx/a.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt/deep.dds",
            kind: "patch-plan",
            stems: ["four"],
            detail: "patch-plan at gfx/a.txt/deep.dds",
            role: "directory",
          },
        ],
      },
      {
        path: "gfx/A.txt",
        reason: "file-directory",
        claimants: [
          {
            path: "gfx/A.txt",
            kind: "events",
            stems: ["three"],
            detail: "events at gfx/A.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt",
            kind: "content",
            stems: ["one"],
            detail: "content at gfx/a.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt",
            kind: "localization",
            stems: ["two"],
            detail: "localization at gfx/a.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt/deep.dds",
            kind: "patch-plan",
            stems: ["four"],
            detail: "patch-plan at gfx/a.txt/deep.dds",
            role: "directory",
          },
        ],
      },
      {
        // Keyed on the exact spelling, not the folded node: only the two claims
        // that wrote the same bytes are duplicates of each other.
        path: "gfx/a.txt",
        reason: "duplicate",
        claimants: [
          {
            path: "gfx/a.txt",
            kind: "content",
            stems: ["one"],
            detail: "content at gfx/a.txt",
            role: "file",
          },
          {
            path: "gfx/a.txt",
            kind: "localization",
            stems: ["two"],
            detail: "localization at gfx/a.txt",
            role: "file",
          },
        ],
      },
    ]);
  });

  it("does not depend on the order the claims arrived in", () => {
    // Features are discovered from a directory listing and flattened in
    // authoring order. If either leaked into the report, two authors with the
    // same mod would get different errors from it.
    const base = conflictsOf(crowded);
    let seed = 20260814;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 20; round++) {
      const shuffled = [...crowded];
      for (let index = shuffled.length - 1; index > 0; index--) {
        const swap = Math.floor(next() * (index + 1));
        [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
      }
      expect(conflictsOf(shuffled)).toEqual(base);
    }
  });

  it("orders unavailable paths before contested ones", () => {
    const conflicts = conflictsOf([
      claim("descriptor.mod", "descriptor"),
      claim("descriptor.mod", "content"),
    ]);
    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["reserved", "duplicate"]);
  });
});

describe("adjudication at Asset-tree scale", () => {
  // Dawn of Ascension ships 569 Asset files; the pairwise adjudicator this
  // replaced compared every claim against every other, so a tree this size cost
  // hundreds of thousands of path splits before rendering could start.
  function corpus(count: number): PathClaim[] {
    return Array.from({ length: count }, (_unused, index) =>
      claim(`gfx/models/dir_${index % 40}/asset_${index}.dds`, "asset")
    );
  }

  it("accepts a large conflict-free tree", () => {
    expect(adjudicatePaths({ claims: corpus(1200), vanillaPaths: new Set() })).toHaveLength(1200);
  });

  it("finds the one alias hidden in a large tree", () => {
    const claims = [...corpus(1200), claim("gfx/models/DIR_7/late.dds", "asset")];
    const conflicts = conflictsOf(claims);
    expect(conflicts).toEqual([
      expect.objectContaining({ path: "gfx/models/DIR_7", reason: "portable-alias" }),
    ]);
  });
});

describe("the fold", () => {
  it("publishes an adjudicated ledger covering every emitted file", () => {
    const capability = createMod({
      name: "Claim Probe",
      prefix: "claim_probe",
      supportedVersion: "4.4.*",
    });
    const compiled = capability.compile([
      capability.feature("probe", [
        capability.technology("marker", {
          name: "Marker",
          cost: 1,
          area: "physics",
          tier: 1,
          category: "particles",
        }),
      ]),
    ]);

    expect(compiled.paths.map((entry) => [entry.path, entry.producer.kind])).toEqual([
      ["common/technology/claim_probe_probe.txt", "content"],
      ["descriptor.mod", "descriptor"],
      ["localisation/english/claim_probe_probe_l_english.yml", "localization"],
    ]);
    // The stem is how a conflict points at the Feature that has to change.
    expect(compiled.paths[0]!.producer.stems).toEqual(["probe"]);
    expect(Object.isFrozen(compiled.paths)).toBe(true);
    expect(Object.isFrozen(compiled.paths[0])).toBe(true);
    expect(Object.isFrozen(compiled.paths[0]!.producer)).toBe(true);
  });
});
