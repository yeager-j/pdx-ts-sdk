import { execFileSync } from "node:child_process";

/** Stellaris documentation dump read by the CWT-derived generators. */
export const CWT_SCRIPT_DOCS_VERSION = "v4.4.1";

/**
 * Reads the commit checked out in the cwtools config submodule.
 *
 * @throws {Error} When the submodule is not initialized or its revision cannot be read.
 */
export function readCwtCommit(cwtDirectory: string): string {
  let commit: string;
  try {
    commit = execFileSync("git", ["-C", cwtDirectory, "rev-parse", "--verify", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (cause) {
    throw new Error(
      `Cannot read the cwtools config revision at ${cwtDirectory}. Run git submodule update --init.`,
      { cause }
    );
  }

  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`The cwtools config revision is not a 40-character commit: ${commit}`);
  }
  return commit;
}
