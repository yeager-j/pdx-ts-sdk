import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { modifierEntries, triggeredModifierBlock } from "../src/content/blocks.ts";
import type { JobRef } from "../src/generated/refs.ts";

describe("job-derived modifier recorder", () => {
  it("emits every rule-derived operation with the complete job id", () => {
    const job: JobRef = { id: "mymod_job_with_under_score" };
    const entries = modifierEntries((modifier) => {
      modifier.job(job).add(1);
      modifier.job(job).per.pop(2);
      modifier.job(job).per.crime(3);
      modifier.job(job).max.workforce.add(4);
      modifier.job(job).max.workforce.mult(5);
      modifier.job(job).automated.workforce.mult(6);
      modifier.job(job).workforce.mult(7);
      modifier.job(job).bonus.workforce.mult(8);
    });

    expect(serialize(entries)).toBe(`job_mymod_job_with_under_score_add = 1

job_mymod_job_with_under_score_per_pop = 2

job_mymod_job_with_under_score_per_crime = 3

job_mymod_job_with_under_score_max_workforce_add = 4

job_mymod_job_with_under_score_max_workforce_mult = 5

job_mymod_job_with_under_score_automated_workforce_mult = 6

pop_mymod_job_with_under_score_workforce_mult = 7

pop_mymod_job_with_under_score_bonus_workforce_mult = 8
`);
  });

  it("emits a selected job operation inside a triggered modifier", () => {
    const job: JobRef = { id: "mymod_triggered_job" };
    const entry = triggeredModifierBlock(
      "triggered_planet_modifier",
      { modifiers: (modifier) => modifier.job(job).add(2) },
      { path: "", ownerId: "modifier_recorder_test" }
    );

    expect(serialize([entry])).toContain("job_mymod_triggered_job_add = 2");
  });
});
