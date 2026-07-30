# Handoff: events and effects

The next vertical. Written after the codegen slice landed, for whoever picks
this up.

Read [the README](../README.md) for how codegen works, and the design notes
(`pdx-ts.md`, kept outside this repo) for the model this is trying to build. This
file only covers what is specific to events and effects.

## Why this next, and not the PDXScript parser

The parser is a bigger job but a well-understood one: PDXScript is simple, the
work is grind, and the risk is schedule. Effects carry **design** risk. The
"triggers are expression trees, effects are recorded closures" model is the
load-bearing claim of the whole SDK and it has never been tried. If
recorded-closure effects need three escape hatches to be usable, that is worth
knowing before building the parser everything else depends on.

Triggers were the easy half. Expression trees are just data.

## What you already have for free

Codegen loads effects today — `RuleSet.effects` — purely so the drift gate covers
them. Nothing emits them, but the data is parsed and waiting:

|                           |                                    |
| ------------------------- | ---------------------------------- |
| Effect declarations       | 1134                               |
| …carrying `## scopes`     | 1122                               |
| …carrying `## push_scope` | 309                                |
| In the game's doc dump    | 1056, all with `Supported Scopes:` |

`single_alias[effect_clause]` is `{ alias_name[effect] = alias_match_left[effect] }`
— structurally identical to `trigger_clause`, and `classify(value, resolver)`
already expands it. `immediate` and `after` on an event are both
`single_alias_right[effect_clause]`.

**Event scope is derivable.** `type[event]` declares one subtype per event kind
carrying both a key filter and a scope:

```
## type_key_filter = country_event
## push_scope = country
subtype[country] = {}
```

So `countryEvent(...)` giving its closure a `CountryScope` falls out of the rules
rather than needing a hand-maintained table. Fifteen event kinds are declared
this way.

Effect shapes, for sizing the emitter: 617 block (335 of them containing an
alias splice, 282 flat), 110 literal, 100 type reference, 73 value set, 61 bool,
57 value field, 36 scope, 19 enum.

## The four open questions

**1. The scope object.** 157 effects are valid in every scope; the rest cluster —
country 407, ship 168, planet 155, carrier 132, colony 115, median scope 30. So
`CountryScope` needs ~560 methods and there are 38 scopes with at least one
effect. Generating 38 interfaces is fine; generating 38 × 560 _implementations_
is not. Probably one runtime recorder with generated interface types over it, but
that is unproven. Watch the emitted file size and the IDE's completion latency —
`src/generated/triggers.ts` is already 10k lines.

**2. `iff()`.** The design notes are emphatic that in-game branching is the whole
point of event modding, so this cannot read like an escape hatch. Trigger
truthiness poisoning already works ([trigger-core.ts](../src/trigger-core.ts)) and
`if (someTrigger)` is a compile error today — but the error message points at
`iff()`, which does not exist yet. Build it before anyone hits that message.

**3. `FROM` typing — codegen cannot help here.** `from`, `fromfrom`, `prev` and
friends appear **nowhere** in the rules; `scopes.cwt` does not mention them at
all. Their scope depends on how the event was fired, which is not expressible in
the config. This is a pure SDK design problem: a generic parameter on the event,
an explicit declaration at the fire site, or an honest escape hatch. Decide it
early, because it leaks into every effect signature that touches a saved target.

**4. The mixed trigger/effect blocks.** `random_list` (effects.cwt:1058) is
numeric keys holding both `modifier_rule` and `effect` splices; `weight_modifier`
and MTTH blocks are similar. These are the awkward cases the design notes flagged
for early stress-testing and they are still untested.

## The shape that will block you

126 of the 153 triggers codegen skips are "block with rule fields the emitter
cannot type" — blocks containing a nested `alias_name[trigger]` splice alongside
ordinary fields, like `count_X = { limit = { … } … }`. Effects hit the same shape
far more often: 335 of 617 block effects contain a splice.

Solving nested recursion once likely unlocks both. It is probably the first real
piece of work, not a detail to defer — see `shapeOf` in
[emit/triggers.ts](../tools/codegen/emit/triggers.ts), which currently bails.

## Suggested first probe

Before building anything, hand-write the target API for the nastiest realistic
case and see whether it reads well:

> An event with `immediate` containing a `random_list`, a nested
> `every_owned_planet` that saves an event target, and a later effect in a
> different scope reading that target through `FROM`.

If that is pleasant, the model holds and the rest is emitter work. If it needs
escape hatches, say so loudly — that is the finding, and it is cheaper to learn
now than after 5k lines of generated scope objects.

## Conventions worth keeping

- **The overlay stays small.** [overlay.ts](../tools/codegen/overlay.ts) is the
  one audited file for deliberate departures from a mechanical reading of the
  rules, currently six entries. Twice during the codegen slice the right move
  turned out to be deleting an entry rather than adding one. Adding one should
  feel expensive.
- **Nothing is dropped silently.** Unparseable constructs throw with file:line;
  things the emitter cannot type are counted and reported. Keep that — the
  "triggers not emitted" report is what told us nested recursion was the wall.
- **Rebaseline drift deliberately.** `npm run codegen -- --rebaseline` after
  reviewing the diff, never reflexively.
- **The golden files are the acceptance test.** `tests/__snapshots__` and the
  example mod's output must stay byte-identical unless you meant to change emit.
  Do not run Prettier over `tests/` — it will reformat the golden `.yml` and strip
  its BOM, which Stellaris silently requires. Scope it to `"tests/**/*.ts"`.
- **Effects get the same two-source treatment as triggers.** The rules are
  authoritative for scopes; the dump is the cross-check. Effect drift is already
  in `drift-baseline.json`, so wiring the emitter should not need gate changes.

## Known upstream defect

`vendor/cwtools-stellaris-config/config/common/leader_classes.cwt:13` has an
unmatched `"`, so that one file of 172 does not parse. Nothing reads it yet. If
your work needs leader classes, fix it upstream rather than loosening the lexer.
