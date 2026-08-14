/**
 * The committed, game-versioned corpus, read as data.
 *
 * `packages/sdk/tests/fixtures/corpus/` is the repo's existing evidence: what
 * shipped Stellaris actually writes per registry field, extracted from an
 * install by a maintainer and committed for review. The spike reads those JSON
 * files directly rather than importing the SDK's extraction module, because the
 * fixture is evidence and the module is machinery — reading the first is not a
 * boundary crossing, and importing the second would be a second one on top of
 * the probe's.
 *
 * Nothing here decides anything. An occurrence count is evidence that a form
 * occurs in one named build of one game, never that the form is generally legal
 * and never that an author should copy it. Turning frequency into advice is a
 * maintainer's job, done in `curation.ts` with the dependency that keeps it
 * honest.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE_DIR = path.join(ROOT, "packages/sdk/tests/fixtures/corpus");

/** Repo-relative, for provenance lines the page shows. */
export const FIXTURE_PATH = "packages/sdk/tests/fixtures/corpus";

/**
 * The floor above which the SDK's own conformance gate requires a field to be
 * authorable or explicitly acknowledged, restated here so the spike can say
 * which side of it an observation falls on.
 *
 * Restated rather than imported: the SDK declares it in a test module that
 * also locates a game install, and pulling that in for one integer would drag
 * the install seam into a hermetic build. `tests/citations.test.ts` reads the
 * declaring file as text and fails if the number moves.
 */
export const PRESENCE_FLOOR = 25;

interface RawObservation {
  readonly definitions: number;
  readonly repeated: number;
  readonly scalars: number;
  readonly blocks: number;
  readonly bareValues: number;
  readonly bareBlocks: number;
  readonly emptyBlocks: number;
  readonly values: readonly string[];
  readonly keys: readonly string[];
}

interface RawFixture {
  readonly registry: string;
  readonly definitions: number;
  readonly files: number;
  readonly fingerprint: string;
  readonly fields: Readonly<Record<string, RawObservation>>;
}

interface RawMeta {
  readonly gameVersion: string;
  readonly extractedAt: string;
  readonly fingerprint: string;
}

/** What one build of the game writes for one field. */
export interface FieldEvidence {
  /** The corpus's dotted path, `stages.color`. */
  readonly key: string;
  /** How many definitions write the key at all. */
  readonly definitions: number;
  /** Of those, how many write it as a bare value, and how many as a block. */
  readonly scalars: number;
  readonly blocks: number;
  /** How many write it more than once at the same level. */
  readonly repeated: number;
  /** Distinct scalar values observed, capped by the extractor's sample. */
  readonly values: readonly string[];
  /** True when fewer definitions write it than the SDK's conformance floor. */
  readonly belowPresenceFloor: boolean;
}

export interface RegistryEvidence {
  readonly registry: string;
  /** The build the observations describe. Never presented as timeless. */
  readonly gameVersion: string;
  /** sha256 over the registry directory's file hashes, from the committed fixture. */
  readonly fingerprint: string;
  readonly definitions: number;
  readonly files: number;
  readonly fields: readonly FieldEvidence[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function readRegistryEvidence(registry: string): RegistryEvidence {
  const meta = readJson<RawMeta>(path.join(FIXTURE_DIR, "meta.json"));
  const fixture = readJson<RawFixture>(path.join(FIXTURE_DIR, `${registry}.json`));
  return {
    registry,
    gameVersion: meta.gameVersion,
    fingerprint: fixture.fingerprint,
    definitions: fixture.definitions,
    files: fixture.files,
    fields: Object.entries(fixture.fields)
      .map(([key, observation]) => ({
        key,
        definitions: observation.definitions,
        scalars: observation.scalars,
        blocks: observation.blocks,
        repeated: observation.repeated,
        values: observation.values,
        belowPresenceFloor: observation.definitions < PRESENCE_FLOOR,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}
