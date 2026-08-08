/**
 * The published version, as `--version` reports it.
 *
 * A hand-maintained copy of `package.json`'s: the compiled CLI cannot read its
 * own manifest without knowing where it landed, and `packaging.test.ts` is what
 * notices when a release bumps one and forgets the other.
 */
export const VERSION = "0.2.0";
