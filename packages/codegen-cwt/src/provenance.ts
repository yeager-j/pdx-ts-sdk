/**
 * Parses the source revision recorded in the vendored cwtools version file.
 *
 * @throws {Error} When the file has no backticked, 40-character lowercase commit hash.
 */
export function parseUpstreamCommit(version: string): string {
  const commit = /`([0-9a-f]+)`/.exec(version)?.[1];
  if (commit === undefined || commit.length !== 40) {
    throw new Error("VERSION.md does not contain a 40-character lowercase upstream commit");
  }
  return commit;
}
