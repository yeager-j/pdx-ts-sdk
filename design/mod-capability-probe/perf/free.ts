import { defineTechnology } from "../../../packages/sdk/src/generated/content-definers.ts";
import { names } from "./names.ts";

export const technologies = names.map((name) =>
  defineTechnology({
    id: `perf_probe_tech_${name}`,
    name,
    area: "physics",
    tier: 1,
    category: "particles",
  })
);

type ExpectedId = `perf_probe_tech_${(typeof names)[number]}`;
const ids: ExpectedId[] = technologies.map((technology) => technology.id as ExpectedId);
void ids;
