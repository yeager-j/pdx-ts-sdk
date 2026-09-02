import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCwtCommit } from "@pdx-ts/codegen-cwt/provenance";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("readCwtCommit", () => {
  it("returns the checked-out submodule revision", () => {
    expect(readCwtCommit(path.join(ROOT, "vendor/cwtools-stellaris-config"))).toMatch(
      /^[0-9a-f]{40}$/
    );
  });

  it("explains how to initialize a missing checkout", () => {
    expect(() => readCwtCommit(path.join(ROOT, "not-a-submodule"))).toThrow(
      "Run git submodule update --init"
    );
  });
});
