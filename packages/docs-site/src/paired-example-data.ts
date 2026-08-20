/** One serialized file of a paired example, as the manifest stores it. */
export interface PairedExampleFile {
  readonly path: string;
  readonly text: string;
  readonly lang: string;
}

/** One paired example: the TypeScript lesson and the files it renders. */
export interface PairedExampleData {
  readonly source: string;
  readonly files: readonly PairedExampleFile[];
}
