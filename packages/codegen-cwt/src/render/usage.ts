/** Per-file symbol usage collected before a generated module is rendered. */

import type { FileImports } from "./symbols.ts";

/** Symbols and generated aliases referenced by one output module. */
export interface Usage {
  /** CWT enum aliases referenced by the file. */
  readonly enums: string[];
  /** CWT content-reference aliases referenced by the file. */
  readonly refs: string[];
  /** CWT value-set aliases referenced by the file. */
  readonly valueSets: string[];
  /** SDK imports referenced by the file. */
  readonly imports: FileImports;
}
