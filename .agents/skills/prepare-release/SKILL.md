---
name: prepare-release
description: Prepare and verify a pdx-sdk release when asked to bump the shared version or make the project release-ready.
---

# Prepare Release

Prepare the release without publishing it. A request to prepare a release does not authorize a
commit, tag, push, or npm publish.

1. Read the repository instructions and check the working tree. Preserve and account for existing
   changes.
2. Resolve the requested version to an exact semantic version without a `v` prefix. Treat an
   unambiguous minor shorthand such as `v0.8` as `0.8.0`; ask only when the intended coordinate is
   not clear.
3. Run `npm run release:prepare <version>` from the repository root. `scripts/release.mjs` is the
   source of truth for the shared packages, internal ranges, scaffolder manifest, transcript
   literals, and lockfile refresh. Use that coordinator instead of editing those coordinates by
   hand.
4. Run `git diff --check`, then inspect the complete diff. Every changed file must be either an
   existing user change or an expected release-coordinate update. Do not edit generated version
   files; normal gates regenerate them.
5. Run `npm run release:check`. Completion requires `Release readiness: PASS`, including the
   install-gated vanilla and identifier checks. A skipped gate is not a pass.
6. Treat `@pdx-ts/stellaris-ids` as a separate, install-derived release line. If the check reports
   changed identifier output, inspect the generated diff, advance its `-r.n` package revision,
   record that revision in `packages/stellaris-ids/PROVENANCE.md`, refresh the lockfile with
   `npm install --package-lock-only --ignore-scripts`, and rerun the full release check. Leave its
   version unchanged when its output did not change.
7. If npm reports a security advisory, use `npm audit` to identify whether it affects a published
   runtime dependency or development tooling. Make no broad automatic dependency rewrite; either
   apply and verify a focused fix within the release scope or report the remaining advisory.

Finish only when the release diff is fully accounted for and the full release check passes. Report
the prepared package coordinate, changed files, gate result, and any non-blocking warnings.
