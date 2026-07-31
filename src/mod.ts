import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kv, serialize } from "@pdx-ts/pdxscript";

import { ContentAuthoring } from "./content.ts";
import { StaleRuleTableError, VanillaPathCollisionError } from "./errors.ts";
import { buildEvent, type DefinedEvent, type EventDef } from "./events.ts";
import {
  CONTENT_REGISTRIES,
  GeneratedContentMethods,
  type ContentDefMap,
  type ContentTypeName,
  type DefinedContentMap,
} from "./generated/content-registry.ts";
import type { ScopeName } from "./generated/scopes.ts";
import { OnActionAuthoring, type OnActionRef } from "./on-actions.ts";
import { normalizeLogicalPath } from "./resolver/path-order.ts";
import { collectVarRefs, planPatchEmission, type PatchPlan } from "./resolver/plan.ts";
import { SUPPORTED_STELLARIS_BUILD } from "./resolver/rules.ts";
import {
  patchTechnology as transformTechnology,
  type PatchedTechnology,
  type TechnologyPatch,
} from "./vanilla/patch.ts";
import { sha256Hex, type ParsedTechnology, type VanillaFile } from "./vanilla/surface.ts";

export interface ModConfig<P extends string = string> {
  /** Display name shown in the launcher. */
  name: string;
  /** Namespace for everything the mod emits: file names and content ids. Lowercase snake_case. */
  prefix: P;
  version?: string;
  /** Game version pattern, e.g. "4.0.*". */
  supportedVersion: string;
  tags?: string[];
  /**
   * Acknowledges a game build the rule table is not verified against.
   * Patch emission refuses when the loaded install's version differs from
   * the table's pin; setting this to that exact version proceeds anyway —
   * an explicit, per-version acceptance, never a blanket one.
   */
  acceptGameVersion?: string;
}

export type { PrefixedId } from "./generated/content-registry.ts";

