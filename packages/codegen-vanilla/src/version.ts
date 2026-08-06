/**
 * How one game build's identifier package is numbered across publishes.
 *
 * Its own module rather than a function in `index.ts`, because `index.ts` is a
 * script — it ends in `await main()`, so importing anything from it runs the
 * generator.
 */

/**
 * The version to stamp for a game build, given whatever the package carries now.
 *
 * The version is the game version plus a `-r.<n>` revision counting publishes
 * of that one build, and a bare `4.4.6` is never stamped. npm can never reuse a
 * version number, so numbering by game version alone allows exactly one publish
 * per game release — and this package can need a second long before Paradox
 * ships anything: a widened peer range, a regenerated registry, a generator
 * fix. Consumers ask for a build with the range `>=4.4.6-0 <4.4.6`, whose upper
 * bound excludes exactly the pre-scheme bare version.
 *
 * `r.1` rather than `r1`: a dot makes the number its own numeric identifier, so
 * `-r.10` sorts *above* `-r.9`. Run together they are one alphanumeric
 * identifier compared lexically, and the tenth revision would sort below the
 * ninth — handing every install a stale one.
 *
 * **Regenerating never moves the revision, and that is deliberate.** A new game
 * build restarts at `-r.1`; regenerating the build already stamped keeps the
 * version exactly as it is. Two reasons, and either alone would be enough.
 * `codegen:vanilla:check` regenerates and then diffs `package.json`, so a
 * version that moved on every run would fail that gate unconditionally and
 * teach nothing. And the revision answers "which publish is this", which is a
 * release decision a maintainer makes when publishing — bump it by hand then,
 * not incidentally by running the generator.
 */
export function stampedVersionFor(gameVersion: string, currentVersion: string): string {
  const currentCore = currentVersion.split("-", 2)[0];
  if (currentCore === gameVersion && /-r\.\d+$/.test(currentVersion)) {
    return currentVersion;
  }
  return `${gameVersion}-r.1`;
}
