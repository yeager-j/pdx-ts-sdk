import { createMod, hasAuthority } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Council",
  prefix: "frontier_council",
  supportedVersion: "v4.4.*",
});

const frontierMandate = mod.staticModifier("frontier_mandate", {
  name: "Frontier Mandate",
  modifiers: (modifier) => modifier.country.unity.produces.mult(0.1),
});

const chartTheFrontier = mod.agenda("chart_the_frontier", {
  name: "Chart the Frontier",
  desc: "Direct the council toward a new age of exploration.",
  agendaCost: 800,
  agendaCooldown: 3_600,
  potential: hasAuthority("auth_democratic"),
  allow: hasAuthority("auth_democratic"),
  modifier: (modifier) => modifier.country.unity.produces.mult(0.05),
  finishModifier: frontierMandate,
  effect: (country) => country.addResource({ resource: "unity", amount: 250 }),
  aiWeight: { base: 10 },
});

export const feature = mod.feature("frontier_agenda", [frontierMandate, chartTheFrontier]);

export default mod.compile([feature]);
