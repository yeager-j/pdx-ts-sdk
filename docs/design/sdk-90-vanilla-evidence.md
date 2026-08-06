# SDK-90 vanilla evidence for starter recipes

This note answers the SDK-99 research question for SDK-101: what Stellaris 4.4.6 itself
establishes for one technology, one event, one building, and a small research-quest
composition, and what the committed corpus cannot establish.

## Method and evidence classes

`locateInstall()` resolves the macOS Steam default only after checking for
`common/technology`; the detected root was
`/Users/jackson/Library/Application Support/Steam/steamapps/common/Stellaris`
([locator](../../packages/sdk/src/stellaris/installation/locate.ts#L1-L56)). Its
`launcher-settings.json:1-13` identifies Pegasus `v4.4.6`. All install paths below are
relative to that root and written as `${STELLARIS}/…`.

Evidence is labelled:

- **Documented** — comments intended as first-party documentation in the installed game.
- **Measured** — the committed 4.4.6 corpus fixture, which carries counts and capped scalar
  samples but no script bodies or localized text
  ([fixture boundary](../../packages/sdk/tests/codegen/corpus-fixture.ts#L1-L26),
  [fixture version](../../packages/sdk/tests/fixtures/corpus/meta.json#L1-L5)).
- **Exemplar** — a successful definition shipped in the same install. It proves the pattern
  works, not that it is required or uniquely conventional.
- **Inference** — a downstream conclusion supported by those sources, not a stated game rule.

The install scan was read-only. No vendored rules, corpus fixture, or generated source was
regenerated.

## Evidence useful to item recipes

### Technology

| Question | Evidence | Consequence for a starter recipe |
| --- | --- | --- |
| Core fields | **Measured:** all 679 technologies have `area`, `category`, and `tier`; 674 have `cost`, 641 have `weight`, and 504 have `prerequisites` ([area/category/cost](../../packages/sdk/tests/fixtures/corpus/technology.json#L317-L390), [prerequisites](../../packages/sdk/tests/fixtures/corpus/technology.json#L1709-L1735), [tier/weight](../../packages/sdk/tests/fixtures/corpus/technology.json#L2458-L2496)). **Documented:** the installed example describes cost, area, tier, prerequisites, category, rarity, feature flags, weight, and weight modifiers (`common/technology/000_documentation.txt:5-43`). | Ask for name, description, area, category, tier, and cost. Offer weight, prerequisites, rarity, and potential as the first optional layer. Frequency is convention evidence, not a proof of requiredness. |
| Value choices and ranges | **Documented:** area is `society`, `engineering`, or `physics`; progression prerequisites should point at a similar previous-tier technology (`common/technology/000_documentation.txt:15-23`). **Measured:** 4.4.6 uses tiers `0..5` and the same three areas; its category sample contains 13 values ([area/categories](../../packages/sdk/tests/fixtures/corpus/technology.json#L317-L361), [tiers](../../packages/sdk/tests/fixtures/corpus/technology.json#L2458-L2477)). Cost is usually scalar but can be a block ([cost forms](../../packages/sdk/tests/fixtures/corpus/technology.json#L363-L390)). | Make area a closed choice, category an install-backed reference choice, and tier a `0..5` starter choice. Use scalar cost in the starter; do not pretend the observed scalar sample is a complete numeric range. |
| References | **Exemplar:** `tech_basic_science_lab_2` points to `tech_basic_science_lab_1` and uses `computing` as its category (`common/technology/00_phys_tech.txt:53-60`). The current SDK models categories and prerequisites as typed references ([field descriptors](../../packages/sdk/src/generated/technology.ts#L220-L279)). | Complete prerequisites from technology IDs and categories from technology-category IDs. Preserve a raw-ID escape hatch for third-party content. |
| Scope | **Exemplar:** the technology weight modifier evaluates country predicates such as `has_technology` and `has_country_flag` (`common/technology/00_phys_tech.txt:72-86`). The current generated surface types `potential`, `weightModifier`, `aiWeight`, and `startingPotential` in country scope ([current interface](../../packages/sdk/src/generated/technology.ts#L110-L128)). | Any optional potential or weighting prompt must produce country-scoped expressions. |
| Dependency order | **Documented:** a tiered path conventionally depends on a previous tier (`common/technology/000_documentation.txt:18-21`). **Exemplar:** the three lab technologies are declared in ascending dependency order (`common/technology/00_phys_tech.txt:32-100`). | Ascending declaration is a good generated-code convention, but this exemplar does not establish it as an engine requirement. |

The current SDK also requires English `name`, while `desc` is optional, and emits them under
`<id>` and `<id>_desc` ([current interface](../../packages/sdk/src/generated/technology.ts#L70-L92),
[localization descriptors](../../packages/sdk/src/generated/technology.ts#L352-L355)). That is
repository behavior, not a fact retained by the vanilla corpus.

### Event

There is no event registry in the committed corpus, so the safe evidence is the installed
definitions plus the current SDK surface.

| Question | Evidence | Consequence for a starter recipe |
| --- | --- | --- |
| Identity and kind | **Exemplar:** the file declares `namespace = colony`, then defines typed events with IDs such as `colony.1` (`events/colony_events_1.txt:1-20`). **Repository comparison:** the current SDK has a distinct event kind and main scope for each generated kind, including carrier, country, fleet, planet, ship, situation, and others ([kind table](../../packages/sdk/src/generated/events.ts#L14-L52)). | Ask for namespace-local numeric ID and event kind first. The kind is not decoration; it selects the root scope for every trigger and effect closure. |
| Visible-event fields | **Exemplar:** the starter `carrier_event` `colony.50` uses title, conditional descriptions, picture, sound, location, tracking, event-chain association, pre-triggers, trigger, `is_triggered_only`, immediate effects, and options (`events/colony_events_1.txt:558-664`). A compact completion event uses title, description, picture, sound, location, chain, immediate, and one option (`events/colony_events_1.txt:666-690`). | The small item recipe should ask for title, description, picture, triggered-only behavior, and at least one option. Sound, location, chain, trigger, immediate, and after-effects are optional extensions. |
| Hidden event | **Exemplar:** a successful hidden country event consists of ID, `hide_window = yes`, `is_triggered_only = yes`, a trigger, and immediate effects (`events/achievement_events.txt:1-30`). | Treat “visible choice event” and “hidden effect event” as two prompt branches; do not require title, description, picture, or options for the hidden branch. |
| Scope transitions | **Exemplar:** `colony.50` runs carrier-root operations directly, enters `owner` for country work, and starts a chain targeted at `ROOT`; its project-enabling effects use `location = this` and `owner = root` (`events/colony_events_1.txt:613-645`). **Repository comparison:** event triggers use the event scope, while immediate/after/options receive the same typed scope plus a typed `FROM` context ([current event contract](../../packages/sdk/src/events/types.ts#L233-L265), [closures](../../packages/sdk/src/events/types.ts#L319-L331)). | Choose the event kind before asking for effects. Any location/owner transition must be rendered through typed scope operations rather than copied as an untyped string. |
| References | **Exemplar:** events refer to sprites, sounds, event chains, special projects, other event IDs, deposits, and localization keys (`events/colony_events_1.txt:558-690`). The current event contract brands event-chain, sprite, sound, and event references ([current event fields](../../packages/sdk/src/events/types.ts#L233-L260)). | Offer install-backed completion for picture, sound, event-chain, and fired-event references when available; do not use the corpus as the source because it contains no events. |

The installed pre-trigger note defines the fast yes/no planet checks and says they also work on
pop, system, starbase, and leader events
(`events/000_added_pre_triggers_to_planet_events.txt:1-45`). The installed on-action guide
recommends them for event kinds fired frequently by on-actions
(`common/on_actions/99_README_ON_ACTIONS.txt:11-16`). A starter may omit pre-triggers, but an
on-action recipe should surface them when the selected event kind supports them.

### Building

| Question | Evidence | Consequence for a starter recipe |
| --- | --- | --- |
| Core fields | **Measured:** all 498 buildings have `category`; 462 have `base_buildtime`, 458 have `resources`, and 433 have `building_sets` ([category](../../packages/sdk/tests/fixtures/corpus/building.json#L593-L617), [build time/sets](../../packages/sdk/tests/fixtures/corpus/building.json#L397-L470), [resources](../../packages/sdk/tests/fixtures/corpus/building.json#L3066-L3089)). **Documented:** every ordinary building other than an Overlord holding or branch-office building must belong to at least one set (`common/buildings/00_example.txt:18-22`). | Ask for category, building set, build time, and a simple resource cost/upkeep. Make the set conditional only if the recipe later supports the two documented exceptions. |
| Value choices and ranges | **Measured:** the category sample contains the 4.4.6 categories, and observed literal build times include `90`, `180`, `240`, `420`, `800`, `900`, and `1080` days ([category](../../packages/sdk/tests/fixtures/corpus/building.json#L593-L617), [build time](../../packages/sdk/tests/fixtures/corpus/building.json#L397-L417)). **Exemplar:** the research lab uses scripted variables for its build time and resource amounts, not fixed literals (`common/buildings/05_research_buildings.txt:4-13`, `:66-83`). | Categories and building sets are reference choices. A numeric starter default is reasonable, but the UI must not present observed literals as a closed range; variables are legal vanilla practice. |
| References | **Exemplar:** the first lab requires `tech_basic_science_lab_1` and upgrades to `building_research_lab_2` (`common/buildings/05_research_buildings.txt:80-94`). **Measured:** 242 buildings have technology prerequisites and 189 have upgrade references ([prerequisites](../../packages/sdk/tests/fixtures/corpus/building.json#L2982-L3015), [upgrades](../../packages/sdk/tests/fixtures/corpus/building.json#L4949-L4985)). | Complete prerequisite technologies and upgrade targets from their respective ID registries. |
| Scope transitions | **Documented:** potential and allow are planet-scoped; empire-limit modifiers are country-scoped and planet-limit modifiers planet-scoped (`common/buildings/00_example.txt:32-62`). Modifier destinations explicitly include planet, country, army, and system (`common/buildings/00_example.txt:86-153`). **Repository comparison:** the generated interface makes these transitions explicit ([current building scopes](../../packages/sdk/src/generated/building.ts#L179-L250)). | The simple recipe should keep potential/allow in colony scope and resource production in the building’s colony scope. Modifier prompts must be destination-specific. |
| Forward references | **Exemplar:** `building_research_lab_1` refers to `building_research_lab_2` on lines 89-90, while the latter is declared starting at line 94 (`common/buildings/05_research_buildings.txt:85-105`). | Successful vanilla content permits at least this forward identifier reference. Generated TypeScript may need a predeclared handle or a dependency-safe definition order even though PDXScript does not require lexical-before-use here. |

The installed building documentation is explicitly caveated as possibly outdated
(`common/buildings/00_example.txt:1-6`), so the measured 4.4.6 shapes should break ties.

## Evidence useful to the research-quest feature recipe

The subterranean-civilization chain is a compact, successful composition containing the requested
parts:

1. **On-action entry.** `on_colony_2_years_old.random_events` assigns weight `3` to
   `colony.50`; the same event is also eligible at year three
   (`common/on_actions/00_on_actions.txt:3714-3726`, `:3768-3777`). The installed guide states
   that `events` fires every valid event, while `random_events` filters by event triggers and rolls
   one weighted valid event; weight may point to `0` for no event
   (`common/on_actions/99_README_ON_ACTIONS.txt:4-9`, `:29-40`).
2. **Event chain.** `subterranean_civilization_chain` declares icon, picture, and
   `developments` category (`common/event_chains/00_event_chains.txt:21-31`). The same file
   documents the `<chain>_title` / `<chain>_desc` localization convention and counter purpose
   (`common/event_chains/00_event_chains.txt:1-14`).
3. **Starter event.** Carrier event `colony.50` starts that chain with `target = ROOT` and offers
   one or two special-project choices depending on its option branch
   (`events/colony_events_1.txt:558-664`).
4. **Projects and completion events.** The communication project uses cost `1000`, society,
   picture, 360-day limit, planet event scope, and fires `colony.51` on success. The competing
   strike project uses cost `5000`, engineering, the same limit/scope, links itself to the first
   project with `same_option_group_as`, and fires `colony.52`
   (`common/special_projects/00_projects_1.txt:286-336`). The corresponding completion events are
   carrier events with their own localized window and effects
   (`events/colony_events_1.txt:666-723`).

### Quest field and scope table

| Part | Conventional starter fields | Scope/reference fact |
| --- | --- | --- |
| Chain | ID, title, description, icon, picture, situation-log category; optional counters | 298 of 299 committed chains have an icon, 297 a picture, and 265 a category ([chain totals](../../packages/sdk/tests/fixtures/corpus/event_chain.json#L1-L5), [icon/picture](../../packages/sdk/tests/fixtures/corpus/event_chain.json#L607-L650), [category](../../packages/sdk/tests/fixtures/corpus/event_chain.json#L722-L745)). Counters are less universal: 119 chains use them ([counter](../../packages/sdk/tests/fixtures/corpus/event_chain.json#L61-L85)). |
| Project | ID/name/description, chain, one cost mode, picture, event scope, completion behavior; optional time limit, requirements, alternate-group link | The installed documentation says `cost` must be `0` when `days_to_research` is used, `tech_department` matters when cost is nonzero, and `event_chain` associates the project (`common/special_projects/documentation.txt:4-34`). In 4.4.6, project event scope values are `carrier_event`, `country_event`, `planet_event`, and `ship_event` ([observed scopes](../../packages/sdk/tests/fixtures/corpus/special_project.json#L477-L494)); this supersedes the older spellings in the documentation. |
| Project completion | `on_success`; optionally `on_fail`, `on_cancel`, progress hooks | The installed documentation states that success/start/progress run with `THIS` as the declared project scope, `FROM` as location, and `PREV` as country; fail/cancel instead run with `THIS` as country, `FROM` as project scope, and `FROMFROM` as location (`common/special_projects/documentation.txt:89-121`). The current SDK encodes success scope from `eventScope` and fail/cancel as country scope ([current project scopes](../../packages/sdk/src/generated/special-project.ts#L230-L289)). |
| On-action | Hook, deterministic `events` or weighted `random_events`, event reference, weight, optional no-event weight | The installed guide defines the two execution modes and custom on-actions (`common/on_actions/99_README_ON_ACTIONS.txt:4-9`, `:26-40`). The selected event’s trigger is the eligibility gate. |

**Measured convention, not a closed range:** among 720 projects, 402 use `cost`, 426 use
`days_to_research`, 506 use a technology department, 615 declare an event scope, and 605 have
`on_success` ([cost](../../packages/sdk/tests/fixtures/corpus/special_project.json#L229-L270),
[days](../../packages/sdk/tests/fixtures/corpus/special_project.json#L308-L359),
[scope/success](../../packages/sdk/tests/fixtures/corpus/special_project.json#L477-L494),
[on-success](../../packages/sdk/tests/fixtures/corpus/special_project.json#L884-L920),
[department](../../packages/sdk/tests/fixtures/corpus/special_project.json#L1696-L1712)).
Those counts cannot say which fields conventionally occur together.

### Dependency and declaration ordering

The exemplar contains a cross-registry cycle:

- the on-action references the starter event;
- the starter event references the chain and projects;
- each project references a completion event;
- completion behavior ends the chain.

The relevant references are split across `common/on_actions/00_on_actions.txt:3714-3726`,
`events/colony_events_1.txt:613-690`, and
`common/special_projects/00_projects_1.txt:286-336`. Along with the building forward reference,
this proves successful PDXScript content is identifier-linked rather than requiring every target
to appear lexically before use. **Inference:** a feature recipe should allocate all IDs/typed
handles before composing bodies, then emit by registry; it should not attempt to topologically
sort this graph. This matters because the current SDK evaluates event closures eagerly and
documents definition-order requirements for cross-references
([current event behavior](../../packages/sdk/src/events/types.ts#L1-L15)).

## What the committed corpus does not establish

| Missing fact | Why it is missing | Required follow-up for SDK-101 |
| --- | --- | --- |
| Event and on-action conventions | `CONTENT_MANIFEST` includes technology, building, event chain, and special project, but no event or on-action registry ([manifest](../../packages/codegen-cwt/src/content-manifest.ts#L58-L61), [chain/project rows](../../packages/codegen-cwt/src/content-manifest.ts#L150-L161)). There are therefore no `event.json` or `on_action.json` fixtures. | Keep the first event/on-action recipe bounded to documented fields and the cited successful exemplar, or add install-derived inventories before offering corpus-ranked defaults. |
| Top-level field co-occurrence | A registry fixture stores independent per-field observations only; `keysByDefinition` groups keys *inside one observed block*, not the set of top-level fields on a whole definition ([serialized shape](../../packages/sdk/tests/codegen/corpus-fixture.ts#L297-L322), [meaning of grouping](../../packages/codegen-cwt/src/corpus.ts#L76-L90)). | Add a definition-level top-key-set observation for the four recipe registries. Without it, counts cannot distinguish valid cost/duration branches or identify the smallest representative field set. |
| Requiredness and conditional legality | The corpus is deliberately a lower bound: an absent field may still be legal ([corpus contract](../../packages/codegen-cwt/src/corpus.ts#L10-L22)). Even 679/679 presence does not prove a rule is required, and independent field counts cannot express “required when subtype/other field has value X.” | Source requiredness and conditional facts from generated rule metadata, then test them against corpus evidence; do not infer them from frequency. |
| Complete reference choices | Each scalar sample is capped at 64, and registry fixtures do not retain definition IDs at all ([sample cap](../../packages/codegen-cwt/src/corpus.ts#L93-L112), [fixture shape](../../packages/sdk/tests/codegen/corpus-fixture.ts#L311-L322)). | Use the install-derived identifier package/runtime inventories for searchable choices. Treat corpus values as falsification samples, not autocomplete catalogs. |
| Cross-registry dependency graph and source order | Fixtures are serialized independently per registry and contain a fingerprint plus field observations, not source locations or outbound edges ([registry fixture](../../packages/sdk/tests/codegen/corpus-fixture.ts#L311-L335), [serialization](../../packages/sdk/tests/codegen/corpus-fixture.ts#L347-L383)). | Add only the relationships needed by the first feature recipe, or encode the researched topology in the recipe while field legality remains generated. |
| Localization and narrative content | The fixture intentionally stores no localized text or script bodies ([licensing boundary](../../packages/sdk/tests/codegen/corpus-fixture.ts#L1-L20)). | Generate localization keys from the SDK’s existing descriptors and prompt the author for copy; never claim corpus evidence for prose defaults. |
| Exact runtime scope provenance | Field observations retain keys used under a trigger/effect block, but events/on-actions are absent and the fixture does not retain a complete `ROOT`/`FROM` transition path. | Drive scope from the generated types and the documented special-project transition contract; keep unsupported transitions out of the starter recipe rather than guessing. |

## Bounded conclusion for SDK-101

The evidence supports four catalog entries without inventing game semantics:

- a technology with name/description, area, category, tier, scalar cost, and optional
  weight/prerequisites/rarity;
- a visible or hidden typed event, with kind chosen before scoped content;
- an ordinary building with category, building set, build time, simple resources, and optional
  technology/upgrade references;
- a research quest that composes one chain, one starter event, one or two projects, typed
  completion events, and one deterministic or weighted on-action hook.

The recipe topology may be curated from the successful subterranean exemplar. Field legality,
requiredness, reference types, and scope must continue to come from generated SDK facts. The
committed corpus can rank common fields for technology, building, event chain, and special project,
but it cannot by itself choose coherent top-level field sets, events, on-actions, complete
references, or dependency order.
