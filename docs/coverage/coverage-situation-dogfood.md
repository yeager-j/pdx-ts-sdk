# Coverage probe: porting a situation

> **Findings, 2026-08-03. Nothing implemented yet.** The second consumer-side
> probe, same method as `coverage-arc-site-dogfood.md`: write a real vanilla
> feature against the shipped packages from a mod project outside this repo, and
> record what it costs. Read that document first — two of its findings recur
> here, and one of them turns out to be narrower than it looked.

Subject: vanilla's **Unplugged Identity Crisis** —
`situation_unplugged_identity` in `common/situations/12_unplugged_situations.txt`,
plus the two situation events its `on_monthly` fires (`unplugged.3900`,
`unplugged.3902`). Chosen as the structural opposite of an arc site: two levels
of keyed sub-record (`stages`, `approach`), a bidirectional progress model, an
11-row `monthly_progress` weight block with per-row localization, and an
author-declared target scope. Written as one co-located module in
`ts-sdk-dogfood`.

The emitted situation matches vanilla structurally. Three slots needed a cast
through `unknown` (§1); the rest of the divergence is vanilla using raw loc keys
where the SDK generates them, which is the SDK being better.

## What held up

The keyed sub-record model is the standout. `stages` and `approach` are authored
as plain records and lower to the two different shapes the rules ask for, with
no per-registry code:

```ts
approach: { dogfood_unplugged_discourage_change: { name: "Discourage Change", ... } }
stages:   { dogfood_unplugged_stage_remain:      { name: "As We Are", end: 65, ... } }
```

```
approach = { name = dogfood_unplugged_discourage_change ... }   # siblings keying
stages = { dogfood_unplugged_stage_remain = { end = 65 ... } }  # container keying
```

The record key being the id, and `name` being English that generates
localization under that id, is exactly the right split — vanilla has to write
the id twice and hand-maintain the loc key.

`targetScope: "country"` plus `situation.target<"country">(...)` is a good
resolution of a contract the rules genuinely do not state. `situationProgress("<", 15)`
lowering to a bare `situation_progress < 15` comparison inside a modifier row
works. Per-row `desc` auto-registration works (with a caveat — §2).
`checkVariable({ which, value: [">", -0.2] })` putting the operator in a tuple is
a nicer encoding than the game's own.

## 1. `value_field` collapses to `number` — blocking

The sharpest finding in either probe, because it is one line of codegen and it
recurs everywhere.

CWT distinguishes `float` from `value_field`. A `value_field` slot accepts a
float **or** a variable name, a `scope.variable` path, `value:<script_value>`, or
`trigger:<name>`. `modifier_rule.cwt:2,7` types every arithmetic operation
inside a `modifier = { }` row as `value_field`, not `float` — and
`effects.cwt:1218` does the same for `change_variable.value`.

The distinction survives the whole pipeline. `cwt/model.ts:134` parses
`value_field` into its own `RuleType` kind, `{ kind: "valueField", integer }`,
carried faithfully through the model — and then `emit/types.ts:104` flattens it:

```ts
case "int":
case "float":
case "valueField":
  return { type: "number", toScalar: (e) => e };
```

The rules declare **357** `= value_field` slots, plus scalar-position ones. The
subject situation needs three of them, and this is what the port has to do:

```ts
/** ... The emitted script is correct; only the type is wrong. */
const valueField = (path: string): number => path as unknown as number;
```

### It is not an edge case

Measured over every `add`/`subtract`/`mult`/`multiply`/`divide`/`factor`/`min`/`max`
assignment in the installed game's `common/`:

| operand form                                 | count     |
| -------------------------------------------- | --------- |
| numeric literal                              | 14,622    |
| `value:<script_value>`                       | 1,282     |
| `trigger:<name>`                             | 139       |
| variable / `scope.variable` path / `$PARAM$` | 599       |
| **non-numeric total**                        | **2,020** |
| `@scripted_variable`                         | 2,314     |

**12% of vanilla's modifier operands are not numbers.** A mod that computes
anything — scaling a cost by empire size, reading a situation variable, reusing
a script value — needs this on its first non-trivial weight block.

- [ ] Lower `valueField` to something wider than `number`. The information is
      already in the model; only the last step discards it. A branded
      `ScriptValue` that `number` widens into would keep numeric literals
      unchanged at every existing call site while admitting the other arms.
- [ ] Note the generated doc comments already describe the wider domain —
      `check_variable`'s reads `value >=< <float>/<variable>/<scope.variable>/trigger:<trigger>`
      directly above a signature that admits only the first. The docs are right
      and the types are narrower than the docs, which is the worst way round.

Adjacent, lower priority: the 2,314 `@scripted_variable` operands are a separate
gap — `common/scripted_variables/` is not a supported registry, and there is no
public constructor for a `var` scalar, so `@`-references cannot be emitted at
all. Less pressing, since a mod can inline the literal.

