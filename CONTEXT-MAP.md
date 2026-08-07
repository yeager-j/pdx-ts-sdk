# Context Map

`@pdx-ts/sdk` spans six bounded contexts. They do not share one language: a
word that is load-bearing in one is often meaningless in another, and several
words change meaning as they cross a boundary. Each context's glossary is the
authority for its own terms.

## Contexts

- [Authoring](./packages/sdk/CONTEXT.md) — `packages/sdk`. What a mod author
  writes: capabilities, features, items, and the fold that turns them into a
  mod value.
- [PDXScript Syntax](./packages/pdxscript/CONTEXT.md) — `packages/pdxscript`.
  Parsing and serializing Paradox's script format. Deliberately knows no game
  semantics.
- [CWT Codegen](./packages/codegen-cwt/CONTEXT.md) — `packages/codegen-cwt`.
  Reading cwtools' rule files and emitting the typed authoring surface.
- [Vanilla Extraction](./packages/codegen-vanilla/CONTEXT.md) —
  `packages/codegen-vanilla` and `packages/stellaris-ids`. Deriving vanilla's
  identifiers from an installed game, under a licensing boundary.
- [Simulation](./packages/sdk-testing/CONTEXT.md) — `packages/sdk-testing`.
  Interpreting recorded triggers and effects outside the game, over a
  whitelisted subset of its semantics.
- [Scaffolding](./packages/create-stellaris-mod/CONTEXT.md) —
  `packages/create-stellaris-mod`. Turning generated field knowledge and
  curated conventions into TypeScript source a mod author owns.

## Relationships

Each edge below says what a term _becomes_ when it crosses. Dependency
direction is stated in passing; the translation is the point.

- **Authoring → PDXScript Syntax.** Authoring lowers its items into the
  parser's AST and hands them to `serialize`. Everything Authoring knows —
  scope, registry, localization, which capability owns what — is gone at this
  edge; PDXScript receives only keys, values, and blocks. **`item` flips
  meaning here**: a `ModItem` is an authored value carrying an `itemKind`, a
  `PdxItem` is an AST node. Six modules import both.

- **CWT Codegen → Authoring.** A CWT `type[...]` declaration becomes a
  **registry**, which becomes a capability method (`mod.technology`), a `Def`
  input type, and an `Item` return type. A field's **shape** — the runtime
  writer's dispatch kind — is decided at codegen time and crosses into
  Authoring only as **form** on the emitted field descriptor; the runtime never
  reclassifies a shape into a form itself. **`emit` means different things on
  the two sides**: writing TypeScript in CWT Codegen, writing PDXScript in
  Authoring.

- **CWT Codegen → Scaffolding.** The Supported authoring model reaches
  Scaffolding only through the generated Authoring surface against which
  built-in recipes are compiled and built. No parallel field schema crosses
  this edge; recipe topology and conventions are curated in Scaffolding.

- **Scaffolding → Authoring.** A recipe emits TypeScript source containing one
  Authoring **Feature**. An item recipe places one **Item** in it; a feature
  recipe coordinates several.

- **CWT Codegen → PDXScript Syntax.** Codegen uses the parser to read the
  corpus extracted from a real install. The dependency runs one way only, and
  carries no rules with it: the parser cannot tell a technology from a trigger.

- **Vanilla Extraction → Authoring.** Identifiers cross as declaration-merged
  interfaces (`VanillaIds`, `VanillaScriptedTriggers`, `VanillaScriptedEffects`,
  `VanillaTries`), never as a hard dependency — with `@pdx-ts/stellaris-ids`
  absent the merge targets stay empty and vanilla references degrade to
  unchecked `string` per registry. **A scope changes epistemic status across
  this edge**: what Vanilla Extraction _inferred_ from a definition's body
  arrives in Authoring as a _declared_ constraint the compiler enforces.

- **Authoring → Simulation.** A recorded trigger tree and a list of effect
  entries cross into the interpreter. **`scope` narrows here**: `ScopeName`
  covers every scope the game has, `SimScopeName` covers only the subset the
  interpreter implements, and anything outside it throws rather than being
  guessed — a wrong emulator is worse than no emulator, because every
  divergence is a green test for broken behavior.

- **Within Vanilla Extraction**, `registry` names a content registry
  (`"technology"`, `"sprite"`) while **`ScriptedKind`** is the kind of scripted
  definition (`"trigger" | "effect"`). They were both called `Registry` until
  the two senses met in one assignment.

## Spelling

`localisation` (British) is the game's own directory name and a cwtools rule
keyword; `localization` (American) is the SDK's own machinery. Both spellings
are correct in their place. Quote the game's spelling when naming a game or CWT
concept — the parser matches those keywords literally — and use the SDK's
spelling everywhere else.
