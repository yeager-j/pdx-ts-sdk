# Coverage probe: porting an arc site

> **Findings, 2026-08-03. Nothing implemented yet.** A consumer-side gap list
> taken by writing a real feature against the shipped packages, from a mod
> project outside this repo. The mod builds and its output matches vanilla; what
> follows is what it cost, and the one field it still cannot express.

Subject: vanilla's **Asteroid Command Center** — `site_command_center` in
`common/archaeological_site_types/02_ancient_relics_arc_sites.txt`, plus its four
dig-stage events `ancrel.6005`–`ancrel.6020`. Chosen because it exercises a
content registry, a scoped effect field with a declared FROM, cross-registry
references from content into events, and vanilla scripted-effect bindings in one
feature. Written in `ts-sdk-dogfood` as a single co-located module, against
`@pdx-ts/sdk`, `@pdx-ts/stellaris-ids` and `@pdx-ts/sdk-testing` from a local
file link.

The emitted site matches vanilla field-for-field except `desc` (§3). The emitted
events match except for the position of `archaeology = yes`, which is
order-insensitive.

## What held up

Worth recording, because it is the part that does not need work.

`onRollFailed: (fleet, ctx) => ctx.from.effects((site) => ...)` is a real
improvement on the source material: the FROM contract is declared once by the
rules, and the site scope arrives typed. Vanilla writes the same block four
times across the stage events with no way to state what `from` holds.

`stage[].event` accepting a `DefinedEvent` directly, checked as `<event.fleet>`,
is the cross-registry reference feature working exactly as designed — a country
event in that slot is a compile error.

`standardArchaeologicalSiteOnRollFailed({ RANDOM_EVENTS: "all_random_events" })`,
`smallArtifactReward()`, `greatArtifactReward()` and `defaultSiteVisibleTrigger()`
all arrived pre-bound from `@pdx-ts/stellaris-ids` with no ceremony and correct
scopes. `vanilla.sprite(...)` caught a deliberately introduced typo
(`GFX_evt_barren_dig_sight`).

Authoring in a real language paid off immediately: vanilla's four stage events
are copy-paste, and the port collapses them into one parameterized helper.

## 1. `archaeology = yes` cannot be expressed — blocking

`events/events.cwt:503` declares `archaeology = bool` on `subtype[fleet]`. It is
what makes the game render a fleet event inside the excavation window instead of
a normal popup, and **every** vanilla dig-stage event sets it. `EventDef`
(`packages/sdk/src/events.ts:79`) has no member for it and no escape hatch.

The only route is to reach past the authoring API and rebuild the emitted entry:

```ts
const withArchaeology = <T extends { readonly entry: PdxEntry }>(event: T): T => {
  const { value } = event.entry;
  if (value.kind !== "container") throw new Error("expected a container entry");
  return {
    ...event,
    entry: block(event.entry.key, [
      ...(value.items as readonly PdxEntry[]),
      kv("archaeology", true),
    ]),
  };
};
```

This works, and it is not something a mod author should be able to discover. It
requires knowing the PDXScript AST, that `PdxValue` narrows on `"container"`
rather than `"block"`, that `block()` wants `PdxEntry[]` where `items` is
`PdxItem[]` (hence the cast), and that spreading the item preserves `refs`,
`locEntries` and `itemKind` so the build still resolves references and
localization. Get any of that wrong and the failure is a silently malformed mod.

**Arc sites are unshippable without this.** It is the one finding here that
blocks the registry rather than inconveniencing it.

### The general shape

`EventDef` is hand-written while content registries are generated, so it tracks
the rules only as far as someone has extended it. Of the **20 keys the event
type declares unconditionally**, `EventDef` covers 6 (`id`, `hide_window`,
`is_triggered_only`, `fire_only_once`, `immediate`, `after`) and omits 14:

- [ ] `trigger` — the gate on whether an event may fire at all
- [ ] `mean_time_to_happen` / `weight_multiplier` (subtype-gated on `!triggered`
      / `triggered`) — every non-triggered event needs one
- [ ] `location` — subtype-gated; sets the event's map location
- [ ] `abort_trigger`, `abort_effect`
- [ ] `event_chain`, `event_message_type`, `message_desc`, `situation`
- [ ] `major` (+ `major_trigger`), `trackable`, `is_advisor_event`,
      `auto_opens`, `auto_select`, `is_test_event`, `specimen`
- [ ] `archaeology`, `first_contact`, `espionage_operation`, `astral_rift`,
      `diplomatic` — the per-subtype window flags, of which `archaeology` is §1

Per-option, `EventOption` covers `name`, `trigger`, `allow`,
`hide_option_if_not_allowed` and effects, and omits `exclusive_trigger`,
`ai_chance`, `response_text`, `is_dialog_only`, `custom_tooltip`,
`default_hide_option`, `custom_gui`, `tag`, `sound`, and the `icon` block.

Two ways to read this. Either the event surface earns the same generated
treatment content registries get — the rules are right there, and the same drift
gate would then cover events — or the gap list above becomes a tracked backlog.
The current position, where the shortfall is invisible until an author needs a
field, is the one that produced this document.

## 2. A vanilla event cannot be fired

`on_visible = { country_event = { id = story.5 days = 30 } }` appears on
essentially every vanilla arc site — it is the "a dig site appeared"
notification. Fire effects take a branded `EventRef` (`FireEventArgs.id`), and
`vanilla-refs.ts` has no `event` accessor to mint one. `@pdx-ts/stellaris-ids`
has no event registry either, though `../../AGENTS.md` describes the package as
carrying "event ids and namespaces".

