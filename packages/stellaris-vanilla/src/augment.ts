// Placeholder shell (SDK-12 seam B). The real generator (`tools/vanilla-codegen`,
// not yet built) overwrites this file with one `interface` member per registry
// merged into `VanillaIds`, `VanillaScriptedTriggers extends
// VanillaScriptedTriggerParams {}`, `VanillaScriptedEffects extends
// VanillaScriptedEffectParams {}`, and trie roots on `VanillaTries`.
//
// This file has to stay a module (a top-level `import`/`export`) rather than a
// script: a `declare module "@pdx-ts/sdk" { ... }` written in a script file is
// an ambient module declaration that SHADOWS the real `@pdx-ts/sdk`, instead of
// augmenting it. `export {}` is what keeps this a module while there is
// nothing else to export yet.
export {};

declare module "@pdx-ts/sdk" {}
