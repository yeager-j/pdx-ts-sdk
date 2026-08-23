/** The deterministic fold from capability-owned features to `PureMod`. */

import type { ModItemInput } from "../authoring/feature.ts";
import { compileComponentTags } from "./compile-component-tags.ts";
import { compileContent } from "./compile-content.ts";
import { compileEvents } from "./compile-events.ts";
import { finalizeMod } from "./compile-finalize.ts";
import { createBuildSession } from "./compile-session.ts";
import type { BuildOptions, ModConfig, ResolvedModConfig } from "./config.ts";
import type { PureMod } from "./model.ts";

export { emissionPath, fileRootEnvelope } from "./compile-content.ts";
export { type BuildOptions, type ModConfig } from "./config.ts";
export {
  type ComponentTagFile,
  type EmittedFile,
  type LocalizationFile,
  type PureMod,
} from "./model.ts";

/** Compiles explicit Features into an immutable mod value. */
export function buildMod(
  callerConfig: ModConfig | ResolvedModConfig,
  features: readonly ModItemInput[],
  options: BuildOptions = {}
): PureMod {
  const session = createBuildSession(callerConfig, features, options);
  const content = compileContent(session);
  const componentTags = compileComponentTags(session);
  const events = compileEvents(session);
  return finalizeMod(session, content, componentTags, events);
}
