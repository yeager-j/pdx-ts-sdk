/**
 * A project that declares its Features from `project-features.ts` and mirrors
 * the committed `project/assets` tree.
 */

import { createModProject } from "../../../src/index.ts";

export const project = createModProject(
  {
    mod: {
      bag_project: {
        name: "Bag project",
        supportedVersion: "4.4.*",
      },
    },
    assetsDirectory: "assets",
  } as const,
  { projectRoot: new URL("./project/", import.meta.url) }
);

export const { mod } = project;
