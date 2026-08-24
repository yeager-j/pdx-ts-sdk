import { createMod } from "@pdx-ts/sdk";
import { and, type Trigger } from "@pdx-ts/sdk/stellaris";
import { isHiveEmpire, isMachineEmpire } from "@pdx-ts/stellaris-ids/triggers";

const mod = createMod({
  name: "Signals in the Dust",
  prefix: "signals_in_the_dust",
  supportedVersion: "v4.4.*",
});

const EMPIRE_KINDS = ["regular", "hive", "machine"] as const;
type EmpireKind = (typeof EMPIRE_KINDS)[number];

type RewardResource = "alloys" | "energy" | "food" | "influence" | "unity";

interface EmpireOption {
  readonly key: string;
  readonly name: string;
  readonly resource: RewardResource;
  readonly amount: number;
}

type FourOptions = readonly [EmpireOption, EmpireOption, EmpireOption, EmpireOption];

const OPTIONS_BY_EMPIRE = {
  regular: [
    {
      key: "horizon_corps",
      name: "Fund the Horizon Corps.",
      resource: "influence",
      amount: 25,
    },
    {
      key: "stellar_archives",
      name: "Open the Stellar Archives.",
      resource: "unity",
      amount: 100,
    },
    {
      key: "frontier_markets",
      name: "Seed the Frontier Markets.",
      resource: "energy",
      amount: 250,
    },
    {
      key: "expedition_foundries",
      name: "Stockpile alloys for the expedition.",
      resource: "alloys",
      amount: 100,
    },
  ],
  hive: [
    {
      key: "listening_tendrils",
      name: "Extend the Listening Tendrils.",
      resource: "influence",
      amount: 25,
    },
    {
      key: "ancestral_memory",
      name: "Join the Ancestral Memory.",
      resource: "unity",
      amount: 100,
    },
    {
      key: "outer_nests",
      name: "Feed the Outer Nests.",
      resource: "food",
      amount: 250,
    },
    {
      key: "brood_carapace",
      name: "Harden the Brood Carapace.",
      resource: "alloys",
      amount: 100,
    },
  ],
  machine: [
    {
      key: "prediction_mesh",
      name: "Expand the Prediction Mesh.",
      resource: "influence",
      amount: 25,
    },
    {
      key: "cold_storage",
      name: "Commit the pattern to Cold Storage.",
      resource: "unity",
      amount: 100,
    },
    {
      key: "relay_grid",
      name: "Overclock the Relay Grid.",
      resource: "energy",
      amount: 250,
    },
    {
      key: "survey_frames",
      name: "Print Redundant Survey Frames.",
      resource: "alloys",
      amount: 100,
    },
  ],
} as const satisfies Record<EmpireKind, FourOptions>;

const EMPIRE_CONDITION = {
  regular: and(isHiveEmpire(false), isMachineEmpire(false)),
  hive: isHiveEmpire(),
  machine: isMachineEmpire(),
} satisfies Record<EmpireKind, Trigger<"country">>;

const events = mod.namespace("signal");

const chooseResponse = events.country(1, {
  title: "A Signal in the Dust",
  desc: "An ancient relay offers twelve paths, but only four suit the minds receiving its call.",
  isTriggeredOnly: true,
  options: EMPIRE_KINDS.flatMap((kind) =>
    OPTIONS_BY_EMPIRE[kind].map(({ key, name, resource, amount }) => ({
      key: `${kind}_${key}`,
      name,
      trigger: EMPIRE_CONDITION[kind],
      effects: (country) => {
        country.addResource({ resource, amount });
      },
    }))
  ),
});

export default mod.compile([mod.feature("signal", [chooseResponse])]);