const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export class Mod<const P extends string = string> extends GeneratedContentMethods<P> {
  readonly config: ModConfig<P>;
  private readonly content: ContentAuthoring;
  private readonly patches: PatchedTechnology[] = [];
  private readonly events: DefinedEvent<ScopeName, ScopeName | undefined>[] = [];
  private readonly eventIds = new Set<number>();
  private readonly onActions: OnActionAuthoring;
  private readonly loc = new Map<string, string>();

  constructor(config: ModConfig<P>) {
    super();
    if (!PREFIX_PATTERN.test(config.prefix)) {
      throw new Error(
        `Mod prefix "${config.prefix}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
      );
    }
    this.config = config;
    this.content = new ContentAuthoring(config.prefix, CONTENT_REGISTRIES, (entries) =>
      this.registerLocEntries(entries)
    );
    this.onActions = new OnActionAuthoring((event) => this.events.includes(event));
  }

  protected defineGeneratedContent<K extends ContentTypeName>(
    type: K,
    def: ContentDefMap<P>[K]
  ): DefinedContentMap<P>[K] {
    return this.content.define(type, def) as unknown as DefinedContentMap<P>[K];
  }

  /**
   * Patches a vanilla technology by transform: the closure receives the
   * parsed definition and returns the fields to change; everything else is
   * carried through, so the emission is always the complete object. The
   * patch targets the vanilla key on purpose — no prefix — and the emitted
   * file's name is computed at render time to provably win the override
   * (see resolver/plan.ts).
   */
  patchTechnology<T extends ParsedTechnology>(
    tech: T,
    patch: (tech: T) => TechnologyPatch
  ): PatchedTechnology {
    if (this.patches.some((existing) => existing.id === tech.id)) {
      throw new Error(`Duplicate patch for technology "${tech.id}"`);
    }
    const origin = this.patches[0]?.source.origin;
    if (origin !== undefined && origin.manifestKey !== tech.origin.manifestKey) {
      throw new Error(
        `Patch for "${tech.id}" comes from a different vanilla load than earlier patches ` +
          `(manifest ${tech.origin.manifestKey.slice(0, 12)} vs ${origin.manifestKey.slice(0, 12)}); ` +
          `patch one mod from one view`
      );
    }
    const patched = transformTechnology(tech, patch);
    this.patches.push(patched);
    return patched;
  }

  /**
   * Defines a country event. The full id is `${prefix}.${def.id}` — the mod
   * prefix already satisfies the event-namespace grammar, so it doubles as
   * the namespace. Title/desc/option localization rides along, and the
   * event's closures record eagerly, here.
   */
  defineCountryEvent<From extends ScopeName | undefined = undefined>(
    def: EventDef<"country", From>
  ): DefinedEvent<"country", From> {
    return this.defineEventOf("country_event", "country", def);
  }

  /** Defines a planet event; see {@link defineCountryEvent}. */
  definePlanetEvent<From extends ScopeName | undefined = undefined>(
    def: EventDef<"planet", From>
  ): DefinedEvent<"planet", From> {
    return this.defineEventOf("planet_event", "planet", def);
  }

  private defineEventOf<S extends ScopeName, From extends ScopeName | undefined>(
    kind: "country_event" | "planet_event",
    scope: S,
    def: EventDef<S, From>
  ): DefinedEvent<S, From> {
    if (this.eventIds.has(def.id)) {
      throw new Error(`Duplicate event id "${this.config.prefix}.${def.id}"`);
    }
    this.eventIds.add(def.id);
    const event = buildEvent(kind, scope, this.config.prefix, def, {
      register: (key, text) => this.registerLoc(key, text),
    });
    this.events.push(event);
    return event;
  }

  /**
   * Registers one of this mod's events on a generated Stellaris on-action.
   * The hook is the only inference source: its scope and FROM metadata decide
   * which event contract is accepted.
   */
  on<S extends ScopeName, From extends ScopeName | undefined>(
    hook: OnActionRef<S, From>,
    event: DefinedEvent<NoInfer<S>, NoInfer<From>>
  ): void {
    this.onActions.register(hook, event);
  }

  private registerLoc(key: string, text: string): void {
    this.registerLocEntries([[key, text]]);
  }

  private registerLocEntries(entries: readonly (readonly [string, string])[]): void {
    const pending = new Set<string>();
    for (const [key] of entries) {
      if (this.loc.has(key) || pending.has(key)) {
        throw new Error(`Duplicate localization key "${key}"`);
      }
      pending.add(key);
    }
    for (const [key, source] of entries) {
      let text = source;
      if (text.includes('"')) {
        console.warn(
          `Localization "${key}": Paradox yml has no quote escaping; replacing " with '`
        );
        text = text.replaceAll('"', "'");
      }
      this.loc.set(key, text);
    }
  }

  /**
   * The patch emission plan — computed filename, file content, and the win
   * assertions backing it — or undefined when nothing is patched. Pure and
   * idempotent; `render()` calls it and tests can too.
   */
  patchPlan(): PatchPlan | undefined {
    if (this.patches.length === 0) {
      return undefined;
    }
    const { prefix } = this.config;
    const origin = this.patches[0]!.source.origin;
    if (
      origin.gameVersion !== undefined &&
      origin.gameVersion !== SUPPORTED_STELLARIS_BUILD &&
      this.config.acceptGameVersion !== origin.gameVersion
    ) {
      throw new StaleRuleTableError(
        `the install is Stellaris ${origin.gameVersion} but the rule table is verified against ` +
          `${SUPPORTED_STELLARIS_BUILD} — re-verify the oracle runs, or set ` +
          `acceptGameVersion: "${origin.gameVersion}" to proceed on the stale table`
      );
    }

    // The mod's own files are part of the surviving enumeration too: its
    // technology file can only define prefixed keys, but its *name* competes
    // for path order and must not be chosen again for the patch file.
    const ownTechPath = `common/technology/${prefix}_technology.txt`;
    const technologyEntries = this.content.entries("technology");
    const enumeration: VanillaFile[] = [
      ...origin.files.filter((file) => file.path.startsWith("common/technology/")),
      ...(technologyEntries.length > 0
        ? [
            {
              path: normalizeLogicalPath(ownTechPath),
              sha256: sha256Hex(serialize(technologyEntries)),
              keys: this.content.ids("technology"),
            },
          ]
        : []),
    ];

    return planPatchEmission({
      registry: "technologies",
      patches: this.patches.map((patched) => {
        const entry = patched.toEntries();
        // A file-local @variable referenced by the emission must be
        // re-declared in the patch file; globals resolve cross-file (r1).
        const fileLocals = origin.localVariables(patched.source.sourceFile);
        const locals = new Map<string, number>();
        for (const name of collectVarRefs(entry)) {
          const value = fileLocals.get(name);
          if (value !== undefined) {
            locals.set(name, value);
          }
        }
        return {
          key: patched.id,
          sourceFile: patched.source.sourceFile,
          sourceSha256: patched.source.sourceSha256,
          entry,
          locals,
        };
      }),
      enumeration,
      reservedPaths: [ownTechPath],
      prefix,
    });
  }

  /** Render every generated file to memory as relative path -> content. */
  render(): Map<string, string> {
    const { prefix } = this.config;
    const files = new Map<string, string>();
    files.set("descriptor.mod", this.renderDescriptor());
    for (const [relPath, contents] of this.content.render()) {
      files.set(relPath, contents);
    }
    if (this.events.length > 0) {
      files.set(
        `events/${prefix}_events.txt`,
        serialize([kv("namespace", prefix), ...this.events.map((event) => event.entry)])
      );
    }
    const renderedOnActions = this.onActions.render();
    if (renderedOnActions !== undefined) {
      files.set(`common/on_actions/${prefix}_on_actions.txt`, renderedOnActions);
    }
    files.set(`localisation/english/${prefix}_l_english.yml`, this.renderLocalization());

    const plan = this.patchPlan();
    if (plan !== undefined) {
      files.set(plan.relPath, plan.content);
      // Never emit at a path vanilla occupies: a same-path collision replaces
      // the whole vanilla file (the spike's r6 run killed two techs that way).
      const vanillaPaths = new Set<string>(
        this.patches[0]!.source.origin.files.map((file) => file.path)
      );
      for (const relPath of files.keys()) {
        if (relPath !== "descriptor.mod" && vanillaPaths.has(normalizeLogicalPath(relPath))) {
          throw new VanillaPathCollisionError(
            `this mod would emit ${relPath}, a path vanilla already occupies — a same-path ` +
              `collision silently replaces the entire vanilla file`
          );
        }
      }
    }
    return files;
  }

  /** Write the rendered files under outDir, creating directories as needed. */
  async synth(outDir: string | URL): Promise<void> {
    const root = outDir instanceof URL ? fileURLToPath(outDir) : outDir;
    for (const [relPath, content] of this.render()) {
      const target = path.join(root, relPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  }

  private renderDescriptor(): string {
    const { name, version, tags, supportedVersion } = this.config;
    const lines = [`name="${name}"`];
    if (version !== undefined) {
      lines.push(`version="${version}"`);
    }
    if (tags !== undefined && tags.length > 0) {
      lines.push("tags={", ...tags.map((tag) => `\t"${tag}"`), "}");
    }
    lines.push(`supported_version="${supportedVersion}"`);
    return lines.join("\n") + "\n";
  }

  private renderLocalization(): string {
    // The BOM is mandatory: Stellaris silently ignores localization files without it.
    const lines = [...this.loc].map(([key, text]) => ` ${key}:0 "${text}"`);
    return "\uFEFF" + ["l_english:", ...lines].join("\n") + "\n";
  }
}
