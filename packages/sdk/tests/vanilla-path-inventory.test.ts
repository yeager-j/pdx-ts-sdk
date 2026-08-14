/**
 * The packaged vanilla path inventory as the Fold's always-on evidence
 * (SDK-173, ADR-0006): every build checks its claims against
 * `@pdx-ts/stellaris-ids/paths`, whether or not it loaded a `VanillaView`, and
 * unions in whatever live-install evidence a loaded view adds. Invalid live
 * evidence is never silently treated as absent.
 */

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { VanillaPathInventoryError } from "../src/errors.ts";
import {
  checkVanillaPathInventoryConsistency,
  packagedVanillaPaths,
} from "../src/identifiers/vanilla-paths.ts";
import { createMod, PathOwnershipError } from "../src/index.ts";
import { isOsMetadataPath } from "../src/stellaris/installation/scan-paths.ts";
import { load } from "../src/stellaris/vanilla/load.ts";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = join(ROOT, "fixtures/fake-install");

describe("packagedVanillaPaths", () => {
  it("is the full, memoized, junk-free inventory the SDK ships", () => {
    const first = packagedVanillaPaths();
    expect(first.size).toBeGreaterThan(40_000);
    expect(first.has("common/on_actions/00_on_actions.txt")).toBe(true);
    expect(first.has("events/crisis_events_1.txt")).toBe(true);
    for (const path of first) {
      expect(isOsMetadataPath(path), path).toBe(false);
    }
    const second = packagedVanillaPaths();
    expect(second).toBe(first);
    // Real immutability, not `Object.isFrozen`: freezing a `Set` object
    // leaves its `.add`/`.delete` internal-slot mutators reachable, so a
    // frozen-but-still-mutable set would pass that check anyway. The
    // wrapper this returns (`immutableSet`, compiler/freeze.ts) has no `add`
    // at all.
    expect((first as Partial<Set<string>>).add).toBeUndefined();
  });
});

describe("the packaged inventory checked with no VanillaView loaded", () => {
  // Deliberately brittle: `events/crisis_events_1.txt` is a real vanilla
  // path in the packaged inventory today. If a future game patch renames or
  // removes that file, this test fails at the next regeneration of
  // `@pdx-ts/stellaris-ids` — loudly, on purpose, rather than silently
  // testing nothing. That is the point of the always-on check this proves:
  // the packaged inventory is evidence with no loaded install required.
  it("refuses a minted path the packaged inventory already occupies", () => {
    const mod = createMod({
      name: "SDK-173 packaged-only collision",
      prefix: "crisis",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const pulse = events.country(1, { hideWindow: true, isTriggeredOnly: true });

    let thrown: unknown;
    try {
      mod.compile([mod.feature("events_1", [pulse])]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PathOwnershipError);
    const conflicts = (thrown as PathOwnershipError).conflicts;
    const atPath = conflicts.filter((conflict) => conflict.path === "events/crisis_events_1.txt");
    expect(atPath).toHaveLength(1);
    expect(atPath[0]!.reason).toBe("vanilla");
  });

  it("control: a stem that lands on no packaged path builds cleanly", () => {
    const mod = createMod({
      name: "SDK-173 packaged-only control",
      prefix: "sdk173nocollide",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const pulse = events.country(1, { hideWindow: true, isTriggeredOnly: true });

    expect(() => mod.compile([mod.feature("events_1", [pulse])])).not.toThrow();
  });
});

describe("checkVanillaPathInventoryConsistency", () => {
  it("passes silently when no version could be read", () => {
    expect(() => checkVanillaPathInventoryConsistency(undefined)).not.toThrow();
  });

  it("passes silently for the unstamped sentinel", () => {
    expect(() => checkVanillaPathInventoryConsistency("0.0.0")).not.toThrow();
  });

  it("passes when the package version matches the shipped inventory", () => {
    expect(() => checkVanillaPathInventoryConsistency("4.4.6-r.1")).not.toThrow();
  });

  it("throws when the package pins a different build than its own path inventory", () => {
    expect(() => checkVanillaPathInventoryConsistency("9.9.9-r.1")).toThrow(
      VanillaPathInventoryError
    );
    expect(() => checkVanillaPathInventoryConsistency("9.9.9-r.1")).toThrow(/regenerat/);
  });
});

describe("live-install evidence unions with the packaged inventory", () => {
  it("load() carries the install's walked files and its DLC archive entries", () => {
    const view = load({ installPath: FIXTURE, cache: false });
    expect(view.pathInventory).toBeDefined();
    expect(view.pathInventory).toContain("events/fake_events.txt");
    expect(view.pathInventory).toContain("music/fake_dlc_track.ogg");
    for (const path of view.pathInventory ?? []) {
      expect(isOsMetadataPath(path), path).toBe(false);
    }
  });

  it("refuses a minted path present only in the live install evidence", () => {
    // Nothing here is in the packaged inventory: `fake_events.txt` is a
    // fixture, not a shipped Stellaris file. The collision only exists
    // because the mod's own prefix ("fake") and stem ("events") mint exactly
    // the path the fixture install's own `events/fake_events.txt` occupies,
    // and `load()` carries that as live path-scan evidence.
    const view = load({ installPath: FIXTURE, cache: false });
    const mod = createMod({
      name: "SDK-173 live-evidence collision",
      prefix: "fake",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const pulse = events.country(1, { hideWindow: true, isTriggeredOnly: true });

    let thrown: unknown;
    try {
      mod.compile([mod.feature("events", [pulse])], { vanilla: view });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PathOwnershipError);
    const conflicts = (thrown as PathOwnershipError).conflicts;
    const atPath = conflicts.filter((conflict) => conflict.path === "events/fake_events.txt");
    expect(atPath).toHaveLength(1);
    expect(atPath[0]!.reason).toBe("vanilla");
  });
});

describe("invalid live inventory is never treated as absent", () => {
  let installRoot: string | undefined;

  afterEach(() => {
    if (installRoot !== undefined) {
      rmSync(installRoot, { recursive: true, force: true });
      installRoot = undefined;
    }
  });

  it("load() throws rather than silently loading an install with no path evidence", () => {
    installRoot = mkdtempSync(join(tmpdir(), "pdx-sdk-bad-inventory-"));
    // The install-qualifying sentinel `locateInstall` looks for.
    mkdirSync(join(installRoot, "common/technology"), { recursive: true });
    copyFileSync(
      join(FIXTURE, "launcher-settings.json"),
      join(installRoot, "launcher-settings.json")
    );
    mkdirSync(join(installRoot, "dlc/bad"), { recursive: true });
    writeFileSync(join(installRoot, "dlc/bad/bad.zip"), Buffer.from("not a zip file"));

    expect(() => load({ installPath: installRoot, cache: false })).toThrow(
      VanillaPathInventoryError
    );
  });
});
