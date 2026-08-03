/**
 * A real test, colocated with the feature it tests — which is the layout the
 * SDK exists to allow and, until `DEFAULT_CONTENT_PATTERN`, could not.
 *
 * Its presence is the evidence. This file sits inside a discovered directory,
 * so before the pattern it would have broken the walk three ways: imported and
 * executed at collection time, exporting nothing a definer returned, and named
 * `expansion.test`, which is not a legal file stem. Every assertion the
 * discovery suite makes about this fixture — the collection count, the item
 * counts, the emitted paths, the committed snapshots — is unchanged with this
 * file here, and that is the claim.
 *
 * Note this is a test *of* the fixture, run by the ordinary suite through the
 * `packages/sdk/tests/**` glob. It never runs as part of discovery.
 */

import { describe, expect, it } from "vitest";

import { beaconNetwork, firstLight, surveyDoctrine } from "./expansion.ts";

describe("the expansion fixture feature", () => {
  it("gates the beacon network behind the survey doctrine", () => {
    expect(beaconNetwork.def.prerequisites).toEqual([surveyDoctrine]);
  });

  it("numbers its events inside the feature's own namespace", () => {
    expect(firstLight.id).toBe("pp_disco.1");
  });
});
