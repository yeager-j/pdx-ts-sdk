/**
 * The opaque receipt of one observed target state.
 *
 * A refusal hands back evidence the caller can review and, later, replay: the
 * exact owned entries, foreign entries and launcher-descriptor state the SDK
 * saw when it refused. The receipt is a brand rather than a data object so a
 * caller cannot hand-build one — a forged receipt would be a forged review of
 * a state nobody looked at. `openReceipt` is the only way back to the fields,
 * and it accepts nothing this module did not mint.
 *
 * Foreign files contribute stat identity only. Reading their bytes would make
 * every refusal proportional to whatever an author left in the output tree,
 * and the SDK has no claim on their contents.
 */

import { createHash, type Hash } from "node:crypto";

import { compareUtf8 } from "../ordering.ts";

const encoder = new TextEncoder();
const RECEIPT_DOMAIN = "pdx-sdk-materialization-receipt\0";
const RECEIPT_VERSION = "1";

declare const receiptBrand: unique symbol;

/**
 * Evidence of one observed target state; only `issueReceipt` mints one. The
 * brand is required rather than optional so `{}` does not satisfy it: an
 * optional brand makes the forgery a runtime error at the replay call, which
 * is exactly where a caller has least reason to expect one.
 */
export interface MaterializationReceipt {
  readonly [receiptBrand]: never;
}

/** The drift-relevant kinds an owned path can be found in. */
export type OwnedObservedKind = "file" | "directory" | "symlink" | "other" | "missing";

export interface OwnedSnapshotEntry {
  readonly path: string;
  readonly kind: OwnedObservedKind;
  /** Zero unless the entry was found as a regular file. */
  readonly byteLength: number;
  /** Empty unless the entry was found as a regular file. */
  readonly sha256: string;
}

/**
 * Stat-identity rows. Two populations share this shape, because both are
 * states the SDK observed but does not own the contents of: foreign entries,
 * which are only ever files or directories, and the descendants of an owned
 * path found as a directory — a type change whose subtree would otherwise
 * digest identically no matter what is under it, which are recorded with
 * whatever kind they were found in.
 */
export interface ForeignSnapshotEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

export type DescriptorSnapshot =
  | { readonly state: "absent" }
  | { readonly state: "symlink" }
  | { readonly state: "other" }
  | {
      readonly state: "file";
      readonly basename: string;
      readonly byteLength: number;
      readonly sha256: string;
    };

export interface MaterializationSnapshot {
  readonly owned: readonly OwnedSnapshotEntry[];
  readonly foreign: readonly ForeignSnapshotEntry[];
  /** Install mode only; absent for a build target, which has no descriptor. */
  readonly descriptor?: DescriptorSnapshot;
}

/** The fields behind a receipt, once `openReceipt` has proved it is one. */
export interface OpenedReceipt {
  readonly target: string;
  readonly mode: string;
  readonly prefix: string;
  readonly digest: string;
}

class Receipt implements OpenedReceipt, MaterializationReceipt {
  declare readonly [receiptBrand]: never;
  readonly target: string;
  readonly mode: string;
  readonly prefix: string;
  readonly digest: string;

  constructor(target: string, mode: string, prefix: string, digest: string) {
    this.target = target;
    this.mode = mode;
    this.prefix = prefix;
    this.digest = digest;
    Object.freeze(this);
  }
}

export function issueReceipt(
  target: string,
  mode: string,
  prefix: string,
  snapshot: MaterializationSnapshot
): MaterializationReceipt {
  return new Receipt(target, mode, prefix, digestSnapshot(target, mode, prefix, snapshot));
}

/**
 * The digest a receipt for this state would carry. Replay compares an offered
 * receipt against it, and must reach the same value the refusal would mint.
 */
export function receiptDigest(
  target: string,
  mode: string,
  prefix: string,
  snapshot: MaterializationSnapshot
): string {
  return digestSnapshot(target, mode, prefix, snapshot);
}

export function openReceipt(receipt: MaterializationReceipt): OpenedReceipt {
  if (!(receipt instanceof Receipt)) {
    throw new TypeError("Expected a materialization receipt issued by the SDK");
  }
  return receipt;
}

function digestSnapshot(
  target: string,
  mode: string,
  prefix: string,
  snapshot: MaterializationSnapshot
): string {
  const hash = createHash("sha256");
  hash.update(RECEIPT_DOMAIN);
  field(hash, RECEIPT_VERSION);
  field(hash, target);
  field(hash, mode);
  field(hash, prefix);

  const owned = [...snapshot.owned].sort((a, b) => compareUtf8(a.path, b.path));
  field(hash, `owned:${owned.length}`);
  for (const entry of owned) {
    field(hash, entry.path);
    field(hash, entry.kind);
    field(hash, String(entry.byteLength));
    field(hash, entry.sha256);
  }

  const foreign = [...snapshot.foreign].sort((a, b) => compareUtf8(a.path, b.path));
  field(hash, `foreign:${foreign.length}`);
  for (const entry of foreign) {
    field(hash, entry.path);
    field(hash, entry.kind);
    field(hash, String(entry.dev));
    field(hash, String(entry.ino));
    field(hash, String(entry.size));
    field(hash, String(entry.mtimeMs));
  }

  const descriptor = snapshot.descriptor;
  field(hash, `descriptor:${descriptor === undefined ? "none" : descriptor.state}`);
  if (descriptor?.state === "file") {
    field(hash, descriptor.basename);
    field(hash, String(descriptor.byteLength));
    field(hash, descriptor.sha256);
  }
  return hash.digest("hex");
}

function field(hash: Hash, value: string): void {
  const bytes = encoder.encode(value);
  hash.update(lengthPrefix(bytes.byteLength));
  hash.update(bytes);
}

function lengthPrefix(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}
