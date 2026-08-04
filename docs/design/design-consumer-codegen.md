# Consumer-side codegen

> **Rough draft, 2026-08-01 — proposal, not a decision.** Nothing here is
> implemented. Written to capture the argument and its evidence before it gets
> re-derived; the open questions at the end are the ones that would settle it.

## The gap is already live

`defineEconomicCategory` shipped with SDK-5. Economic categories generate
modifier names: one vanilla category (`pop_category_specialists`) accounts for
**52 names** in the game's modifier dump, `<category>_<resource>_produces_add`
and `_upkeep_add` across every resource.

So the SDK can already create content whose generated modifier names its own
tables cannot know. An author who defines an economic category and then tries to
set one of its modifiers gets nothing from the typed surface — their recourse is
`unchecked()` or a hand-written `CustomModifiers` declaration merge.

Component tags are the same shape at smaller scale. Dawn Of Ascension declares
two (`weapon_type_dark_matter`, `weapon_type_dark_energy`) and uses the modifier
names they generate — `weapon_type_dark_matter_weapon_damage_mult = 0.15` in
three reactor components, with matching `mod_…` localisation keys. Verified
against the current build: `raw("weapon_type_energy_weapon_damage_mult")`
compiles (vanilla tags reach the dump, so they reach the trie);
`raw("weapon_type_dark_matter_weapon_damage_mult")` is correctly rejected.

This is not a hypothetical about future registries. We shipped the ability to
create the content without the ability to type what the content generates.

## Two kinds of knowledge, and only one clearly wants codegen

### Install-derived

Vanilla ids, **third-party mod** ids, vanilla scripted triggers and effects,
`inline_script` parameter lists, dependency load order.

None of this is derivable from the author's TypeScript at any price — it lives
on their disk. Codegen is not the best answer here, it is the only one. And it
is one mechanism four tickets are each independently waiting on:

| ticket                                        | what it needs                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| SDK-12 vanilla identifier package             | read the install, emit per-registry id types                                         |
| SDK-13 bind vanilla scripted triggers/effects | read `common/scripted_*`, emit signatures                                            |
| SDK-14 generalize whole-object patching       | see third-party mods' ids **and their load order** — the ticket's own stated blocker |
| SDK-17 model `inline_script`                  | read `common/inline_scripts/`, type the parameters                                   |

This is the real argument. Component tags are a footnote beside it.

### Author-derived

The author's own component tags, economic categories, scripted modifiers.

Here codegen has a chicken-and-egg the first category does not: the source of
truth is the same TypeScript that consumes it. Prisma and GraphQL dodge this by
having a separate schema artifact; this SDK's entire pitch is that there is not
one.

Most of this is reachable at the type level instead, with no build step —
`defineComponentTag` returning a branded _literal_ type, threaded into a small
parameterized recorder (`m.tag(darkMatter).weaponDamage.mult(0.15)`, seeding the
existing proxy's path so the runtime needs no change). Only `raw()`'s flat name
set genuinely cannot be reached that way.

If consumer codegen exists anyway, there is a clean resolution: let it read the
mod's **own emitted output** as a second pass and generate the `CustomModifiers`
augmentation from it. Build once, types sharpen, rebuild. That makes it a
refinement rather than a prerequisite, so the cycle never blocks a first build.

## What this changes about SDK-12

SDK-12 is currently specced as a prebuilt package, version-pinned to the game.
Consumer-side generation is strictly more capable for the same work, because a
published package can never know which mods _this_ user has installed — which is
exactly what SDK-14 needs.

The cost is reproducibility: types generated from one install differ from
another's. A teammate with a different mod set, or CI with none, gets different
types.

The mitigation is the one this repo already trusts: **commit the generated
output**, behind a drift gate, exactly as `src/generated/` and
`codegen:check` work today. The precedent is in this repository and it has held
up across every registry landed so far.

## Feasibility

Better than it looks. The pieces exist:

- `src/stellaris/installation/locate.ts` finds the install
- `tools/codegen/corpus.ts` already reads a registry directory into definitions
- `src/ordering.ts` already models load order across files
- `src/stellaris/vanilla/view.ts` already parses vanilla technology and
  `common/scripted_variables/`, resolving `@variable` provenance
- the CWT rule tables already describe every registry's shape

A consumer generator is mostly repackaging, not new machinery.

## Costs to be honest about

- A **second codegen pipeline** to maintain. This one is not cheap: overlays,
  drift baselines, reports, corpus gates.
- Two layers of generated types makes debugging worse when they disagree.
- "Mod authors run ordinary TypeScript" becomes "…plus one generate step." A
  real dilution of the pitch, even if it is the deal Prisma users accept.
- SDK-12's clean "version-pinned to the game" story becomes a per-project lock.

## Open questions

1. **Prebuilt package or consumer-generated?** The reproducibility answer above
   makes generated viable, but it is the load-bearing choice and it decides
   SDK-12's whole shape.
2. **Does the generator read declared dependencies, or everything installed?**
   Reading everything is easier and makes builds depend on unrelated subscribed
   mods. A declared dependency list is more work and is what SDK-14 actually
   wants.
3. **Where does the author-derived half land?** Type-level threading now and
   codegen never, or type-level now and a codegen refinement pass later.
4. **What is the drift gate for consumer output?** `codegen:check` compares
   against committed output; the consumer equivalent has to tolerate a game
   patch or a mod update without failing every build.

## Not covered here

The `m.tag()` parameterized-recorder design for prefix-position modifier
templates stands on its own and does not depend on any of this — 38 of the 179
template rows in `modifiers.cwt` are prefix-position across 10 families
(`enum[ship_class]` 10 suffixes, `<leader_class>` 6, `enum[component_tag]` 3,
`<planet_class>` 3, and so on). It is worth doing regardless, and it is what
makes the author-derived half mostly a type-level problem rather than a codegen
one.
