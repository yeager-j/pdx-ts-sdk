/**
 * How `@pdx-ts/stellaris-ids` is numbered, in one place.
 *
 * One scheme with three faces, each held by a different package: the generator
 * *stamps* a version, this SDK *parses* one back to the game build it pins, and
 * both the mismatch message and the scaffolder hand an author a *range* that
 * resolves it. They are one fact — a stamp outside its own range installs
 * nothing — and every copy of it lives here, because three hand-written
 * projections is exactly how a scheme change passes three green suites while
 * the system property silently breaks (SDK-137).
 *
 * Exported from the package root so the two out-of-package copies can be the
 * same code rather than the same string: `@pdx-ts/codegen-vanilla` calls
 * {@link stampedVanillaPackageVersion} to write the package's version, and
 * `create-stellaris-mod` — which cannot depend on the SDK at runtime, since it
 * scaffolds projects that install it — pins its own `idsRange` against
 * {@link vanillaPackageInstallRange} in a test.
 */

/**
 * The version to stamp for a game build, given whatever the package carries now.
 *
 * The version is the game version plus a `-r.<n>` revision counting publishes
 * of that one build, and a bare `4.4.6` is never stamped. npm can never reuse a
 * version number, so numbering by game version alone allows exactly one publish
 * per game release — and this package can need a second long before Paradox
 * ships anything: a widened peer range, a regenerated registry, a generator
 * fix.
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
export function stampedVanillaPackageVersion(gameVersion: string, currentVersion: string): string {
  const currentCore = currentVersion.split("-", 2)[0];
  if (currentCore === gameVersion && /-r\.\d+$/.test(currentVersion)) {
    return currentVersion;
  }
  return `${gameVersion}-r.1`;
}

/**
 * The game build a package version pins, which is that version with its
 * revision suffix stripped: `"4.4.6-r.2"` -> `"4.4.6"`.
 *
 * The two are never interchangeable. `4.4.6-r.2` is a package version and never
 * an install version, so a comparison against an install has to come through
 * here — a regen-fix release still pins the same build.
 */
export function vanillaPackageGameVersion(packageVersion: string): string {
  return packageVersion.split(/[-+]/, 1)[0]!;
}

/**
 * How to ask npm for the identifier package matching one game build.
 *
 * Not `@4.4.6`: every published version is a `-r.<n>` revision of a build, and
 * an ordinary range matches no prerelease, so naming the bare version finds
 * either nothing or — on a registry still carrying one — a build that predates
 * the revision scheme.
 *
 * Both bounds earn their place. `>=4.4.6-0` is what admits prereleases at all;
 * `<4.4.6` then excludes exactly the pre-scheme bare version. Highest-wins
 * within the range means newest revision, which is the whole point.
 */
export function vanillaPackageInstallRange(gameVersion: string): string {
  return `>=${gameVersion}-0 <${gameVersion}`;
}
