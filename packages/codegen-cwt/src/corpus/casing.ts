/**
 * Maps a canonical CWT key spelling to the non-canonical spellings found in the game files.
 *
 * Use the CWT spelling as the map key and list only audited case variants as its value.
 */
export type RegistryCasings = ReadonlyMap<string, readonly string[]>;

/**
 * Provides audited case variants for registries with case-insensitive source files.
 *
 * Keep the CWT spelling canonical and add a variant only after measuring it in the corpus.
 */
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
  // Empty tables enable near-miss detection for these audited registries.
  ["pdxmesh", new Map()],
  ["pdxparticle", new Map()],
]);

/**
 * Returns every audited spelling of a registry key, with the canonical spelling first.
 *
 * Use this for lenient keyword matching before a definition has been accepted; it never throws.
 */
export function auditedSpellings(registry: string, canonical: string): readonly string[] {
  return [canonical, ...(OBSERVED_CASINGS.get(registry)?.get(canonical) ?? [])];
}

/**
 * Normalizes accepted registry keys to their audited canonical spellings.
 *
 * Use {@link matches} while selecting a definition, then use {@link fold} for its keys. An
 * unaudited case-only collision throws so it cannot silently become a second field.
 */
export class CasingFolder {
  private readonly registry: string;
  private readonly canonical = new Map<string, string>();
  private readonly variants = new Map<string, ReadonlySet<string>>();

  /**
   * Creates a normalizer for one registry.
   *
   * Pass the registry name for diagnostics and its corresponding {@link RegistryCasings} table.
   */
  constructor(registry: string, casings: RegistryCasings) {
    this.registry = registry;
    for (const [canonical, variants] of casings) {
      this.canonical.set(canonical.toLowerCase(), canonical);
      this.variants.set(canonical.toLowerCase(), new Set(variants));
    }
  }

  /**
   * Tests whether a candidate spelling is one declared canonical key.
   *
   * Use this before accepting a definition key; it returns false for a different key and throws
   * for an unaudited case-only variant.
   */
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

  /**
   * Returns the canonical spelling for a key in an accepted definition.
   *
   * Use this for every entry key in that definition. New non-colliding keys become canonical;
   * unaudited case-only variants throw.
   */
  fold(spelling: string, file: string): string {
    const lower = spelling.toLowerCase();
    const canonicalSpelling = this.canonical.get(lower);
    if (canonicalSpelling === undefined) {
      this.canonical.set(lower, spelling);
      return spelling;
    }
    if (spelling === canonicalSpelling || this.variants.get(lower)?.has(spelling) === true) {
      return canonicalSpelling;
    }
    throw this.unaudited(spelling, canonicalSpelling, file);
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
