import { createMod, type CapabilityFeature } from "@pdx-ts/sdk";
import { eventTarget, isCapital, onActions, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Archive Contracts",
  prefix: "archive_contracts",
  supportedVersion: "v4.4.*",
});

const events = mod.namespace("contract");
const contractWorld = eventTarget<"planet">("archive_contract_world");

const researchContracts = mod.missionCategory("research_contract", {
  name: "Research Contracts",
  short: "Research",
  isContract: true,
  mapIcon: vanilla.spriteType("GFX_nomad_contract_science_icon"),
  logIcon: "gfx/interface/icons/contracts/science_contract_icon_log.dds",
  showInIssueList: true,
});

const archiveContractChain = mod.eventChain("archive_contract", {
  title: "Archive Recovery Contract",
  desc: "Recover the archive from the designated world.",
  icon: "gfx/interface/icons/situation_log/situation_log_quest.dds",
  picture: vanilla.spriteType("GFX_evt_archaeological_dig"),
});

const recoverArchive = mod.mission("recover_archive", {
  name: "Recover the Archive",
  desc: "Retrieve the encoded archive from the designated world.",
  category: researchContracts,
  eventChain: archiveContractChain,
  picture: "GFX_event_pictures_ancient_ruins",
  smallPicture: "GFX_event_pictures_ancient_ruins",
  location: true,
  locationScope: "planet",
  timeToAccept: 180,
  timeToComplete: 720,
  potentialOperator: (ctx) => ctx.from.trigger(isCapital()),
  onAccept: (country, ctx) => {
    country.beginEventChain({ eventChain: archiveContractChain, target: ctx.self });
  },
  onSuccess: (country) => {
    country.addResource({ resource: "unity", amount: 1_000 });
  },
  onCancel: (country) => country.setCountryFlag("archive_contract_failed"),
  onStop: (country) => country.endEventChain(archiveContractChain),
  aiWeight: { base: 10 },
});

const issueArchiveContract = events.country(1, {
  hideWindow: true,
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.randomOwnedPlanet({}, (planet) => planet.saveEventTargetAs(contractWorld));
    country.issueContract({
      contract: recoverArchive,
      location: contractWorld,
      target: ctx.self,
    });
  },
});

const issueContractOnStart = mod.on(onActions.onGameStartCountry, [issueArchiveContract]);

export const feature: CapabilityFeature<"archive_contracts"> = mod.feature("archive_contract", [
  researchContracts,
  archiveContractChain,
  recoverArchive,
  issueArchiveContract,
  issueContractOnStart,
]);

export default mod.compile([feature]);
