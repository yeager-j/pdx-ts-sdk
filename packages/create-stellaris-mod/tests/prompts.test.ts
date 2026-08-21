import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseArgv } from "../src/options.ts";
import { resolveInteractive } from "../src/prompts.ts";
import { capture } from "./helpers/capture.ts";

const clack = vi.hoisted(() => ({
  confirm: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: clack.confirm,
  intro: vi.fn(),
  isCancel: () => false,
  log: { error: vi.fn(), warn: vi.fn() },
  note: vi.fn(),
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