The workaround that typechecks today:

```ts
const storySiteFound = {
  kind: "event-ref",
  scope: "country",
  id: "story.5",
  from: undefined,
} as const satisfies EventRef<"country", undefined>;
```

It compiles only because the FROM brand is optional
(`readonly [eventFromBrand]?: From`) — the same softness the `EventRef` doc
comment already flags for `TypedRef`. So the escape hatch exists, is unchecked,
and is reachable only by reading `events.ts`.

Note the asymmetry this creates. Declarative content fields are typed
`Ref | string`, so `stage[].event` happily takes a raw vanilla id — but the
effect recorder does not, and firing a vanilla event is the far more common
need.

- [ ] Decide whether vanilla events get a checked accessor
      (`vanilla.event.country("story.5")`, backed by an event registry in
      `@pdx-ts/stellaris-ids`) or an explicit unchecked one. Either beats a
      structural forgery.

## 3. Localization keys the author does not own

`archaeological_site_type.name` is in `REQUIRED_LOCALISATION`, so `name` takes
English and a key is generated. `desc` is `conversion: "identity"` — a raw key,
with no way anywhere in the public API to define what it says. `LocSink` is
internal; there is no `collection`-level or `buildMod`-level loc entry point.

Writing English into it, which is what every other text-bearing field trains you
to do, produces this with **no warning and no error**:

```
dogfood_desc_probe = {
	desc = "The asteroid reads hollow on every scan."
```

The game will show the key. This is the worst failure mode in the set — silent,
and indistinguishable from success until the mod is loaded. The port drops
`desc` rather than emit a dangling key, which is the only field where it
diverges from vanilla.

- [ ] Either add `desc` to `REQUIRED_LOCALISATION` for this registry (the
      generated `ArchaeologicalSiteTypeDesc.text` arm needs the same treatment),
      or give the SDK a public way to register a localization key, or reject
      strings that cannot be loc keys. Doing none of the three leaves a field
      that silently produces broken output.

## 4. Arc sites are untestable

`SimScopeName = "country" | "planet"` (`packages/sdk-testing/src/state.ts:23`).
A fleet event with an archaeological site as FROM cannot enter the interpreter
at all, so the entire feature — the thing the whole exercise built — has no
`fixture` coverage available.

The type error is accurate but unhelpful at diagnosis time:

```
Type 'EventItem<"fleet", "archaeological_site", "fleet">' is not assignable to
  type 'SimEvent<SimScopeName, undefined> | EventRegistryEntry'.
      Types of property 'scope' are incompatible.
        Type '"fleet"' is not assignable to type 'SimScopeName'.
```

It never says the harness models two scopes out of ~40. The runtime
`coverageSummary()` message would, but a compile error means you never reach it.

The fallback is asserting on rendered output — which checks serialization, not
semantics, and is precisely what `fixture` exists to avoid:

```ts
expect([...emitted.matchAll(/^\tarchaeology = yes$/gm)]).toHaveLength(4);
```

- [ ] Widen `SimScopeName`, or make the unsupported-scope case a diagnosis
      rather than an assignability failure. The whitelist-based design is right;
      what is missing is the harness saying so at the point of use.

## 5. Smaller friction

**Module basenames must be snake_case.** `discoverContent` rejects
`command-center.ts` because the basename _is_ the emitted stem, and Stellaris
filenames are snake_case. Kebab-case is what TypeScript conventions want and
what this repo's own source uses, so it is the natural first guess. Caught at
`npm run build`, not `tsc` — the error text is good, but the failure arrives
after the file is written and imported. Worth a line in the scaffold README
(added there) and possibly in `discoverContent`'s doc comment.

**`Trigger` has no methods.** `isPlanetClass("pc_asteroid").and(hasAncrel())` is
the reflexive first attempt; combinators are free functions. Two of the three
first-pass compile errors were this. Not obviously wrong — `and(...)` reads
better in deeply nested conditions — but worth a line in the README, since the
fluent form is what a TypeScript author reaches for.

**`and()` always emits an `AND` wrapper.** Vanilla writes conjunctions flat:

```
allow = {                          allow = {
	exists = leader                    	AND = {
	leader = {          vs             		exists = leader
		leader_class = scientist       		leader = { leader_class = scientist }
	}                                  	}
}                                  }
```

Semantically identical, and a non-issue in isolation — but it makes diffing
emitted output against the vanilla file it was ported from noisier than it needs
to be, which is exactly the review a porting author performs.

**`vanilla.sprite` / `vanilla.soundEffect` are hard to find.** They are callable
tries, not `export function`s, so they do not surface alongside the other 35
accessors when scanning `vanilla-refs.ts` or grepping for the pattern the rest of
the module uses. The port was written with raw strings throughout before they
turned up. The trie design is good; its discoverability from the outside is not.

## Scaffold bug found in passing

Not an SDK finding, recorded because it was found here: in `create-stellaris-mod`'s
output, `config` lives in `src/index.ts`, which is also the build entrypoint and
has a top-level `await write(...)`. Importing `config` therefore **runs the build
and writes `out/` as a side effect** — so `npm run install-mod` built the mod
twice (the second time without the vanilla view), and a test wanting the real
prefix wrote to disk to get it. Fixed in the dogfood project by moving `config`
to `src/mod.ts`; the template should do the same.
