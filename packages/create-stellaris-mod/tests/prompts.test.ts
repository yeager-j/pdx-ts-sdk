import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseArgv } from "../src/options.ts";
import { resolveInteractive } from "../src/prompts.ts";
import { capture } from "./helpers/capture.ts";

const clack = vi.hoisted(() => ({
  confirm: vi.fn(),
  note: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: clack.confirm,
  intro: vi.fn(),
  isCancel: () => false,
  log: { error: vi.fn(), warn: vi.fn() },
  note: clack.note,
  text: clack.text,
}));

vi.mock("../src/detect.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/detect.ts")>();
  return { ...actual, detectInstall: () => undefined };
});

const argv = [
  "my-mod",
  "--name",
  "My Mod",
  "--prefix",
  "my_mod",
  "--supported-version",
  "v4.4.*",
  "--no-prettier",
  "--no-eslint",
  "--no-git",
  "--no-install",
];

beforeEach(() => {
  clack.confirm.mockReset();
  clack.note.mockReset();
  clack.text.mockReset();
  clack.text.mockResolvedValue("");
});

describe("the interactive LLM choice", () => {
  it.each([true, false])("honors the %s answer", async (answer) => {
    clack.confirm.mockResolvedValue(answer);
    const resolved = await resolveInteractive(parseArgv(argv), capture("/tmp", true).io);

    expect(resolved.llmSupport).toBe(answer);
    expect(clack.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "Add Codex and Claude support?",
        initialValue: true,
      })
    );
  });

  it("does not prompt when --no-llm supplies the answer", async () => {
    const resolved = await resolveInteractive(
      parseArgv([...argv, "--no-llm"]),
      capture("/tmp", true).io
    );

    expect(resolved.llmSupport).toBe(false);
    expect(clack.confirm).not.toHaveBeenCalled();
  });
});

describe("building without an install", () => {
  it("explains the verified-build identifier fallback", async () => {
    await resolveInteractive(parseArgv(argv), capture("/tmp", true).io);

    expect(clack.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Path to your Stellaris install (blank to skip)",
        placeholder: "leave blank to use checked ids for the verified game build",
      })
    );
    expect(clack.note).toHaveBeenCalledWith(
      expect.stringContaining("vanilla ids checked against\nthe verified game build"),
      "Building without vanilla",
      expect.anything()
    );
    expect(clack.note).toHaveBeenCalledWith(
      expect.stringContaining(
        "STELLARIS_PATH later to load your install for patching; it does not change\nthe identifier package."
      ),
      "Building without vanilla",
      expect.anything()
    );
  });
});

describe("SDK-valid flags", () => {
  it.each([
    ["name", argv.with(2, "My\nMod"), "newline"],
    ["prefix", argv.with(4, "My-Mod"), "lowercase snake_case"],
  ])("refuses an invalid supplied %s after skipping its prompt", async (_field, args, message) => {
    await expect(resolveInteractive(parseArgv(args), capture("/tmp", true).io)).rejects.toThrow(
      message
    );
  });
});
