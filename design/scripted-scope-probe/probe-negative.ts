/**
 * The claims the analysis must NOT make.
 *
 * The other probes in `design/` pin their negatives with `@ts-expect-error`,
 * because what they are proving is a type-level claim. This probe's negatives
 * are behavioural: the whole safety argument is that an unreadable body widens
 * rather than narrows, and that is a property of the walk, not of a signature.
 * So the same role is played by hand-built bodies whose only acceptable answer
 * is "unconstrained", exercised from `probe.test.ts`.
 *
 * Each of these is a narrowing the analysis could plausibly make and must not.
 * If one of them ever comes back narrowed, the soundness argument in
 * `infer.ts`'s header has a hole and the verdict has to be revisited.
 */

import { parse } from "@pdx-ts/pdxscript";

import type { Definition } from "./infer.ts";

interface NegativeCase {
  readonly name: string;
  readonly source: string;
  readonly why: string;
  /**
   * The one answer that is allowed. Absent means "unconstrained". A case with a
   * narrowing here is still a negative: what it pins is that the narrowing stops
   * where it should, rather than running on into the part of the body the
   * analysis must not read.
   */
  readonly allowed?: readonly string[];
}

const CASES: readonly NegativeCase[] = [
  {
    name: "conditional_only",
    source: `conditional_only = {
      [[STRICT]
        is_country_type = default
      ]
    }`,
    why:
      "The only condition is inside a [[FLAG]] block, which is absent unless the " +
      "caller defines FLAG. Narrowing to country would make the trigger " +
      "unauthorable in every scope the caller can legitimately use it in.",
  },
  {
    name: "parameter_key",
    source: `parameter_key = {
      $CONDITION$ = yes
    }`,
    why: "The key itself is a substitution. Nothing is known about what it will be.",
  },
  {
    name: "caller_relative_only",
    source: `caller_relative_only = {
      from = { is_country_type = default }
    }`,
    why:
      "`from` is the caller's scope. What is legal inside it says nothing about " +
      "where this trigger may be invoked.",
  },
  {
    name: "dual_scope_or",
    source: `dual_scope_or = {
      OR = {
        is_country_type = default
        is_planet_class = pc_continental
      }
    }`,
    why:
      "The deliberately dual-scope shape, and the case that decides OR. " +
      "Intersecting the arms gives the empty set, which would make the trigger " +
      "unauthorable everywhere; unioning gives both arms' scopes. What must " +
      "never happen is one arm winning.",
    allowed: ["carrier", "colony", "country", "dlc_recommendation", "planet", "ship"],
  },
  {
    name: "unknown_key_only",
    source: `unknown_key_only = {
      some_key_no_rule_declares = yes
    }`,
    why: "A key from a mod, or newer than the vendored rules. Unknown must mean unconstrained.",
  },
  {
    name: "pushed_scope_only",
    source: `pushed_scope_only = {
      any_owned_planet = { is_artificial = yes }
    }`,
    why:
      "is_artificial constrains the pushed planet scope, not the caller. Only " +
      "any_owned_planet's own scopes may reach the top — and so this case " +
      "asserts a narrowing that is correct rather than none at all.",
    allowed: ["country", "sector"],
  },
];

export interface Negative extends Definition {
  readonly why: string;
  /** The one narrowing that IS allowed, when the case has one. */
  readonly allowed?: readonly string[];
}

export function negativeCases(): readonly Negative[] {
  return CASES.map((one) => {
    const parsed = parse(one.source, `${one.name}.txt`);
    const entry = parsed.items[0];
    if (entry === undefined || entry.kind !== "entry" || entry.value.kind !== "container") {
      throw new Error(`negative case ${one.name} did not parse as a definition`);
    }
    return {
      name: one.name,
      items: entry.value.items,
      why: one.why,
      ...(one.allowed === undefined ? {} : { allowed: one.allowed }),
    };
  });
}
