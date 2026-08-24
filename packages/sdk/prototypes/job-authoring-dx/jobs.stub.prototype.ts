/**
 * PROTOTYPE ONLY. This file simulates a possible Jobs authoring module.
 * It is not part of the SDK build and must not be promoted in place.
 */
import {
  always,
  type EconomicResourceBlock,
  type JobFields,
  type JobRef,
  type ModifierClosure,
  type ScopedModifierRecorder,
  type ScopeName,
  type Trigger,
} from "@pdx-ts/sdk/stellaris";

type JobDisplay = NonNullable<JobFields["swappableData"]>["default"];
type JobSwap = NonNullable<NonNullable<JobFields["swappableData"]>["swapType"]>[number];

interface JobText {
  readonly name: string;
  readonly plural?: string;
  readonly desc?: string;
  readonly effect?: string;
}

interface EconomyEntry<S extends ScopeName> {
  readonly when?: Trigger<S>;
  readonly produces?: Readonly<Record<string, number>>;
  readonly upkeep?: Readonly<Record<string, number>>;
}

interface EconomyGroup<S extends ScopeName> {
  readonly category: string;
  readonly entries: readonly EconomyEntry<S>[];
}

interface JobEconomy {
  readonly local: EconomyGroup<"colony">;
  readonly overlord?: EconomyGroup<"pop_group">;
}

interface SpecialistEligibility {
  readonly pops: "free" | "gamePolicy";
  readonly possible: Trigger<"pop_group">;
}

interface JobModifiers {
  readonly popGroup?: JobFields["popGroupModifier"];
  readonly country?: JobFields["countryModifier"];
  readonly planet?: JobFields["planetModifier"];
  readonly system?: JobFields["systemModifier"];
  readonly triggeredForSpecies?: JobFields["triggeredPlanetPopGroupModifierForSpecies"];
  readonly triggeredForAll?: JobFields["triggeredPlanetPopGroupModifierForAll"];
  readonly triggeredCountry?: JobFields["triggeredCountryModifier"];
  readonly triggeredPlanet?: JobFields["triggeredPlanetModifier"];
  readonly triggeredSystem?: JobFields["triggeredSystemModifier"];
}

interface SpecialistJobSpec extends JobText {
  readonly eligibility: SpecialistEligibility;
  readonly display?: JobDisplay;
  readonly swaps?: readonly JobSwap[];
  readonly tags?: readonly string[];
  readonly economy: JobEconomy;
  readonly modifiers?: JobModifiers;
  readonly weight?: JobFields["weight"];
}

interface SwapTargetSpec extends JobText {
  readonly category: "ruler" | "specialist" | "worker" | "complex_drone" | "simple_drone";
  readonly display: JobDisplay;
}

interface SwapToSpec {
  readonly when: Trigger<"planet">;
  readonly weight: JobSwap["weight"];
  readonly icon?: JobSwap["icon"];
  readonly buildingIcon?: JobDisplay["buildingIcon"];
  readonly conditionString?: string;
}

interface ProposedJobModifiers {
  job(job: JobRef & { readonly id: string }): {
    readonly positions: {
      add(amount: number): void;
    };
  };
}

function economyBlocks<S extends ScopeName>(
  group: EconomyGroup<S> | undefined
): EconomicResourceBlock<S>[] | undefined {
  return group?.entries.map((entry) => ({
    category: group.category,
    produces:
      entry.produces === undefined ? undefined : { amounts: entry.produces, when: entry.when },
    upkeep: entry.upkeep === undefined ? undefined : { amounts: entry.upkeep, when: entry.when },
  }));
}

function specialist(spec: SpecialistJobSpec): JobFields {
  return {
    name: spec.name,
    plural: spec.plural,
    desc: spec.desc,
    effect: spec.effect,
    category: "specialist",
    swappableData:
      spec.display === undefined && spec.swaps === undefined
        ? undefined
        : { default: spec.display ?? {}, swapType: spec.swaps ? [...spec.swaps] : undefined },
    tags: spec.tags ? [...spec.tags] : undefined,
    possiblePreTriggers: {
      hasOwner: true,
      isEnslaved: spec.eligibility.pops === "free" ? false : undefined,
      isBeingPurged: false,
      isBeingAssimilated: false,
      isSapient: true,
    },
    possiblePrecalc: "can_fill_specialist_job",
    possible: spec.eligibility.possible,
    resources: economyBlocks(spec.economy.local),
    overlordResources: economyBlocks(spec.economy.overlord),
    popGroupModifier: spec.modifiers?.popGroup,
    countryModifier: spec.modifiers?.country,
    planetModifier: spec.modifiers?.planet,
    systemModifier: spec.modifiers?.system,
    triggeredPlanetPopGroupModifierForSpecies: spec.modifiers?.triggeredForSpecies,
    triggeredPlanetPopGroupModifierForAll: spec.modifiers?.triggeredForAll,
    triggeredCountryModifier: spec.modifiers?.triggeredCountry,
    triggeredPlanetModifier: spec.modifiers?.triggeredPlanet,
    triggeredSystemModifier: spec.modifiers?.triggeredSystem,
    weight: spec.weight,
  };
}

function swapTarget(spec: SwapTargetSpec): JobFields {
  return {
    name: spec.name,
    plural: spec.plural,
    desc: spec.desc,
    effect: spec.effect,
    category: spec.category,
    swappableData: { default: spec.display },
    possible: always(false),
  };
}

function swapTo(job: JobRef & { readonly id: string }, spec: SwapToSpec): JobSwap {
  return {
    trigger: spec.when,
    name: job,
    desc: `job_${job.id}_desc`,
    icon: spec.icon ?? job,
    buildingIcon: spec.buildingIcon,
    conditionString: spec.conditionString,
    weight: spec.weight,
  };
}

function modifiers(
  closure: (modifier: Omit<ScopedModifierRecorder<"colony">, "job"> & ProposedJobModifiers) => void
): ModifierClosure<"colony"> {
  return (recorder) => {
    const proposed = new Proxy(recorder, {
      get(target, property, receiver) {
        if (property === "job") {
          return (job: JobRef & { readonly id: string }) => ({
            positions: {
              add(amount: number) {
                target.unchecked(`job_${job.id}_add`, amount);
              },
            },
          });
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as unknown as Omit<ScopedModifierRecorder<"colony">, "job"> & ProposedJobModifiers;
    closure(proposed);
  };
}

export const jobs = { specialist, swapTarget, swapTo, modifiers };
