/** Parses the source revision recorded in the vendored cwtools version file. */
export function parseUpstreamCommit(version: string): string {
  const commit = /`([0-9a-f]{40})`/.exec(version)?.[1];
  if (commit === undefined) {
    throw new Error("VERSION.md does not contain a 40-character lowercase upstream commit");
  }
  return commit;
}
