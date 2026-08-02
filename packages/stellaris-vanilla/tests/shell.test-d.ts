// Present-world shell smoke test (SDK-12 seam B). This package's `src/` is
// still the placeholder shell — an empty augmentation — so `VanillaId<K>`
// degrades to `string` for every registry exactly as it does with the
// package absent entirely. Seam D replaces/extends this with the real
// present-world suite once `tools/vanilla-codegen` has generated real content.

import { describe, expectTypeOf, it } from "vitest";

import "../src/index.ts";

import type { VanillaId } from "@pdx-ts/sdk";

describe("stellaris-vanilla shell", () => {
  it("degrades every registry to string while the package is a placeholder", () => {
    expectTypeOf<VanillaId<"technology">>().toEqualTypeOf<string>();
  });
});
