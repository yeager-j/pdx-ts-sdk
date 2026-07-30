import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { kv } from "./ast.ts";
import { buildEvent, type DefinedEvent, type EventDef } from "./events.ts";
import type { ScopeName } from "./generated/scopes.ts";
import { serializeEntries } from "./serialize.ts";
import { Technology, type TechnologyDef } from "./tech.ts";

export interface ModConfig<P extends string = string> {
  /** Display name shown in the launcher. */
  name: string;
  /** Namespace for everything the mod emits: file names and content ids. Lowercase snake_case. */
  prefix: P;
  version?: string;
  /** Game version pattern, e.g. "4.0.*". */
  supportedVersion: string;
  tags?: string[];
}

/** An id namespaced under the mod prefix P, e.g. `hello_galaxy_${string}`. */
export type PrefixedId<P extends string> = `${P}_${string}`;

const PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export class Mod<const P extends string = string> {
  readonly config: ModConfig<P>;
  private readonly technologies: Technology[] = [];
  private readonly events: DefinedEvent<ScopeName, ScopeName | undefined>[] = [];
  private readonly eventIds = new Set<number>();
  private readonly loc = new Map<string, string>();

  constructor(config: ModConfig<P>) {
    if (!PREFIX_PATTERN.test(config.prefix)) {
      throw new Error(
        `Mod prefix "${config.prefix}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
      );
    }
    this.config = config;
  }

  defineTechnology(def: TechnologyDef<PrefixedId<P>>): Technology {
    // The id type already requires the prefix; this guard remains for callers
    // that erased P to plain string (e.g. a Mod built from runtime config).
    if (!def.id.startsWith(`${this.config.prefix}_`)) {
      throw new Error(
        `Technology id "${def.id}" must start with the mod prefix "${this.config.prefix}_" ` +
          `so it cannot collide with vanilla or other mods`
      );
    }
    if (this.technologies.some((t) => t.id === def.id)) {
      throw new Error(`Duplicate technology id "${def.id}"`);
    }
    const tech = new Technology(def);
    this.technologies.push(tech);
    this.registerLoc(def.id, def.name);
    if (def.desc !== undefined) {
      this.registerLoc(`${def.id}_desc`, def.desc);
    }
    return tech;
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

  private registerLoc(key: string, text: string): void {
    if (this.loc.has(key)) {
      throw new Error(`Duplicate localization key "${key}"`);
    }
    if (text.includes('"')) {
      console.warn(`Localization "${key}": Paradox yml has no quote escaping; replacing " with '`);
      text = text.replaceAll('"', "'");
    }
    this.loc.set(key, text);
  }

  /** Render every generated file to memory as relative path -> content. */
  render(): Map<string, string> {
    const { prefix } = this.config;
    const files = new Map<string, string>();
    files.set("descriptor.mod", this.renderDescriptor());
    if (this.technologies.length > 0) {
      files.set(
        `common/technology/${prefix}_technology.txt`,
        serializeEntries(this.technologies.map((t) => t.toEntries()))
      );
    }
    if (this.events.length > 0) {
      files.set(
        `events/${prefix}_events.txt`,
        serializeEntries([kv("namespace", prefix), ...this.events.map((event) => event.entry)])
      );
    }
    files.set(`localisation/english/${prefix}_l_english.yml`, this.renderLocalization());
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
