/**
 * Proves the cluster-name collision guard (SDK-256) actually fires. `hashTag`
 * truncates its DJB2 digest to 4 hex digits (16 bits) to name scope clusters
 * like `EffectsIn7Scopes3f2a`. Two different scope sets can land on the same
 * tag, and without a guard `clusterName`/`pathClusterName` would mint the
 * same `export interface` name for both — a fault TypeScript never reports:
 * it silently merges the two same-named declarations, so every scope in
 * either cluster gains the union of both clusters' methods.
 */

import { clusterName, registerClusterName } from "@pdx-ts/codegen-cwt/emit/script/effects";
import { describe, expect, it } from "vitest";

/**
 * A deterministic word whose letters vary throughout, not just at the end.
 *
 * A naive search — scope sets sharing a prefix and differing only in a
 * trailing digit (`"scope_0"` vs `"scope_1"`) — collides on the very first
 * try here, because `hashTag` keeps the *high* 16 bits of a 32-bit DJB2
 * digest (`.slice(0, 4)` of an 8-hex-digit string) and DJB2's last step XORs
 * the final character's low-order bits straight into the *low* bits of the
 * digest, never reaching the high half. That is a real, sharper-than-16-bit
 * collision risk in its own right, but it is not the generic birthday-bound
 * case this test is after, so the generator here changes letters across the
 * whole word instead of only at the tail.
 */
function wordFor(n: number): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let word = "";
  let x = n + 1;
  while (x > 0) {
    word += letters[x % 26]!;
    x = Math.floor(x / 26);
  }
  return word.padEnd(5, "z");
}

/** A >3-length scope set, so `clusterName` takes the `hashTag` path rather than its short-set branch. */
function scopesFor(i: number): string[] {
  return [wordFor(i * 7 + 1), wordFor(i * 13 + 2), wordFor(i * 19 + 3), wordFor(i * 29 + 4)];
}

/**
 * Two distinct scope sets whose `clusterName` collides, found once so every
 * test below reuses the same pair rather than re-searching. 3000 tries is
 * generous headroom over the birthday bound for a 16-bit tag (~300 expected);
 * this generator finds one well inside that budget.
 */
function findClusterNameCollision(): {
  readonly name: string;
  readonly scopesA: string[];
  readonly scopesB: string[];
} {
  const seen = new Map<string, string[]>();
  for (let i = 0; i < 3000; i++) {
    const scopes = scopesFor(i);
    const name = clusterName(scopes);
    const prior = seen.get(name);
    if (prior !== undefined) {
      return { name, scopesA: prior, scopesB: scopes };
    }
    seen.set(name, scopes);
  }
  throw new Error("no hashTag collision found in 3000 tries — the birthday bound moved");
}

describe("registerClusterName", () => {
  it("throws when two different scope sets mint the same cluster name", () => {
    const { name, scopesA, scopesB } = findClusterNameCollision();
    expect(scopesA).not.toEqual(scopesB);
    expect(clusterName(scopesB)).toBe(name);

    const minted = new Map<string, string>();
    expect(() => registerClusterName(minted, name, scopesA)).not.toThrow();
    expect(() => registerClusterName(minted, name, scopesB)).toThrow(
      `Cluster name "${name}" was minted for scope set [${scopesA.join("|")}] and again for a ` +
        `different scope set [${scopesB.join("|")}]`
    );
  });

  it("does not throw when the same scope set mints the same name twice", () => {
    const scopes = scopesFor(0);
    const name = clusterName(scopes);
    const minted = new Map<string, string>();
    registerClusterName(minted, name, scopes);
    // A fresh array with equal content, not the same reference: the guard
    // compares the scope signature, not object identity.
    expect(() => registerClusterName(minted, name, [...scopes])).not.toThrow();
  });

  it("does not throw for two distinct scope sets that mint distinct names", () => {
    const minted = new Map<string, string>();
    registerClusterName(minted, "EffectsInCountryPlanetShip", ["country", "planet", "ship"]);
    expect(() =>
      registerClusterName(minted, "EffectsInCountryPlanetSpecies", ["country", "planet", "species"])
    ).not.toThrow();
  });
});
