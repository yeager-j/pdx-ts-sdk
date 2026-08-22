/**
 * The key spellings the corpus reader accepts as one key.
 *
 * Stellaris reads `.gfx` keys case-insensitively and its own files exercise
 * that freely: `interface/` writes `textureFile` 1,740 times and `texturefile`
 * 6,141 times, in the same registry and often in the same file. The reader
 * compares keys exactly, so left alone it would record two unrelated fields,
 * halve both counts, and report one of them as a field no author can write.
 *
 * Emission is unaffected — the SDK writes the canonical spelling and nothing
 * else. This is recognition only, and it is deliberately an audited list rather
 * than a blanket `toLowerCase()`: a lowercasing reader would silently absorb a
 * key the game added under a name that only differs from an existing one by
 * case, which is precisely the change somebody should look at. So an unlisted
 * near-miss throws, and the throw is how the next one is found. Every entry
 * below was measured against the shipped 4.4.6 files and carries its count.
 *
 * Canonical is always the spelling the CWT rules declare, because that is the
 * key the emitted interface is measured against.
 */

/** Canonical spelling -> the other spellings the game writes for that key. */
export type RegistryCasings = ReadonlyMap<string, readonly string[]>;

export const OBSERVED_CASINGS: ReadonlyMap<string, RegistryCasings> = new Map([
  [
    "spriteType",
    new Map([
      // The definition keyword. 8,540 `spriteType` against 77 `SpriteType`.
      ["spriteType", ["SpriteType"]],
      // 1,740 `textureFile` against 6,141 `texturefile` — the majority spelling
      // is the variant, which is why canonical follows the rules and not the count.
      ["textureFile", ["texturefile"]],
      // 22 `alwaysTransparent` against 1,484 `alwaystransparent`.
      ["alwaysTransparent", ["alwaystransparent"]],
      // The rules' own spelling is the rarest: 3 `transParencecheck`, against
      // 51 `transparenceCheck` and 36 `transparencecheck`.
      ["transParencecheck", ["transparenceCheck", "transparencecheck"]],
      // Inside the `animation` block, and the one entry here where the rules'
      // spelling is written zero times: 575 `animationtexturefile`, no
      // `animationtextureFile`. The canonical is still the rules' own, because
      // that is the key the emitted `animationtextureFile` member is measured
      // against — and what the SDK emits.
      ["animationtextureFile", ["animationtexturefile"]],
    ]),
  ],
  // Both `gfx/` registries are written in one spelling throughout 4.4.6 — 3,257
  // `pdxmesh` and 1,740 `pdxparticle`, no variant of either, and no varying
  // field key inside them. The empty tables are not a placeholder: they turn
  // the enforcement on, so a spelling that appears in a later patch fails
  // rather than quietly becoming a second field.
  ["pdxmesh", new Map()],
  ["pdxparticle", new Map()],
]);

/**
 * Every spelling audited for one key of one registry — the canonical one first.
 *
 * The non-throwing half of this module, for readers that are deciding whether a
 * key is theirs rather than recording one they have accepted. A key that is not
 * in the table is its own only spelling, which is the answer for every registry
 * without a table at all.
 *
 * `@pdx-ts/codegen-vanilla`'s `read-ids.ts` matches a definition keyword with
 * this; it must not throw there, because that reader is deliberately lenient
 * about shipped files and reports rather than abandons. {@link CasingFolder}
 * reads the same entries and does throw, because by then the key is known to be
 * one of the registry's own and an unaudited spelling of it is a finding.
 */
export function auditedSpellings(registry: string, canonical: string): readonly string[] {
  return [canonical, ...(OBSERVED_CASINGS.get(registry)?.get(canonical) ?? [])];
}

/**
 * Folds the spellings of one registry onto their canonical forms, and refuses
 * a near-miss it has not been told about.
 *
 * "Near-miss" is the whole point: an unseen spelling that differs from a known
 * key only by case is either a variant somebody must audit or a genuinely new
 * key whose name is a trap. Anything that is not a near-miss is an ordinary new
 * key and becomes canonical for itself — the game writes each of those in one
 * spelling, and the first one seen is that spelling, in the reader's sorted
 * walk order.
 *
 * The two entry points differ in what they are allowed to notice.
 * {@link matches} answers one declared name at a time and is used where the
 * reader is still deciding whether a key is this registry's at all — a sibling
 * type's `bitmapfonts` block shares `interface/` and its spellings are not this
 * registry's business. {@link fold} runs over the keys of a definition already
 * accepted, where every key is one of ours.
 */
export class CasingFolder {
  private readonly registry: string;
  private readonly canonical = new Map<string, string>();
  private readonly variants = new Map<string, ReadonlySet<string>>();

  constructor(registry: string, casings: RegistryCasings) {
    this.registry = registry;
    for (const [canonical, variants] of casings) {
      this.canonical.set(canonical.toLowerCase(), canonical);
      this.variants.set(canonical.toLowerCase(), new Set(variants));
    }
  }

  /** Whether `spelling` is the declared name `canonical`, in any audited casing. */
  matches(spelling: string, canonical: string, file: string): boolean {
    if (spelling === canonical) {
      return true;
    }
    if (spelling.toLowerCase() !== canonical.toLowerCase()) {
      return false;
    }
    if (this.variants.get(canonical.toLowerCase())?.has(spelling) === true) {
      return true;
    }
    throw this.unaudited(spelling, canonical, file);
  }

  /** The canonical spelling of one key of an accepted definition. */
  fold(spelling: string, file: string): string {
    const lower = spelling.toLowerCase();
    const known = this.canonical.get(lower);
    if (known === undefined) {
      this.canonical.set(lower, spelling);
      return spelling;
    }
    if (spelling === known || this.variants.get(lower)?.has(spelling) === true) {
      return known;
    }
    throw this.unaudited(spelling, known, file);
  }

  private unaudited(spelling: string, canonical: string, file: string): Error {
    const audited = [canonical, ...(this.variants.get(canonical.toLowerCase()) ?? [])].join(", ");
    return new Error(
      `${this.registry}: ${file} writes "${spelling}", which differs only by case from the ` +
        `audited spellings of "${canonical}" (${audited}). Either it is another variant of ` +
        "that key, in which case add it to OBSERVED_CASINGS in casing.ts with its count, or " +
        "the game has grown a second key whose name collides with an existing one and the " +
        "reader must not merge them."
    );
  }
}
