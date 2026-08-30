import { parseUpstreamCommit } from "@pdx-ts/codegen-cwt/provenance";
import { describe, expect, it } from "vitest";

describe("parseUpstreamCommit", () => {
  it("returns the 40-character revision from VERSION.md", () => {
    expect(parseUpstreamCommit("Revision: `0123456789abcdef0123456789abcdef01234567`")).toBe(
      "0123456789abcdef0123456789abcdef01234567"
    );
  });

  it("rejects a missing or malformed revision", () => {
    expect(() => parseUpstreamCommit("Revision: unknown")).toThrow(
      "VERSION.md does not contain a 40-character lowercase upstream commit"
    );
    expect(() => parseUpstreamCommit("Revision: `0123`")).toThrow(
      "VERSION.md does not contain a 40-character lowercase upstream commit"
    );
    expect(() =>
      parseUpstreamCommit("Revision: `0123456789abcdef0123456789abcdef012345678`")
    ).toThrow("VERSION.md does not contain a 40-character lowercase upstream commit");
  });
});
