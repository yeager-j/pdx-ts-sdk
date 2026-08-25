import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolves the absolute project directory shared by project build tools. */
export function resolveProjectRootPath(projectRoot: string | URL): string {
  const resolved = typeof projectRoot === "string" ? projectRoot : fileURLToPath(projectRoot);
  if (!path.isAbsolute(resolved)) {
    throw new Error("Project root must be an absolute path or file URL");
  }
  return path.resolve(resolved);
}
