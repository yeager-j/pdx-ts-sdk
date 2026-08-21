import { describe, expect, it } from "vitest";

import sdkPackage from "../../sdk/package.json";
import {
  SDK_DOCS_REVISION,
  SDK_DOCS_REVISION_LINE,
  SDK_DOCS_VERSION,
  SDK_DOCS_VERSION_LINE,
} from "../lib/sdk-docs-version.ts";

describe("the agent documentation index", () => {
  it("declares the exact SDK version and source revision the deployment documents", () => {
    expect(SDK_DOCS_VERSION).toBe(sdkPackage.version);
    expect(SDK_DOCS_VERSION_LINE).toBe(`SDK version: ${sdkPackage.version}`);
    expect(SDK_DOCS_REVISION).toMatch(/^[a-f0-9]{64}$/);
    expect(SDK_DOCS_REVISION_LINE).toBe(`SDK revision: ${SDK_DOCS_REVISION}`);
  });
});
