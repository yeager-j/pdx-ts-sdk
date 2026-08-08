/**
 * The SDK range this release's baked recipes were verified against.
 *
 * Every scaffolder release states one, because the recipes it carries are
 * proved against a particular SDK at package-verification time and against
 * nothing else. A project's own declared dependency must be a *subset* of this
 * range rather than merely overlapping it: an overlapping range is one a later
 * `npm install` can resolve to an SDK nobody proved these recipes against.
 *
 * It is deliberately a separate constant from the dependency range
 * `templates/project.ts` writes into a scaffolded `package.json`. They answer
 * different questions — "what does a new project ask for" versus "what did we
 * prove" — and a test asserts the first stays a subset of the second, so the
 * day they need to differ, they can.
 */
export const VERIFIED_SDK_RANGE = "^0.2.0";
