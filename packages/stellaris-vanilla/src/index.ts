// Placeholder shell (SDK-12 seam B). `tools/vanilla-codegen` overwrites this
// package's `src/` wholesale on first real generation; nothing here is
// hand-maintained past that point.

// Side-effect import: this is the one line a mod's build entry needs
// (`import "@pdx-ts/stellaris-vanilla";`) to activate the augmentation below.
import "./augment.ts";

export {};