## 2. Modifier `desc` keys are positional — silently breaks translations

`content.ts:1313` derives the localization key for a modifier row's `desc` from
its index:

```ts
const key = `${ownerId}_${fieldPath}_${index}`;
```

The doc comment above it claims the key is "deterministic across runs, and never
collides for legitimate input" — both true, and neither is the property that
matters. The keys are not stable **across edits**. Inserting one row at index 2
of an 11-row `monthly_progress`, demonstrated:

```
before: ..._monthly_progress_2:0 "The Flesh is Weak"
after:  ..._monthly_progress_2:0 "A newly inserted row"
        ..._monthly_progress_3:0 "The Flesh is Weak"
```

Every key from the insertion point down now names a different row. English
regenerates and looks fine; any translated `l_french` file the mod ships is now
silently misaligned, with no error at build time and no visible symptom until a
French player reads a tooltip. Vanilla sidesteps this entirely by writing stable
hand-authored keys (`ap_the_flesh_is_weak`, `situation_unplugged_faction_opinion_tt`).

- [ ] Key modifier rows by something stable. An optional author-supplied slug
      (`{ add: 6, descKey: "flesh_is_weak", desc: "The Flesh is Weak" }`) is the
      obvious candidate, falling back to the index only when absent — or a hash
      of the desc text, which is stable under reordering but changes on rewording.
      Either beats position.

## 3. Approach ids are unchecked against the definition that declares them

`enums.ts:364` is `export type SituationApproach = string`, so
`currentSituationApproach("dogfood_unplugged_discourage_change")` accepts
anything. In this situation the approach being named is declared **twelve lines
away in the same object literal** — the relationship is entirely within one
definition, and a typo silently produces a modifier that never applies.

This is the same class of thing `stage[].event` gets right for arc sites, and
the same class the `targetScope` contract solves for `start_situation`. The
information is closer to hand here than in either.

- [ ] Thread the declared `approach` keys into `currentSituationApproach` when
      the call is inside the definition that declares them, or check it in
      `buildMod` as a reference the way content refs already are. The definition
      is a value; its approach keys are literal.

## 4. Untestable — recurs from `coverage-arc-site-dogfood.md` §4

`SimScopeName = "country" | "planet"`, so a situation event does not enter the
interpreter either:

```
Type 'EventItem<"situation", undefined, "situation">' is not assignable to
  type 'SimEvent<SimScopeName, undefined> | EventRegistryEntry'.
        Type '"situation"' is not assignable to type 'SimScopeName'.
```

Two complex registries probed, two registries with no `fixture` coverage
available. Both fell back to regexing emitted script. That is now a pattern
rather than an isolated gap, and it inverts the value proposition of the
testing package: the features simple enough to test by inspection are testable,
and the ones with enough logic to warrant a test are not.

The situation case is the more pointed one, because a situation is almost
entirely arithmetic — an 11-row progress calculation with variables, thresholds
and approach multipliers is precisely what someone would want to assert on, and
it is exactly what cannot be reached.

## 5. Localization: the arc-site finding is narrower than it looked

`coverage-arc-site-dogfood.md` §3 reported that `archaeological_site_type.desc`
takes a raw loc key with no way to define it, and that writing English there
silently emits the sentence as a key. Situations show that is **not** a design
position — it is a per-registry overlay gap.

Every text slot here does the right thing: `name` → `<id>`, `desc` → `<id>_desc`,
`typeName` → `<id>_type`, approach `name` → the approach id, stage `name` → the
stage id, modifier `desc` → a generated key. The port supplies English
throughout and never writes a loc key by hand.

So the fix for §3 of the earlier document is narrow and mechanical: add the
missing `REQUIRED_LOCALISATION` rows. Worth auditing every registry for the same
omission rather than fixing arc sites alone — a text field the emitter treats as
`identity` is the signature, and it fails silently every time.

## 6. Smaller friction

**`everyPopFaction({}, body)`.** Every iterator takes a required `args` object
whose only member (`limit`) is optional, so the no-filter case — which is what
vanilla writes here — is spelled with an empty object literal. An overload
taking just the body would remove it.

**`situation.target<S>(...)` needs its type argument written out.** Correct and
documented — the definition object is not in scope inside its own effect
closures, so the scope cannot be inferred. Worth noting only because
`defineSituationType` already carries `targetScope: "country"` a few lines above,
so the author states the same fact twice and the compiler checks neither against
the other.

**Scripted-effect parameters emit in alphabetical order.** `createVariableIfNotExists`
emits `VALUE_IF_CREATED` before `VARIABLE`. Harmless — parameters are named —
but it makes a diff against the vanilla source noisier, same category as the
`AND` wrapper noted in the earlier document.
