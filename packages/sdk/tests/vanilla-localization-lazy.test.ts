/**
 * That importing the SDK's vocabulary does not load the 4.5 MB localization
 * inventory (SDK-307).
 *
 * `vanilla.localization` is re-exported into `vanilla.*`, which lives in
 * `stellaris.ts` — the module every mod file imports its triggers, effects, and
 * references from. A static import of the inventory there would make every
 * project parse and retain 149,217 keys whether or not it ever names one, which
 * is why `identifiers/vanilla-localization.ts` loads through `createRequire` on
 * first call instead.
 *
 * Asserted in a subprocess rather than in this one, for the reason the check is
 * exact rather than approximate: within a shared worker, another test that
 * already named a vanilla key would have loaded the inventory and the "not yet
 * loaded" half would pass or fail on test ordering. A fresh process is the
 * condition a real project is in.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const STELLARIS = new URL("../src/stellaris.ts", import.meta.url).href;

/**
 * A `module.registerHooks` load hook is the observable, rather than
 * `require.cache`: the cache holds what `createRequire` loaded and nothing
 * else, so it would stay empty — and this test stay green — if someone
 * reintroduced the static ESM import this exists to forbid. The hook sees
 * every module either loader evaluates.
 */
const PROBE = `
import { registerHooks } from "node:module";

const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    loaded.push(url);
    return nextLoad(url, context);
  },
});
const inventoryLoaded = () => loaded.some((url) => url.includes("localization-keys"));

const { vanilla } = await import(${JSON.stringify(STELLARIS)});
const afterImport = inventoryLoaded();
vanilla.localization("requires_independence");
console.log(JSON.stringify({ afterImport, afterCall: inventoryLoaded() }));
`;

describe("the packaged localization inventory", () => {
  it("loads on first use, not on importing the vocabulary", () => {
    const output = execFileSync(
      process.execPath,
      ["--conditions=pdx-source", "--input-type=module", "-e", PROBE],
      { encoding: "utf8" }
    );

    expect(JSON.parse(output.trim())).toEqual({ afterImport: false, afterCall: true });
  });
});
